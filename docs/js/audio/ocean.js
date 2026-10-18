// Ocean layer (§6.4 of the plan, v0.4 spec §3.8): a stereo brown surf bed behind a 400 Hz low-pass
// whose level sways along the texture's 1/f surf curve (at most 3 dB under nominal, one target per
// knot of its own jittered stream), and one automation bundle per wave (swell, crash, wash, pan)
// planned with lookahead from ocean-model.planWave at the texture's set energy, so waves come in
// sets and lulls. Every crash is reported through onWave(tCrash, Tw, strength) for the scene.
// Loop sources start once and keep looping silently behind `out` between start/stop.

import { dbToGain } from '../core/levels.js';
import { oceanParams, planWave } from '../core/ocean-model.js';
import { mapDb } from '../core/fractal.js';
import { TEXTURE_RECIPE } from '../core/texture-model.js';
import { glideTo, fade, applyEvents } from './automation.js';

const LEAD = 0.01;
const SURF_LP_HZ = 400;
const FILTER_Q = 0.7;
const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 0.5;
const LEVEL_TAU = 0.125;
/** Without a texture the surf holds its level and every wave sits mid-set. */
const STILL_SEA = Object.freeze({ surf: { at: () => 1 }, surfTicks: () => [], set: { at: () => 0.5 } });

/** Creates the ocean layer into `bus`, shaped by `texture` (core/texture-model.js): { setIntensity(i), start() → Promise<boolean>, stop({ seconds }), dispose(), ready }. */
export function createOceanLayer(ctx, bus, scheduler, cache, { rng, intensity = 0.35, onWave, texture = null } = {}) {
  const now = () => ctx.currentTime + LEAD;
  const field = texture ?? STILL_SEA;
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

  const sway = (t) => mapDb(field.surf.at(t), params.surfSway.depthDb);
  const out = gain(0, bus);
  const surfSway = gain(sway(ctx.currentTime), out);
  const surfGain = gain(0, surfSway);
  const surfLP = filter('lowpass', SURF_LP_HZ, FILTER_Q, surfGain);

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
    glideTo(surfGain.gain, surfLevel(), t, tau, 'target');
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

  // Wave bundles move plannedUpTo to the next wave, so the sway knots are planned up to there as well.
  const planner = {
    plannedUpTo: 0,
    plan(from, to) {
      const items = [];
      let t0 = Math.max(nextStart, from);
      while (t0 < to) {
        const wave = planWave(rng, t0, params, { set: field.set.at(t0) });
        items.push({ at: t0, events: wave.events, visual: wave.visual });
        t0 = wave.nextStart;
      }
      nextStart = t0;
      planner.plannedUpTo = t0;
      for (const { t } of field.surfTicks(from, t0)) items.push({ at: t, sway: sway(t) });
      return items;
    },
    apply(item) {
      if (!item.events) {
        glideTo(surfSway.gain, item.sway, item.at, TEXTURE_RECIPE.surf.tau, 'target');
        return;
      }
      applyEvents(paramMap, item.events);
      if (typeof onWave === 'function') onWave(item.visual.at, item.visual.duration, item.visual.strength);
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
    if (loops) {
      for (const source of loops) source.stop(t);
      loops = null;
    }
    out.disconnect();
  }

  return { setIntensity, start, stop, dispose, ready, get running() { return running; } };
}
