import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hash01, subSeed, vossStep, vossTickTime, createVoss, valueNoise, fbm, golden, mapDb, mapRange } from '../docs/js/core/fractal.js';
import { goertzelBandEnergy, powerDb } from './helpers/dft.js';

const N = 1 << 16;
const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
const std = (x) => {
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length);
};
const pearson = (a, b) => {
  const ma = mean(a);
  const mb = mean(b);
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += (a[i] - ma) * (b[i] - mb);
    aa += (a[i] - ma) ** 2;
    bb += (b[i] - mb) ** 2;
  }
  return ab / Math.sqrt(aa * bb);
};
const series = (length, fn) => Float64Array.from({ length }, (_, i) => fn(i));
const bandDb = (x, rate, f0, f1) => powerDb(goertzelBandEnergy(x, rate, f0, f1));

test('hash01 is uniform on [0, 1) and deterministic; subSeed gives distinct seeds', () => {
  for (const seed of [1, 2, 12345]) {
    const u = series(N, (i) => hash01(seed, i));
    near(mean(u), 0.5, 0.005, `mean for seed ${seed}`);
    near(std(u), 1 / Math.sqrt(12), 0.005, `σ for seed ${seed}`);
    assert.ok(u.every((v) => v >= 0 && v < 1));
  }
  assert.equal(hash01(9, 1, 2, 3), hash01(9, 1, 2, 3));
  assert.notEqual(hash01(9, 1, 2, 3), hash01(9, 3, 2, 1), 'coordinates are not interchangeable');
  assert.notEqual(hash01(9, 1), hash01(10, 1));
  const seeds = new Set(Array.from({ length: 1000 }, (_, i) => subSeed(42, i)));
  assert.equal(seeds.size, 1000);
  assert.ok([...seeds].every((s) => Number.isInteger(s) && s >= 0 && s < 2 ** 32));
});

test('vossStep: bounded, σ about 1/3, rarely clipped, one die per step', () => {
  const bound = 2 / Math.sqrt(3 * 10) + 1e-9;
  for (const seed of [1, 2, 3]) {
    const x = series(N, (n) => vossStep(seed, n));
    assert.ok(x.every((v) => Math.abs(v) <= 1), 'within [-1, 1]');
    const sigma = std(x);
    assert.ok(sigma >= 0.3 && sigma <= 0.38, `σ ${sigma}`);
    const clipped = x.filter((v) => Math.abs(v) >= 1).length / N;
    assert.ok(clipped < 0.01, `clipped ${clipped}`);
    for (let n = 1; n < N; n++) assert.ok(Math.abs(x[n] - x[n - 1]) <= bound, `step ${n}: ${x[n] - x[n - 1]}`);
  }
});

test('vossStep is 1/f: four octaves apart the power falls 12 ± 5 dB (two band pairs, three seeds); seeds are uncorrelated', () => {
  for (const seed of [1, 2, 3]) {
    const x = series(N, (n) => vossStep(seed, n));
    const octave = (f0) => bandDb(x, 1, f0, 2 * f0);
    for (const f0 of [1 / 1024, 1 / 256]) {
      const drop = octave(16 * f0) - octave(f0);
      near(drop, -12, 5, `seed ${seed}: ${f0} → ${16 * f0} cycles per step`);
    }
  }
  for (const [a, b] of [[1, 2], [1, 101], [3, 4]]) {
    const r = pearson(series(1 << 17, (n) => vossStep(a, n)), series(1 << 17, (n) => vossStep(b, n)));
    assert.ok(Math.abs(r) < 0.08, `r(${a}, ${b}) = ${r}`);
  }
});

test('createVoss: knots strictly increasing, 3.9–8.1 s apart, the curve passes through them and is slow', () => {
  for (const seed of [7, 8, 9]) {
    const voss = createVoss({ seed });
    assert.equal(voss.slowestPeriod, 6 * 2 ** 10);
    near(voss.fastestInterval, 6 * 0.65, 1e-12);
    for (let n = 0; n < 5000; n++) {
      const gap = voss.tick(n + 1).t - voss.tick(n).t;
      assert.ok(gap >= 6 * (1 - 0.35) && gap <= 6 * (1 + 0.35), `gap ${gap} after knot ${n}`);
      near(voss.tick(n).t, vossTickTime(seed, n, 6, 0.35), 0, 'tick time');
    }
    const knots = voss.ticks(100, 400);
    assert.ok(knots.length >= 300 / 8.1 && knots.length <= 300 / 3.9 + 1);
    assert.ok(knots.every((k, i) => k.t >= 100 && k.t < 400 && (i === 0 || k.n === knots[i - 1].n + 1)), 'contiguous knots in the window');
    assert.ok(voss.tick(knots[0].n - 1).t < 100 && voss.tick(knots.at(-1).n + 1).t >= 400, 'no knot missed at either edge');
    for (const k of knots) {
      near(voss.at(k.t), k.value, 1e-12, 'the curve passes through its knots');
      assert.equal(voss.step(k.t), k.n);
      assert.equal(voss.step(k.t - 1e-6), k.n - 1);
    }
    const dt = 0.25;
    const x = series(N, (i) => voss.at(i * dt));
    for (let i = 1; i < N; i++) assert.ok(Math.abs(x[i] - x[i - 1]) <= 0.04, `change ${x[i] - x[i - 1]} at ${i * dt} s`);
    const fast = bandDb(x, 1 / dt, 0.5, 1) - bandDb(x, 1 / dt, 1 / 64, 1 / 32);
    assert.ok(fast <= -40, `energy in 0.5–1 Hz is ${fast} dB relative to 1/64–1/32 Hz`);
  }
});

