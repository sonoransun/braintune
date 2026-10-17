import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../docs/js/core/rng.js';
import { whiteNoise, pinkNoise, brownNoise, normalize, makeLoopable, noiseLoop, rms } from '../docs/js/core/noise.js';
import { makeBiquad } from '../docs/js/core/biquad.js';
import { goertzelBandEnergy, powerDb } from './helpers/dft.js';

const SR = 48000;
const KINDS = ['white', 'pink', 'brown'];
const LOOPS = Object.fromEntries(KINDS.map((kind) => [kind, noiseLoop(kind, 6, SR, 1)]));

const peakAbs = (x) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const mean = (x) => x.reduce((sum, v) => sum + v, 0) / x.length;
const sine = (f, seconds = 1) => Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => Math.sin((2 * Math.PI * f * i) / SR));
const bandDb = (x, f0, f1) => powerDb(goertzelBandEnergy(x, SR, f0, f1));
/** Level difference (dB) between the 1600–3200 Hz and 100–200 Hz bands: four octaves apart. */
const fourOctaveDropDb = (x) => bandDb(x, 1600, 3200) - bandDb(x, 100, 200);

function pearson(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    sab += da * db;
    saa += da * da;
    sbb += db * db;
  }
  return sab / Math.sqrt(saa * sbb);
}

/** Steady-state amplitude gain of a biquad for a unit sine at f (first half second discarded). */
function gainAt(biquad, f) {
  biquad.reset();
  return rms(biquad.process(sine(f)).subarray(SR / 2)) * Math.SQRT2;
}

test('generators and noiseLoop return Float32Arrays of the requested length', () => {
  const rng = mulberry32(1);
  for (const gen of [whiteNoise, pinkNoise, brownNoise]) {
    const x = gen(1000, rng);
    assert.ok(x instanceof Float32Array);
    assert.equal(x.length, 1000);
  }
  assert.equal(LOOPS.white.length, 6 * SR);
  assert.equal(noiseLoop('brown', 0.5, 44100, 3).length, 22050);
});

test('whiteNoise is uniform in [-1, 1) with RMS ≈ 1/√3', () => {
  const x = whiteNoise(1e5, mulberry32(2));
  assert.ok(x.every((v) => v >= -1 && v < 1));
  const r = rms(x);
  assert.ok(r > 0.5 && r < 0.62, `rms ${r}`);
});

test('loops are finite, peak-normalised to 0.9 and near zero mean', () => {
  for (const kind of KINDS) {
    const x = LOOPS[kind];
    assert.ok(x.every(Number.isFinite), `${kind} has non-finite samples`);
    const peak = peakAbs(x);
    assert.ok(peak <= 0.9 + 1e-7 && peak > 0.9 - 1e-6, `${kind} peak ${peak}`);
    assert.ok(Math.abs(mean(x)) < 0.02, `${kind} mean ${mean(x)}`);
  }
});

test('white loop keeps its RMS in [0.5, 0.62] after the seam crossfade and normalisation', () => {
  const r = rms(LOOPS.white);
  assert.ok(r > 0.5 && r < 0.62, `rms ${r}`);
});

test('white loop is spectrally flat', () => {
  const drop = fourOctaveDropDb(LOOPS.white);
  assert.ok(Math.abs(drop) < 3, `${drop} dB over four octaves`);
});

test('pink loop falls ≈ −3 dB/octave (−12 ± 4 dB over four octaves)', () => {
  const drop = fourOctaveDropDb(LOOPS.pink);
  assert.ok(drop > -16 && drop < -8, `${drop} dB over four octaves (${drop / 4} dB/oct)`);
});

test('brown loop falls ≈ −6 dB/octave (−24 ± 6 dB over four octaves)', () => {
  const drop = fourOctaveDropDb(LOOPS.brown);
  assert.ok(drop > -30 && drop < -18, `${drop} dB over four octaves (${drop / 4} dB/oct)`);
});

test('loop seam is continuous: |x[n−1] − x[0]| < 0.05', () => {
  for (const kind of KINDS) {
    const x = LOOPS[kind];
    assert.ok(Math.abs(x[x.length - 1] - x[0]) < 0.05, `${kind} seam`);
  }
});

test('two seeds are decorrelated (|Pearson r| < 0.05)', () => {
  for (const kind of KINDS) {
    const r = pearson(LOOPS[kind], noiseLoop(kind, 6, SR, 2));
    assert.ok(Math.abs(r) < 0.05, `${kind} r = ${r}`);
  }
});

test('noiseLoop is deterministic for a seed and rejects unknown kinds', () => {
  assert.deepEqual(noiseLoop('pink', 0.25, SR, 9), noiseLoop('pink', 0.25, SR, 9));
  assert.throws(() => noiseLoop('blue', 1, SR, 1), RangeError);
});

