// Level mathematics for the audio graph: dB helpers, slider tapers, limiter
// constants, makeup and ceiling gains, carrier trim, fade shapes, bed gains
// and the closed-form level budget that the tests hold every preset to.
// Pure: no browser globals. Units: Hz, seconds and linear gain unless a name
// says Db (relative decibels) or Dbfs (decibels below digital full scale).

import { timbreGainTrim } from './timbres.js';

/** Master gain at the top of the Volume slider (linear). */
export const MASTER_MAX = 0.7;

/** Peak linear amplitude of one beat voice before carrierTrim. */
export const VOICE_PEAK = 0.7;

/** Pad bus level relative to the beat voices, dB. */
export const PAD_DB = -14;

/** Output ceiling after the limiter, dBFS. */
export const CEILING_DB = -1;

/** DynamicsCompressorNode settings of the master limiter (dB and seconds). */
export const LIMITER = Object.freeze({ threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.25 });

/** Peak of every noise loop (core/noise.js normalises to 0.9). */
const NOISE_LOOP_PEAK = 0.9;
/** RMS of a pink or brown bed loop normalised to NOISE_LOOP_PEAK, dBFS (crest factor about 10 dB). */
const NOISE_BED_RMS_DB = -11;
/** Purr bus RMS at full breath, dBFS (§6.4 of the plan). */
const PURR_BUS_RMS_DB = -12;
/** Crest factor assumed for ambience beds when their peaks are summed, dB. */
const AMBIENCE_CREST_DB = 10;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v) => clamp(v, 0, 1);

/** Decibels to linear gain. */
export function dbToGain(db) {
  return 10 ** (db / 20);
}

/** Linear gain to decibels; 0 gives -Infinity. */
export function gainToDb(gain) {
  return 20 * Math.log10(gain);
}

/** Layer slider position 0..1 to linear gain: a square taper. */
export function layerGain(x) {
  return clamp01(x) ** 2;
}

/** Master slider position 0..1 to linear gain, MASTER_MAX at the top. */
export function masterGain(x) {
  return MASTER_MAX * layerGain(x);
}

/** Fixed makeup gain a DynamicsCompressorNode applies, (1 / curve(0 dBFS))^0.6 per the Web Audio spec; the closed form needs a hard knee and throws otherwise. */
export function compressorMakeupGain({ threshold, knee = 0, ratio }) {
  if (knee !== 0) throw new RangeError('compressorMakeupGain assumes a hard knee (knee = 0)');
  const curveAtFullScaleDb = threshold + (0 - threshold) / ratio;
  return (1 / dbToGain(curveAtFullScaleDb)) ** 0.6;
}

/** Gain after the limiter that puts the output ceiling at CEILING_DB once the limiter's makeup gain is counted. */
export function ceilingGain() {
  return dbToGain(CEILING_DB) / compressorMakeupGain(LIMITER);
}

/** Loudness trim of the beat voices by carrier frequency, (400 / f)^0.35 clamped to [0.8, 1.3]. */
export function carrierTrim(f) {
  return clamp((400 / f) ** 0.35, 0.8, 1.3);
}

const FADE_SHAPES = {
  linear: (x) => x,
  scurve: (x) => x * x * (3 - 2 * x),
  equalPowerIn: (x) => Math.sin((x * Math.PI) / 2),
  equalPowerOut: (x) => 1 - Math.cos((x * Math.PI) / 2),
};

/** n + 1 values from `from` to `to` along 'scurve' (smoothstep), 'equalPowerIn' (sin), 'equalPowerOut' (cos) or 'linear'; endpoints exact, n >= 1. */
export function fadeBreakpoints(from, to, n = 32, shape = 'scurve') {
  const curve = FADE_SHAPES[shape];
  if (!curve) throw new RangeError(`Unknown fade shape: ${shape}`);
  const out = new Float32Array(n + 1);
  for (let i = 1; i < n; i++) out[i] = from + (to - from) * curve(i / n);
  out[0] = from;
  out[n] = to;
  return out;
}

/** Equal-power crossfade gains at progress x in [0, 1]: fadeIn = sin(x*pi/2), fadeOut = cos(x*pi/2), so fadeIn^2 + fadeOut^2 = 1. */
export function equalPower(x) {
  const angle = (clamp01(x) * Math.PI) / 2;
  return { fadeIn: Math.sin(angle), fadeOut: Math.cos(angle) };
}

