// Raised-cosine amplitude gate shared by the isochronic carrier and the purr.
// Pure: no browser globals. Phases are fractions of one period, gains linear.

/** Beat at or below which the gate is softest, Hz. */
const SOFT_HZ = 12;
/** Beat at or above which the gate is hardest, Hz. */
const HARD_HZ = 30;
/** Gate edges and depth at SOFT_HZ: standard (16.5 dB swing), gentle for the sleepy presets (8 dB), and the shared shape at HARD_HZ. */
const SOFT_GATE = Object.freeze({ ramp: 0.2, depth: 0.85 });
const GENTLE_GATE = Object.freeze({ ramp: 0.3, depth: 0.6 });
const HARD_GATE = Object.freeze({ ramp: 0.35, depth: 0.45 });

const lerp = (a, b, t) => a * (1 - t) + b * t;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Gate value at phase x (periodic in 1): (1 - depth) + depth * g(x), where g rises over [0, ramp), holds 1 until duty, falls over [duty, duty + ramp) and is 0 after; needs ramp <= duty and duty + ramp <= 1. */
export function gateShape(x, { duty = 0.5, ramp, depth }) {
  const phase = x - Math.floor(x);
  return 1 - depth + depth * raisedCosine(phase, duty, ramp);
}

/** Isochronic gate parameters for a beat: duty 0.5, ramp 0.20 -> 0.35 and depth 0.85 -> 0.45 as the beat goes 12 -> 30 Hz, clamped outside; `gentle` starts from ramp 0.30 and depth 0.60 instead (halving the swing is what softens the pulse, Zwicker & Fastl ch. 10). */
export function gateParams(beatHz, { gentle = false } = {}) {
  const t = clamp01((beatHz - SOFT_HZ) / (HARD_HZ - SOFT_HZ));
  const soft = gentle ? GENTLE_GATE : SOFT_GATE;
  return { duty: 0.5, ramp: lerp(soft.ramp, HARD_GATE.ramp, t), depth: lerp(soft.depth, HARD_GATE.depth, t) };
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
