// Rain layer (§6.4 of the plan): a pre-bandpassed pink bed behind a moving low-pass, a brown
// rumble, and Poisson drops from the 24-variant kit planned with lookahead, one buffer source
// per drop (gain and playbackRate), disconnected when it ends and capped at 30 per second by the
// model. The loop sources start once and keep looping silently behind `out` between start/stop,
// so a slider dragged through zero never doubles a bed.

import { dbToGain } from '../core/levels.js';
import { rainParams, initialGust, gustWalk, planDrops } from '../core/rain-model.js';
import { glideTo, fade } from './automation.js';

const LEAD = 0.01;
const RUMBLE_LP_HZ = 200;
const DROP_LP_HZ = 6000;
const BED_Q = 0.7;
const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 0.5;
const TAU = Object.freeze({ level: 0.125, filter: 0.08, gust: 0.5 });
/** Most drop sources alive at once (3 s of the 30/s cap). */
const MAX_LIVE_DROPS = 90;

/** Creates the rain layer into `bus`: { setIntensity(s), start() → Promise<boolean>, stop({ seconds }), dispose(), ready }. */
export function createRainLayer(ctx, bus, scheduler, cache, { rng, intensity = 0.45 } = {}) {
  const now = () => ctx.currentTime + LEAD;
  let params = rainParams(intensity);
  let gust = initialGust(intensity);
  let buffers = null;
  let loops = null;
  let running = false;
  const drops = new Set();

  const node = (type, setup) => {
    const n = ctx[type]();
    setup(n);
    return n;
  };
  const out = node('createGain', (g) => { g.gain.value = 0; g.connect(bus); });
  const bedLP = node('createBiquadFilter', (f) => { f.type = 'lowpass'; f.frequency.value = params.bedLpHz; f.Q.value = BED_Q; });
  const bedGain = node('createGain', (g) => { g.gain.value = 0; bedLP.connect(g); g.connect(out); });
  const rumbleLP = node('createBiquadFilter', (f) => { f.type = 'lowpass'; f.frequency.value = RUMBLE_LP_HZ; f.Q.value = BED_Q; });
  const rumbleGain = node('createGain', (g) => { g.gain.value = 0; rumbleLP.connect(g); g.connect(out); });
  const dropLP = node('createBiquadFilter', (f) => { f.type = 'lowpass'; f.frequency.value = DROP_LP_HZ; f.Q.value = BED_Q; f.connect(out); });
  const dropBus = node('createGain', (g) => { g.gain.value = 1; g.connect(dropLP); });

  const ready = Promise.all([cache.bed('rainBed'), cache.bed('brownMono'), cache.dropKit()]).then(([bed, rumble, kit]) => {
    buffers = { bed, rumble, kit };
    applyLevels(now(), 0);
  });

  const bedLevel = () => dbToGain(params.bedGainDb + gust.gainDb) * (buffers ? buffers.bed.trim : 1);
  const rumbleLevel = () => dbToGain(params.rumbleGainDb) * (buffers ? buffers.rumble.trim : 1);

  function applyLevels(t, tau = TAU.level) {
    glideTo(bedGain.gain, bedLevel(), t, tau, 'target');
    glideTo(rumbleGain.gain, rumbleLevel(), t, tau, 'target');
    glideTo(bedLP.frequency, params.bedLpHz, t, TAU.filter, 'target');
  }

  function loopSource(buffer, destination) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(destination);
    source.start(ctx.currentTime);
    return source;
  }

  function ensureLoops() {
    if (loops) return;
    loops = { bed: loopSource(buffers.bed.buffer, bedLP), rumble: loopSource(buffers.rumble.buffer, rumbleLP) };
  }

  function spawn(drop) {
    if (drops.size >= MAX_LIVE_DROPS) return;
    const source = ctx.createBufferSource();
    source.buffer = buffers.kit[drop.variant % buffers.kit.length];
    source.playbackRate.value = drop.rate;
    const level = ctx.createGain();
    level.gain.value = drop.gain;
    source.connect(level);
    level.connect(dropBus);
    source.onended = () => {
      source.disconnect();
      level.disconnect();
      drops.delete(source);
    };
    source.start(drop.at);
    drops.add(source);
  }

  const planner = {
    plannedUpTo: 0,
    plan(from, to) {
      gust = gustWalk(gust, to - from, rng);
      glideTo(bedGain.gain, bedLevel(), from, TAU.gust, 'target');
      return planDrops(rng, from, to, params, gust, { variants: buffers.kit.length });
    },
    apply: spawn,
  };

  function stopDrops(t) {
    for (const source of drops) source.stop(t);
  }

  /** Retunes bed, rumble, low-pass, drop rate and gust span for intensity s. */
  function setIntensity(s) {
    params = rainParams(s);
    gust = { ...gust, spanDb: params.gustSpanDb };
    applyLevels(now());
  }

  /** Starts (once buffers exist) and fades in over 1.5 s; resolves true when this call started it, false when it already ran or was stopped meanwhile. */
  function start() {
    if (running) return ready.then(() => false);
    running = true;
    return ready.then(() => {
      if (!running) return false;
      ensureLoops();
      planner.plannedUpTo = 0;
      scheduler.add(planner);
      fade(out.gain, out.gain.value, 1, now(), FADE_IN_SECONDS, 'scurve');
      return true;
    });
  }

  /** Fades out over `seconds`, stops planning and ends the drops in flight; the beds keep looping silently. */
  function stop({ seconds = FADE_OUT_SECONDS } = {}) {
    running = false;
    scheduler.remove(planner);
    const t = now();
    fade(out.gain, out.gain.value, 0, t, seconds, 'equalPowerOut');
    stopDrops(t + seconds);
  }

  /** Stops every source and leaves the bus. */
  function dispose() {
    running = false;
    scheduler.remove(planner);
    const t = ctx.currentTime;
    stopDrops(t);
    if (loops) {
      loops.bed.stop(t);
      loops.rumble.stop(t);
      loops = null;
    }
    out.disconnect();
  }

  return { setIntensity, start, stop, dispose, ready, get running() { return running; } };
}
