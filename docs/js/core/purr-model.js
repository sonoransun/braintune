// Purr model: the fixed purr recipe, the breath-cycle planner and the pet-cue envelope
// (§5, §6.4 of the plan). Since 0.4 each breath can take a slow drift from the session
// texture (tempo stretches the phases, amplitude scales the levels). Pure: the RNG is
// injected and times are context seconds.
// Event format: { param, at, kind: 'set'|'linear'|'target', value, timeConstant? }.

import { randRange } from './rng.js';

/** Purr fundamental, Hz. */
export const PURR_HZ = 26;

/** Automation parameters a breath bundle drives: 'breath' (envelope 0..1), 'rate' (×PURR_HZ), 'lp' (Hz). */
export const BREATH_PARAMS = Object.freeze(['breath', 'rate', 'lp']);

/** Level and length of the pet cue at the dedicated cue gain. */
export const CUE_PEAK = 0.25;
export const CUE_SECONDS = 2.2;

const PHASES = Object.freeze({
  inhale: { seconds: [0.7, 1.0], level: 0.75, rate: 27 / 26, lpHz: 260 },
  exhale: { seconds: [0.9, 1.3], level: 1, rate: 25 / 26, lpHz: 340 },
});
const PAUSE_SECONDS = [0.05, 0.15];
const EDGE_SECONDS = 0.08;
const EDGE_STEPS = 4;
const CUE_SHAPE = [0.3, 1.2, 0.7];

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const event = (param, kind, value, at) => ({ param, at, kind, value });
const raisedCosine = (x) => 0.5 - 0.5 * Math.cos(Math.PI * x);

/** Purr recipe: 26 Hz gate (duty .45, ramp .25, depth .9), low-pass 300 Hz, pulse oscillator at −10 dB, bus −12 dBFS RMS at full breath; `level` scales the breath amplitude. */
export function purrParams(level = 1) {
  return { hz: PURR_HZ, duty: 0.45, ramp: 0.25, depth: 0.9, lpHz: 300, oscDb: -10, busDb: -12, amplitude: clamp01(level) };
}

/**
 * One breath from t0: inhale U(0.7, 1.0)·tempo s at 0.75·A (rate 27/26, lp 260 Hz), exhale U(0.9, 1.3)·tempo s at A
 * (rate 25/26, lp 340 Hz), then a U(0.05, 0.15)·tempo s pause, with A = params.amplitude · drift amplitude; each phase is a
 * raised-cosine-edged plateau (80 ms edges) that starts and ends at 0 → { events sorted by at, nextStart, phases }.
 * Without a drift (tempo 1, amplitude 1) the events are exactly those of 0.3.
 */
export function planBreath(rng, t0, params, { tempo = 1, amplitude: depth = 1 } = {}) {
  const amplitude = (params.amplitude ?? 1) * depth;
  const inhale = randRange(rng, PHASES.inhale.seconds[0], PHASES.inhale.seconds[1]) * tempo;
  const exhale = randRange(rng, PHASES.exhale.seconds[0], PHASES.exhale.seconds[1]) * tempo;
  const pause = randRange(rng, PAUSE_SECONDS[0], PAUSE_SECONDS[1]) * tempo;
  const tExhale = t0 + inhale;
  const events = [
    ...phaseEvents(t0, inhale, PHASES.inhale, PHASES.exhale, amplitude),
    ...phaseEvents(tExhale, exhale, PHASES.exhale, PHASES.inhale, amplitude),
  ].sort((a, b) => a.at - b.at);
  return { events, nextStart: tExhale + exhale + pause, phases: { inhale, exhale, pause } };
}

/** The pet cue on the 'cue' param: 0 → CUE_PEAK over 0.3 s, hold 1.2 s, back to 0 over 0.7 s (scaled to `seconds`), raised-cosine edges → { events, peak, endT }. */
export function cueEnvelope(t0, seconds = CUE_SECONDS) {
  const scale = seconds / CUE_SECONDS;
  const [rise, hold, fall] = CUE_SHAPE.map((s) => s * scale);
  const events = [
    event('cue', 'set', 0, t0),
    ...edge(t0, rise, 0, CUE_PEAK, 'cue'),
    ...edge(t0 + rise + hold, fall, CUE_PEAK, 0, 'cue'),
  ];
  return { events, peak: CUE_PEAK, endT: t0 + seconds };
}

function phaseEvents(start, seconds, phase, previous, amplitude) {
  const level = phase.level * amplitude;
  const edgeSeconds = Math.min(EDGE_SECONDS, seconds / 2);
  return [
    event('breath', 'set', 0, start),
    ...edge(start, edgeSeconds, 0, level, 'breath'),
    ...edge(start + seconds - edgeSeconds, edgeSeconds, level, 0, 'breath'),
    event('rate', 'set', previous.rate, start),
    event('rate', 'linear', phase.rate, start + edgeSeconds),
    event('lp', 'set', previous.lpHz, start),
    event('lp', 'linear', phase.lpHz, start + edgeSeconds),
  ];
}

/** Raised-cosine edge from `from` to `to` over `seconds` as EDGE_STEPS linear breakpoints. */
function edge(start, seconds, from, to, param) {
  return Array.from({ length: EDGE_STEPS }, (_, k) => {
    const x = (k + 1) / EDGE_STEPS;
    return event(param, 'linear', from + (to - from) * raisedCosine(x), start + seconds * x);
  });
}
