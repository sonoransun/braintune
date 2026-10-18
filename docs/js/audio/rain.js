// Rain layer (§6.4 of the plan, v0.4 spec §3.8): a pre-bandpassed pink bed behind a moving low-pass,
// a brown rumble, and Poisson drops from the 24-variant kit planned with lookahead, one buffer source
// per drop (gain and playbackRate), disconnected when it ends and capped at 30 per second by the
// model. Gusts follow the session texture: at each knot of its gust stream the bed glides (τ 2 s)
// to that gust's level, and each window's drop rate follows the gust at its start. The loop sources
// start once and keep looping silently behind `out` between start/stop, so a slider dragged through
// zero never doubles a bed.

import { dbToGain } from '../core/levels.js';
import { rainParams, planDrops, gustAt } from '../core/rain-model.js';
import { TEXTURE_RECIPE } from '../core/texture-model.js';
import { glideTo, fade } from './automation.js';

const LEAD = 0.01;
const RUMBLE_LP_HZ = 200;
const DROP_LP_HZ = 6000;
const BED_Q = 0.7;
const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 0.5;
const TAU = Object.freeze({ level: 0.125, filter: 0.08 });
/** Most drop sources alive at once (3 s of the 30/s cap). */
const MAX_LIVE_DROPS = 90;
/** Without a texture there is no wind: the bed holds its level and drops fall at the nominal rate. */
const CALM_AIR = Object.freeze({ gust: { at: () => 0 }, gustTicks: () => [] });

/** Creates the rain layer into `bus`, its gusts on `texture` (core/texture-model.js): { setIntensity(s), start() → Promise<boolean>, stop({ seconds }), dispose(), ready }. */
export function createRainLayer(ctx, bus, scheduler, cache, { rng, intensity = 0.45, texture = null } = {}) {
  const now = () => ctx.currentTime + LEAD;
  const field = texture ?? CALM_AIR;
  let params = rainParams(intensity);
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

  const gust = (t) => gustAt(field.gust.at(t), params.gustSpanDb);
  const bedLevel = (t) => dbToGain(params.bedGainDb + gust(t).gainDb) * (buffers ? buffers.bed.trim : 1);
  const rumbleLevel = () => dbToGain(params.rumbleGainDb) * (buffers ? buffers.rumble.trim : 1);

  function applyLevels(t, tau = TAU.level) {
    glideTo(bedGain.gain, bedLevel(t), t, tau, 'target');
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
      for (const { t } of field.gustTicks(from, to)) glideTo(bedGain.gain, bedLevel(t), t, TEXTURE_RECIPE.gust.tau, 'target');
      return planDrops(rng, from, to, params, gust(from), { variants: buffers.kit.length });
    },
    apply: spawn,
  };

  function stopDrops(t) {
    for (const source of drops) source.stop(t);
  }

  /** Retunes bed, rumble, low-pass, drop rate and gust span for intensity s, from the gust of this moment. */
  function setIntensity(s) {
    params = rainParams(s);
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
