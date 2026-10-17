// Raised-cosine amplitude gate shared by the isochronic carrier and the purr.
// Pure: no browser globals. Phases are fractions of one period, gains linear.

/** Beat at or below which the gate is softest, Hz. */
const SOFT_HZ = 12;
/** Beat at or above which the gate is hardest, Hz. */
const HARD_HZ = 30;

const lerp = (a, b, t) => a * (1 - t) + b * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Gate value at phase x (periodic in 1): (1 - depth) + depth * g(x), where g rises over [0, ramp), holds 1 until duty, falls over [duty, duty + ramp) and is 0 after; needs ramp <= duty and duty + ramp <= 1. */
export function gateShape(x, { duty = 0.5, ramp, depth }) {
  const phase = x - Math.floor(x);
  return 1 - depth + depth * raisedCosine(phase, duty, ramp);
}

/** Isochronic gate parameters for a beat: duty 0.5, ramp 0.20 -> 0.35 and depth 0.85 -> 0.45 as the beat goes 12 -> 30 Hz, clamped outside. */
export function gateParams(beatHz) {
  const t = clamp01((beatHz - SOFT_HZ) / (HARD_HZ - SOFT_HZ));
  return { duty: 0.5, ramp: lerp(0.2, 0.35, t), depth: lerp(0.85, 0.45, t) };
}

/** One gate period at `hz` as round(sampleRate / hz) samples, meant to loop as an audio buffer. */
export function renderGatePeriod(sampleRate, hz, params) {
  const length = Math.round(sampleRate / hz);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) out[i] = gateShape(i / length, params);
  return out;
}

/** playbackRate that plays a `len`-sample period at `hz` on a context running at `sampleRate`. */
export function gatePlaybackRate(len, hz, sampleRate) {
  return (len * hz) / sampleRate;
}

function raisedCosine(x, duty, ramp) {
  if (x < ramp) return 0.5 - 0.5 * Math.cos((Math.PI * x) / ramp);
  if (x < duty) return 1;
  if (x < duty + ramp) return 0.5 + 0.5 * Math.cos((Math.PI * (x - duty)) / ramp);
  return 0;
}
