// Ocean layer (§6.4 of the plan): a stereo brown surf bed behind a 400 Hz low-pass with a 0.04 Hz
// ±2 dB sway, and one automation bundle per wave (swell, crash, wash, pan) planned with lookahead
// from ocean-model.planWave. Every crash is reported through onWave(tCrash, Tw) for the scene.
// Loop sources start once and keep looping silently behind `out` between start/stop.

import { dbToGain } from '../core/levels.js';
import { oceanParams, planWave } from '../core/ocean-model.js';
import { glideTo, fade, applyEvents } from './automation.js';

const LEAD = 0.01;
const SURF_LP_HZ = 400;
const FILTER_Q = 0.7;
const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 0.5;
const LEVEL_TAU = 0.125;

/** Creates the ocean layer into `bus`: { setIntensity(i), start() → Promise<boolean>, stop({ seconds }), dispose(), ready }. */
export function createOceanLayer(ctx, bus, scheduler, cache, { rng, intensity = 0.35, onWave } = {}) {
  const now = () => ctx.currentTime + LEAD;
  let params = oceanParams(intensity);
  let buffers = null;
  let loops = null;
  let running = false;
  let nextStart = 0;

  const gain = (value, destination) => {
    const g = ctx.createGain();
    g.gain.value = value;
    if (destination) g.connect(destination);
    return g;
  };
  const filter = (type, hz, Q, destination) => {
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = Q;
    f.connect(destination);
    return f;
  };

  const out = gain(0, bus);
  const surfGain = gain(0, out);
  const surfLP = filter('lowpass', SURF_LP_HZ, FILTER_Q, surfGain);
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = params.surfLfo.hz;
  const lfoDepth = gain(0);
  lfo.connect(lfoDepth);
  lfoDepth.connect(surfGain.gain);
  lfo.start(ctx.currentTime);

  const pan = ctx.createStereoPanner();
  pan.pan.value = 0;
  pan.connect(out);
  const swellGain = gain(0, pan);
  const swellLP = filter('lowpass', params.swell.lpFrom, FILTER_Q, swellGain);
  const crashGain = gain(0, pan);
  const crashBP = filter('bandpass', params.crash.bpFrom, params.crash.Q, crashGain);
  const washGain = gain(0, pan);
  const washHP = filter('highpass', params.wash.hpFrom, FILTER_Q, washGain);
  const paramMap = {
    swellLP: swellLP.frequency, swellGain: swellGain.gain,
    crashBP: crashBP.frequency, crashGain: crashGain.gain,
    washHP: washHP.frequency, washGain: washGain.gain,
    pan: pan.pan,
  };

  const ready = Promise.all([cache.bed('oceanSurf'), cache.bed('oceanSwell'), cache.bed('oceanWhite')]).then(([surf, swell, white]) => {
    buffers = { surf, swell, white };
    applySurf(now(), 0);
  });

  const surfLevel = () => dbToGain(params.surfGainDb) * (buffers ? buffers.surf.trim : 1);

  function applySurf(t, tau = LEVEL_TAU) {
    const level = surfLevel();
    glideTo(surfGain.gain, level, t, tau, 'target');
    glideTo(lfoDepth.gain, level * (dbToGain(params.surfLfo.depthDb) - 1), t, tau, 'target');
  }

  function loopSource(buffer, ...destinations) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    for (const destination of destinations) source.connect(destination);
    source.start(ctx.currentTime);
    return source;
  }

  function ensureLoops() {
    if (loops) return;
    loops = [
      loopSource(buffers.surf.buffer, surfLP),
      loopSource(buffers.swell.buffer, swellLP),
      loopSource(buffers.white.buffer, crashBP, washHP),
    ];
  }

  const planner = {
    plannedUpTo: 0,
    plan(from, to) {
      const items = [];
      let t0 = Math.max(nextStart, from);
      while (t0 < to) {
        const wave = planWave(rng, t0, params);
        items.push({ at: t0, events: wave.events, visual: wave.visual });
        t0 = wave.nextStart;
      }
      nextStart = t0;
      planner.plannedUpTo = t0;
      return items;
    },
    apply(item) {
      applyEvents(paramMap, item.events);
      if (typeof onWave === 'function') onWave(item.visual.at, item.visual.duration);
    },
    reset() {
      nextStart = 0;
    },
  };

  /** Retunes the surf bed and the recipe the next waves use for intensity i. */
  function setIntensity(i) {
    params = oceanParams(i);
    applySurf(now());
  }

  /** Starts (once buffers exist) and fades in over 1.5 s; resolves true when this call started it, false when it already ran or was stopped meanwhile. */
  function start() {
    if (running) return ready.then(() => false);
    running = true;
    return ready.then(() => {
      if (!running) return false;
      ensureLoops();
      nextStart = 0;
      planner.plannedUpTo = 0;
      scheduler.add(planner);
      fade(out.gain, out.gain.value, 1, now(), FADE_IN_SECONDS, 'scurve');
      return true;
    });
  }

  /** Fades out over `seconds` and stops planning waves; the beds keep looping silently. */
  function stop({ seconds = FADE_OUT_SECONDS } = {}) {
    running = false;
    scheduler.remove(planner);
    fade(out.gain, out.gain.value, 0, now(), seconds, 'equalPowerOut');
  }

  /** Stops every source and leaves the bus. */
  function dispose() {
    running = false;
    scheduler.remove(planner);
    const t = ctx.currentTime;
    lfo.stop(t);
    if (loops) {
      for (const source of loops) source.stop(t);
      loops = null;
    }
    out.disconnect();
  }

  return { setIntensity, start, stop, dispose, ready, get running() { return running; } };
}
