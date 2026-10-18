// Rain model: intensity curves, Poisson drop planning and the offline-rendered drop kit
// (§5, §6.4 of the plan). Gusts come from the session texture since 0.4: gustAt (re-exported
// from core/texture-model.js) turns its 1/f gust curve into a bed offset within ±gustSpanDb
// and a drop-rate scale. Pure: RNG and sample rate are injected. Units: Hz, seconds and
// linear gain unless a name says Db.

import { expInterval, logUniform, randRange } from './rng.js';
import { makeBiquad } from './biquad.js';
import { whiteNoise, normalize } from './noise.js';
import { bedGainDb, dbToGain, gainToDb } from './levels.js';

export { gustAt } from './texture-model.js';

/** Most drops per second; above this the intensity goes into the bed. */
export const MAX_DROP_RATE = 30;
/** Drop variants in the kit: the first round(35 %) are plinks, the rest patter. */
export const KIT_VARIANTS = 24;
/** Longest drop sample, seconds. */
export const MAX_DROP_SECONDS = 0.13;

const DROP_PEAK = 0.9;
const PLINK_SHARE = 0.35;
const DROP_LEVEL_DB = [-18, -6];
const DROP_RATE_RANGE = [0.75, 1.35];
const PAN_RANGE = 0.8;
const END_TAPER_SECONDS = 0.002;

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Rain parameters for intensity s in 0..1: drop rate min(30, 2 + 28s²), bed −14 + 14s dB with its low-pass at 2500 + 5500s Hz, rumble −36 + 20s² dB, drop level window [−18, −6] dB shifted by 20·log10(0.5 + 0.5s), drop playback rate window and the gust span ±(1 + 2s) dB. */
export function rainParams(s) {
  const x = clamp01(s);
  const levelShiftDb = gainToDb(0.5 + 0.5 * x);
  return {
    dropRate: Math.min(MAX_DROP_RATE, 2 + 28 * x * x),
    bedGainDb: bedGainDb('rain', x),
    bedLpHz: 2500 + 5500 * x,
    rumbleGainDb: bedGainDb('rumble', x),
    dropLevelDb: [DROP_LEVEL_DB[0] + levelShiftDb, DROP_LEVEL_DB[1] + levelShiftDb],
    dropRateRange: [...DROP_RATE_RANGE],
    gustSpanDb: 1 + 2 * x,
  };
}

/** Poisson drops in [fromT, toT) at min(30, dropRate · gust.rateScale) per second: [{ at, variant, gain, rate }] sorted by at, gain log-uniform in the level window, rate log-uniform in the rate window. */
export function planDrops(rng, fromT, toT, params, gust = { rateScale: 1 }, { variants = KIT_VARIANTS } = {}) {
  const lambda = Math.min(MAX_DROP_RATE, params.dropRate * gust.rateScale);
  const drops = [];
  if (!(lambda > 0) || !(toT > fromT)) return drops;
  const [lowDb, highDb] = params.dropLevelDb;
  const [rateLow, rateHigh] = params.dropRateRange;
  for (let t = fromT + expInterval(rng, lambda); t < toT; t += expInterval(rng, lambda)) {
    drops.push({
      at: t,
      variant: Math.floor(rng() * variants),
      gain: dbToGain(randRange(rng, lowDb, highDb)),
      rate: logUniform(rng, rateLow, rateHigh),
    });
  }
  return drops;
}

/** One stereo drop: a 'plink' (sine gliding 1.6·f0 → f0 over 12 ms, f0 log-uniform 1.2–3.6 kHz, 1 ms attack, τ 6–25 ms) or 'patter' (white noise through a 2–6 kHz bandpass, 0.5 ms attack, τ 4–14 ms), peak 0.9, constant-power pan within ±0.8, at most 130 ms → { kind, pan, channels: [left, right] }. */
export function renderDropVariant(sampleRate, rng, kind = 'patter') {
  const mono = kind === 'plink' ? renderPlink(sampleRate, rng) : renderPatter(sampleRate, rng);
  taperEnd(mono, Math.round(END_TAPER_SECONDS * sampleRate));
  normalize(mono, DROP_PEAK);
  const pan = randRange(rng, -PAN_RANGE, PAN_RANGE);
  const theta = ((pan + 1) * Math.PI) / 4;
  const gainL = Math.cos(theta);
  const gainR = Math.sin(theta);
  return { kind, pan, channels: [mono.map((v) => v * gainL), mono.map((v) => v * gainR)] };
}

/** Kind of variant i in a kit of `variants`: the first round(35 %) are plinks, the rest patter. */
export function kitVariantKind(i, variants = KIT_VARIANTS) {
  return i < Math.round(PLINK_SHARE * variants) ? 'plink' : 'patter';
}

/** The drop kit: `variants` stereo drops rendered in order with one rng, kinds by kitVariantKind. */
export function renderDropKit(sampleRate, rng, { variants = KIT_VARIANTS } = {}) {
  return Array.from({ length: variants }, (_, i) => renderDropVariant(sampleRate, rng, kitVariantKind(i, variants)));
}

function dropLength(sampleRate, attack, tau) {
  return Math.min(Math.round(MAX_DROP_SECONDS * sampleRate), Math.round((attack + 7 * tau) * sampleRate));
}

function envelope(t, attack, tau) {
  return t < attack ? t / attack : Math.exp(-(t - attack) / tau);
}

function renderPlink(sampleRate, rng) {
  const f0 = logUniform(rng, 1200, 3600);
  const tau = randRange(rng, 0.006, 0.025);
  const attack = 0.001;
  const glide = 0.012;
  const n = dropLength(sampleRate, attack, tau);
  const out = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    const f = t < glide ? f0 * 1.6 ** (1 - t / glide) : f0;
    phase += (2 * Math.PI * f) / sampleRate;
    out[i] = Math.sin(phase) * envelope(t, attack, tau);
  }
  return out;
}

function renderPatter(sampleRate, rng) {
  const fc = logUniform(rng, 2000, 6000);
  const tau = randRange(rng, 0.004, 0.014);
  const attack = 0.0005;
  const n = dropLength(sampleRate, attack, tau);
  const noise = whiteNoise(n, rng);
  for (let i = 0; i < n; i++) noise[i] *= envelope(i / sampleRate, attack, tau);
  return makeBiquad({ type: 'bandpass', fc, Q: 1, sampleRate }).process(noise);
}

/** Linear taper over the last `samples` so a capped sample never ends on a step; in place. */
function taperEnd(x, samples) {
  const n = x.length;
  const span = Math.min(samples, n);
  for (let i = 0; i < span; i++) x[n - 1 - i] *= i / span;
}