const BED_GAIN_DB = {
  rain: (s) => -14 + 14 * s,
  rumble: (s) => -36 + 20 * s * s,
  surf: (i) => -14 + 6 * i,
};

/** Bed gain in dB for an intensity 0..1: 'rain' -14 + 14s, 'rumble' -36 + 20s^2, 'surf' -14 + 6i. */
export function bedGainDb(kind, x) {
  const curve = BED_GAIN_DB[kind];
  if (!curve) throw new RangeError(`Unknown bed kind: ${kind}`);
  return curve(x);
}

/** Static limiter curve: output dBFS for a peak at `inDb` through the limiter (hard knee, attack ignored), its makeup gain and the ceiling gain. */
export function limiterOutputDb(inDb) {
  const { threshold, ratio } = LIMITER;
  const post = postLimiterDb();
  if (inDb <= threshold) return inDb + post;
  return threshold + (inDb - threshold) / ratio + post;
}

/**
 * Closed-form level budget of the §6.1 graph in dBFS per ear (§6.6).
 * `mix` holds slider positions 0..1 for master, tone, rain, ocean and purr; a
 * muted layer is passed as 0 (its figure becomes -Infinity and it adds
 * nothing to the sum); a missing layer counts as 0 and a missing master as 1.
 * Assumptions: toneDbfsPeak is the sine-equivalent peak of one beat voice (a
 * binaural ear, or the isochronic carrier at its gate plateau) at
 * VOICE_PEAK * carrierTrim, without the pad (PAD_DB) or monaural summing;
 * timbres are loudness-equalised by timbreGainTrim, so they are as loud as
 * this sine while their true peak is this times timbreGainTrim(timbre), which
 * is what enters the sum; the rain and ocean beds are noise loops of RMS
 * -11 dBFS at 0 dB bed gain, with drops and rumble left out; the ocean crest
 * is the white loop's 0.9 peak through the crash gain (-6 + 6i dB); the purr
 * bus is -12 dBFS RMS at full breath; sumPeakDbfs adds the layers' linear
 * peaks coherently (ambience peaks taken as RMS + 10 dB, ocean at its crest)
 * before the limiter and passes the sum through limiterOutputDb, so every
 * figure includes the makeup and ceiling gains (-1.0 dB together).
 */
export function levelBudget({ mix, carrierHz, rainIntensity, oceanIntensity, timbre = 'sine' }) {
  const { master = 1, tone = 0, rain = 0, ocean = 0, purr = 0 } = mix;
  const masterDb = gainToDb(masterGain(master));
  const chain = (slider) => gainToDb(layerGain(slider)) + masterDb;
  const post = postLimiterDb();

  const tonePeak = gainToDb(VOICE_PEAK * carrierTrim(carrierHz)) + chain(tone);
  const rainRms = NOISE_BED_RMS_DB + bedGainDb('rain', rainIntensity) + chain(rain);
  const oceanBedRms = NOISE_BED_RMS_DB + bedGainDb('surf', oceanIntensity) + chain(ocean);
  const oceanCrestPeak = gainToDb(NOISE_LOOP_PEAK) + crashPeakDb(oceanIntensity) + chain(ocean);
  const purrRms = PURR_BUS_RMS_DB + chain(purr);

  const sumPeak =
    dbToGain(tonePeak) * timbreGainTrim(timbre) +
    dbToGain(rainRms + AMBIENCE_CREST_DB) +
    dbToGain(oceanCrestPeak) +
    dbToGain(purrRms + AMBIENCE_CREST_DB);

  return {
    toneDbfsPeak: tonePeak + post,
    rainDbfsRms: rainRms + post,
    oceanBedDbfsRms: oceanBedRms + post,
    oceanCrestDbfsPeak: oceanCrestPeak + post,
    purrDbfsRms: purrRms + post,
    sumPeakDbfs: limiterOutputDb(gainToDb(sumPeak)),
  };
}

/** Makeup plus ceiling gain in dB: CEILING_DB (-1.0) by construction. */
function postLimiterDb() {
  return gainToDb(compressorMakeupGain(LIMITER)) + gainToDb(ceilingGain());
}

/** Peak of the ocean crash gain, dB (ocean-model crash.peakDb = -6 + 6i, §6.4). */
function crashPeakDb(intensity) {
  return -6 + 6 * intensity;
}
