// Ocean model: intensity curves and the per-wave automation bundle (§5, §6.4 of the
// plan), shaped since 0.4 by the set energy of the session texture (core/texture-model.js):
// sets of bigger, slower-swelling waves then a lull, a sound-design reading of
// Longuet-Higgins 1984 and Goda 2010. Pure: the RNG is injected and times are context
// seconds passed in. Event format: { param, at, kind: 'set'|'linear'|'exp'|'target', value, timeConstant? }.

import { randRange } from './rng.js';
import { bedGainDb, crashPeakDb, dbToGain } from './levels.js';
import { setScales } from './texture-model.js';

/** Automation parameters a wave bundle drives, in the names audio/ocean.js maps to nodes. */
export const WAVE_PARAMS = Object.freeze(['swellLP', 'swellGain', 'crashBP', 'crashGain', 'washHP', 'washGain', 'pan']);

/** Shortest wave period, seconds (the scene never gets wave events closer than this). */
export const MIN_WAVE_PERIOD = 6;

const SWELL_RISE_STEPS = 8;
const SWELL_RELEASE_DELAY = 0.3;
const SWELL_RELEASE_TAU = 0.6;
const CRASH_LEAD = 0.2;
const CRASH_SWEEP = 1.6;
const CRASH_ATTACK = 0.25;
const WASH_DELAY = 0.3;
const WASH_ATTACK = 0.5;
const PAN_SETTLE = 4;

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const event = (param, kind, value, at, timeConstant) =>
  timeConstant === undefined ? { param, at, kind, value } : { param, at, kind, value, timeConstant };

/** Ocean parameters for intensity i in 0..1: surf bed −14 + 6i dB with a 1/f sway up to 3 dB below it, wave period in [max(6, 8 − 2i), 14 − 2i], swell, crash and wash recipes and the pan window. */
export function oceanParams(i) {
  const x = clamp01(i);
  return {
    surfGainDb: bedGainDb('surf', x),
    surfSway: { depthDb: 3 },
    periodRange: [Math.max(MIN_WAVE_PERIOD, 8 - 2 * x), 14 - 2 * x],
    swell: { Tb: [2.5, 4], lpFrom: 250, lpTo: 700 + 700 * x, peakDb: -12 + 6 * x },
    crash: { bpFrom: 2600, bpTo: 800, Q: 0.8, peakDb: crashPeakDb(x), release: 0.6 + 0.4 * x },
    wash: { hpFrom: 1800, hpTo: 350, Tw: 3 + 3 * x, peakDb: -10 + 6 * x },
    pan: [-0.35, 0.35],
  };
}

/**
 * One wave starting at t0 at set energy `set` (0 lull … 1 top of a set, setScales): period U(range)·scale (never below
 * 6 s), swell over Tb = U(2.5, 4)·scale s, crash at t0 + Tb − 0.2, wash from 0.3 s after the crash for Tw·scale, every
 * peak at its recipe level plus ampDb (−5.2 … 0 dB, so a crest never exceeds the recipe), pan p0 drifting to −p0/2
 * → { events (sorted by at), nextStart, visual: { at: crash time, duration: wash length, strength: set } }.
 */
export function planWave(rng, t0, params, { set = 0.5 } = {}) {
  const scales = setScales(set);
  const louder = (recipe) => ({ ...recipe, peakDb: recipe.peakDb + scales.ampDb });
  const period = Math.max(MIN_WAVE_PERIOD, randRange(rng, params.periodRange[0], params.periodRange[1]) * scales.period);
  const Tb = randRange(rng, params.swell.Tb[0], params.swell.Tb[1]) * scales.swell;
  const tCrash = t0 + Tb - CRASH_LEAD;
  const tWash = tCrash + WASH_DELAY;
  const p0 = randRange(rng, params.pan[0], params.pan[1]);
  const wash = { ...louder(params.wash), Tw: params.wash.Tw * scales.wash };
  const events = [
    ...swellEvents(t0, Tb, louder(params.swell)),
    ...crashEvents(tCrash, louder(params.crash)),
    ...washEvents(tWash, wash),
    event('pan', 'set', p0, t0),
    event('pan', 'linear', -0.5 * p0, t0 + Tb + PAN_SETTLE),
  ].sort((a, b) => a.at - b.at);
  return { events, nextStart: t0 + period, visual: { at: tCrash, duration: wash.Tw, strength: set } };
}

function swellEvents(t0, Tb, swell) {
  const peak = dbToGain(swell.peakDb);
  const rise = Array.from({ length: SWELL_RISE_STEPS }, (_, k) => {
    const x = (k + 1) / SWELL_RISE_STEPS;
    return event('swellGain', 'linear', peak * (0.5 - 0.5 * Math.cos(Math.PI * x)), t0 + Tb * x);
  });
  return [
    event('swellLP', 'set', swell.lpFrom, t0),
    event('swellLP', 'linear', swell.lpTo, t0 + Tb),
    event('swellGain', 'set', 0, t0),
    ...rise,
    event('swellGain', 'target', 0, t0 + Tb + SWELL_RELEASE_DELAY, SWELL_RELEASE_TAU),
  ];
}

function crashEvents(tc, crash) {
  return [
    event('crashBP', 'set', crash.bpFrom, tc),
    event('crashBP', 'exp', crash.bpTo, tc + CRASH_SWEEP),
    event('crashGain', 'set', 0, tc),
    event('crashGain', 'linear', dbToGain(crash.peakDb), tc + CRASH_ATTACK),
    event('crashGain', 'target', 0, tc + CRASH_ATTACK, crash.release),
  ];
}

function washEvents(tw, wash) {
  return [
    event('washHP', 'set', wash.hpFrom, tw),
    event('washHP', 'exp', wash.hpTo, tw + wash.Tw),
    event('washGain', 'set', 0, tw),
    event('washGain', 'linear', dbToGain(wash.peakDb), tw + WASH_ATTACK),
    event('washGain', 'target', 0, tw + WASH_ATTACK, wash.Tw / 3),
  ];
}