test('prefilter is applied before the seam crossfade and normalisation', () => {
  const bed = noiseLoop('pink', 6, SR, 7, { prefilter: { type: 'bandpass', fc: 2200, Q: 0.45 } });
  const plain = noiseLoop('pink', 6, SR, 7);
  const tilt = (x) => bandDb(x, 1900, 2500) - bandDb(x, 50, 150);
  assert.ok(tilt(bed) - tilt(plain) > 10, `bandpass lifted 2.2 kHz by only ${tilt(bed) - tilt(plain)} dB`);
  assert.ok(Math.abs(peakAbs(bed) - 0.9) < 1e-6);
  assert.ok(Math.abs(bed[bed.length - 1] - bed[0]) < 0.05);
});

test('normalize scales in place to the requested peak and leaves silence alone', () => {
  const x = Float32Array.of(0.25, -0.5, 0.1);
  assert.equal(normalize(x), x);
  assert.ok(Math.abs(x[1] + 0.9) < 1e-6 && Math.abs(x[0] - 0.45) < 1e-6);
  normalize(x, 0.3);
  assert.ok(Math.abs(peakAbs(x) - 0.3) < 1e-6);
  const silence = new Float32Array(16);
  assert.equal(normalize(silence), silence);
  assert.ok(silence.every((v) => v === 0));
});

test('makeLoopable joins the ends, keeps power through the crossfade and leaves the body untouched', () => {
  const x = whiteNoise(SR, mulberry32(4));
  const before = x.slice();
  assert.equal(makeLoopable(x, 4096), x);
  assert.equal(x.length, SR);
  assert.equal(x[0], x[x.length - 1]);
  assert.deepEqual(x.subarray(4096), before.subarray(4096));
  assert.ok(peakAbs(x) <= peakAbs(before));
  const head = rms(x.subarray(0, 4096));
  const body = rms(x.subarray(4096));
  assert.ok(Math.abs(head / body - 1) < 0.1, `head rms ${head} vs body ${body}`);
});

test('rms', () => {
  assert.ok(Math.abs(rms(Float32Array.of(3, 4)) - Math.sqrt(12.5)) < 1e-6);
  assert.equal(rms(new Float32Array(0)), 0);
  assert.ok(Math.abs(rms(sine(440)) - Math.SQRT1_2) < 1e-3);
});

test('makeBiquad lowpass attenuates 4·fc by > 10 dB relative to fc/4', () => {
  const lp = makeBiquad({ type: 'lowpass', fc: 1000, Q: Math.SQRT1_2, sampleRate: SR });
  const low = gainAt(lp, 250);
  const high = gainAt(lp, 4000);
  assert.ok(Math.abs(low - 1) < 0.02, `passband gain ${low}`);
  assert.ok(20 * Math.log10(high / low) < -10, `only ${20 * Math.log10(high / low)} dB`);
});

test('makeBiquad highpass mirrors the lowpass; bandpass has 0 dB peak gain at fc', () => {
  const hp = makeBiquad({ type: 'highpass', fc: 1000, Q: Math.SQRT1_2, sampleRate: SR });
  assert.ok(Math.abs(gainAt(hp, 4000) - 1) < 0.02);
  assert.ok(20 * Math.log10(gainAt(hp, 250) / gainAt(hp, 4000)) < -10);
  const bp = makeBiquad({ type: 'bandpass', fc: 1000, Q: 0.45, sampleRate: SR });
  assert.ok(Math.abs(gainAt(bp, 1000) - 1) < 0.01, `bandpass peak gain ${gainAt(bp, 1000)}`);
  assert.ok(gainAt(bp, 100) < 0.5 && gainAt(bp, 10000) < 0.5);
});

test('makeBiquad keeps state across slices, reset() clears it, input is untouched', () => {
  const bq = makeBiquad({ type: 'lowpass', fc: 500, Q: 1, sampleRate: SR });
  const src = whiteNoise(1000, mulberry32(5));
  const copy = src.slice();
  const whole = bq.process(src);
  assert.deepEqual(src, copy);
  assert.notDeepEqual(bq.process(src).subarray(0, 8), whole.subarray(0, 8));
  bq.reset();
  const first = bq.process(src.subarray(0, 400));
  const second = bq.process(src.subarray(400));
  assert.deepEqual(whole.subarray(0, 400), first);
  assert.deepEqual(whole.subarray(400), second);
});

test('makeBiquad rejects unknown types and impossible parameters', () => {
  assert.throws(() => makeBiquad({ type: 'notch', fc: 1000, Q: 1, sampleRate: SR }), RangeError);
  assert.throws(() => makeBiquad({ type: 'lowpass', fc: SR, Q: 1, sampleRate: SR }), RangeError);
  assert.throws(() => makeBiquad({ type: 'lowpass', fc: 1000, Q: 0, sampleRate: SR }), RangeError);
});