test('valueNoise joins its lattice values in [-1, 1] with smoothstep', () => {
  for (let i = -3; i < 40; i++) near(valueNoise(4, 1, i), 2 * hash01(4, 1, i) - 1, 1e-12, `lattice ${i}`);
  const a = valueNoise(4, 1, 7);
  const b = valueNoise(4, 1, 8);
  near(valueNoise(4, 1, 7.5), (a + b) / 2, 1e-12, 'half way');
  for (let s = 0; s < 50; s += 0.137) assert.ok(Math.abs(valueNoise(4, 0, s)) <= 1);
});

test('fbm never clips, σ in [0.22, 0.33] for the recipes, seeds uncorrelated', () => {
  for (const [octaves, period] of [[3, 96], [4, 64], [3, 90], [3, 240], [3, 150]]) {
    for (const seed of [3, 4]) {
      const x = series(N, (i) => fbm(seed, (i * period) / 512, { octaves, period }));
      assert.ok(x.every((v) => Math.abs(v) <= 1), `octaves ${octaves} period ${period} clips`);
      const sigma = std(x);
      assert.ok(sigma >= 0.22 && sigma <= 0.33, `σ ${sigma} for octaves ${octaves}, period ${period}`);
    }
  }
  const r = pearson(series(N, (i) => fbm(subSeed(5, 1), i / 2)), series(N, (i) => fbm(subSeed(5, 2), i / 2)));
  assert.ok(Math.abs(r) < 0.1, `r ${r}`);
});

test('fbm spectral slope is 20·log10(gain) − 3.5 ± 1.5 dB/oct inside a seven-octave curve', () => {
  // A recipe of three or four octaves rolls off faster at its top octave (about −13 dB/oct overall), so the
  // per-octave gain is measured over the four interior octaves of a longer curve (1/64 → 1/4 Hz, period 64 s).
  const dt = 0.125;
  for (const gain of [0.5, 0.6, 0.7]) {
    for (const seed of [3, 4, 5]) {
      const x = series(N, (i) => fbm(seed, i * dt, { octaves: 7, period: 64, gain }));
      const slope = (bandDb(x, 1 / dt, 1 / 4, 1 / 2) - bandDb(x, 1 / dt, 1 / 64, 1 / 32)) / 4;
      near(slope, 20 * Math.log10(gain) - 3.5, 1.5, `gain ${gain}, seed ${seed} slope`);
    }
  }
});

test('golden stays in [-1, 1] and never repeats within 20 periods', () => {
  for (const seed of [5, 6]) {
    const samples = series(4000, (i) => golden(seed, i * 0.5));
    assert.ok(samples.every((v) => Math.abs(v) <= 1));
    for (let k = 1; k <= 20; k++) {
      let diff = 0;
      for (let i = 0; i < 4000; i++) diff = Math.max(diff, Math.abs(samples[i] - golden(seed, i * 0.5 + k * 70)));
      assert.ok(diff > 0.05, `seed ${seed}: x(t) and x(t + ${k}·70 s) differ by at most ${diff}`);
    }
  }
  assert.equal(golden(5, 12.3), golden(5, 12.3));
  assert.notEqual(golden(5, 12.3), golden(6, 12.3));
});

test('mapDb is ceiling-anchored and monotone; mapRange is linear', () => {
  for (const depth of [2, 3, 6]) {
    assert.equal(mapDb(1, depth), 1);
    near(mapDb(-1, depth), 10 ** (-depth / 20), 1e-12);
    assert.equal(mapDb(5, depth), 1, 'clamped above');
    near(mapDb(-5, depth), 10 ** (-depth / 20), 1e-12, 'clamped below');
    let prev = 0;
    for (let x = -1; x <= 1; x += 0.01) {
      assert.ok(mapDb(x, depth) > prev);
      prev = mapDb(x, depth);
    }
  }
  assert.equal(mapRange(-1, 0.9, 1.2), 0.9);
  assert.equal(mapRange(1, 0.9, 1.2), 1.2);
  near(mapRange(0, 0.9, 1.2), 1.05, 1e-12);
});
