// Seeded noise generators and loop conditioning. Pure: no globals, RNG injected.

import { mulberry32 } from './rng.js';
import { makeBiquad } from './biquad.js';

/** Seam crossfade length used by noiseLoop (samples). */
const LOOP_FADE_SAMPLES = 4096;
/** Samples discarded so the pink/brown filter state is settled before the loop starts. */
const WARMUP_SAMPLES = { white: 0, pink: 2000, brown: 2000 };

/** Uniform draw in [-1, 1). */
function bipolar(rng) {
  return 2 * rng() - 1;
}

/** White noise: n samples uniform in [-1, 1). */
export function whiteNoise(n, rng) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = bipolar(rng);
  return out;
}

/** Pink noise (−3 dB/oct): Paul Kellet's refined filter with its 0.11 gain compensation, roughly within [-1, 1]. */
export function pinkNoise(n, rng) {
  const out = new Float32Array(n);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = bipolar(rng);
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856;
    b4 = 0.55 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.016898;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return out;
}

/** Brown noise (−6 dB/oct): leaky integrator b = (b + 0.02·w) / 1.02, output b·3.5. */
export function brownNoise(n, rng) {
  const out = new Float32Array(n);
  let b = 0;
  for (let i = 0; i < n; i++) {
    b = (b + 0.02 * bipolar(rng)) / 1.02;
    out[i] = b * 3.5;
  }
  return out;
}

/** Root-mean-square of x (0 for an empty array). */
export function rms(x) {
  if (x.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
  return Math.sqrt(sum / x.length);
}

/** Largest |x[i]|. */
function peakAbs(x) {
  let max = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > max) max = a;
  }
  return max;
}

/** Scales x in place so max|x| = peak (no-op on silence); returns x. */
export function normalize(x, peak = 0.9) {
  const max = peakAbs(x);
  if (max > 0) {
    const gain = peak / max;
    for (let i = 0; i < x.length; i++) x[i] *= gain;
  }
  return x;
}

/**
 * Makes x loop without a step: the first fadeSamples become an equal-power crossfade from the
 * time-reversed tail into the original head, so x[0] equals x[n−1] and the wrap carries the
 * tail's motion on. The blend is limited to the material's own peak, so a bounded signal such
 * as uniform white noise is not pushed above its range by the sum (a no-op for Gaussian-like
 * pink and brown noise, whose body peak is far above any blended sample). In place; returns x.
 */
export function makeLoopable(x, fadeSamples) {
  const n = x.length;
  const fade = Math.min(fadeSamples, Math.floor(n / 2));
  const limit = peakAbs(x);
  for (let i = 0; i < fade; i++) {
    const theta = (Math.PI / 2) * (i / fade);
    const blend = x[i] * Math.sin(theta) + x[n - 1 - i] * Math.cos(theta);
    x[i] = Math.max(-limit, Math.min(limit, blend));
  }
  return x;
}

const GENERATORS = { white: whiteNoise, pink: pinkNoise, brown: brownNoise };

/**
 * Seeded seamless noise loop of `seconds` at `sampleRate`: generate with mulberry32(seed) (plus a
 * discarded warm-up for pink/brown), optional biquad prefilter {type, fc, Q}, 4096-sample seam
 * crossfade, then normalise to peak 0.9.
 * @returns {Float32Array}
 */
export function noiseLoop(kind, seconds, sampleRate, seed, { prefilter } = {}) {
  const generate = GENERATORS[kind];
  if (!generate) throw new RangeError(`noiseLoop: unknown kind "${kind}"`);
  const n = Math.round(seconds * sampleRate);
  const warmup = WARMUP_SAMPLES[kind];
  const raw = generate(n + warmup, mulberry32(seed));
  const filtered = prefilter ? makeBiquad({ ...prefilter, sampleRate }).process(raw) : raw;
  const loop = warmup > 0 ? filtered.slice(warmup) : filtered;
  return normalize(makeLoopable(loop, LOOP_FADE_SAMPLES), 0.9);
}
