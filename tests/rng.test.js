import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, randRange, logUniform, expInterval, pickWeighted } from '../docs/js/core/rng.js';

const draws = (rng, n) => Array.from({ length: n }, () => rng());
const mean = (xs) => xs.reduce((sum, v) => sum + v, 0) / xs.length;

test('mulberry32 is deterministic by seed and differs between seeds', () => {
  assert.deepEqual(draws(mulberry32(42), 1000), draws(mulberry32(42), 1000));
  assert.notDeepEqual(draws(mulberry32(42), 1000), draws(mulberry32(43), 1000));
});

test('10^5 draws lie in [0, 1) with mean 0.5 ± 0.01', () => {
  const rng = mulberry32(7);
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  for (let i = 0; i < 1e5; i++) {
    const u = rng();
    min = Math.min(min, u);
    max = Math.max(max, u);
    sum += u;
  }
  assert.ok(min >= 0 && max < 1, `range [${min}, ${max}] escapes [0, 1)`);
  assert.ok(Math.abs(sum / 1e5 - 0.5) < 0.01, `mean ${sum / 1e5}`);
});

test('randRange stays within [a, b)', () => {
  const rng = mulberry32(3);
  const xs = Array.from({ length: 1e4 }, () => randRange(rng, -2, 5));
  assert.ok(xs.every((v) => v >= -2 && v < 5));
  assert.ok(Math.abs(mean(xs) - 1.5) < 0.1);
});

test('logUniform stays within [a, b) and is uniform in log space', () => {
  const rng = mulberry32(11);
  const xs = Array.from({ length: 1e4 }, () => logUniform(rng, 0.75, 1.35));
  assert.ok(xs.every((v) => v >= 0.75 && v < 1.35));
  const logMid = (Math.log(0.75) + Math.log(1.35)) / 2;
  assert.ok(Math.abs(mean(xs.map(Math.log)) - logMid) < 0.02);
});

test('expInterval has mean ≈ 1/λ ± 5 % over 10^5 draws and is never negative', () => {
  const rng = mulberry32(5);
  const lambda = 12;
  let sum = 0;
  let min = Infinity;
  for (let i = 0; i < 1e5; i++) {
    const t = expInterval(rng, lambda);
    sum += t;
    min = Math.min(min, t);
  }
  assert.ok(min >= 0);
  assert.ok(Math.abs(sum / 1e5 - 1 / lambda) < 0.05 / lambda, `mean ${sum / 1e5}`);
});

test('pickWeighted: r = 0 → first positive key, r → 1 → last positive key', () => {
  assert.equal(pickWeighted({ a: 0, b: 2, c: 1 }, 0), 'b');
  assert.equal(pickWeighted({ a: 1, b: 2, c: 0 }, 1 - 1e-12), 'b');
  assert.equal(pickWeighted({ a: 1, b: 2, c: 0 }, 1), 'b');
  assert.equal(pickWeighted({ a: 0, b: 0 }, 0.5), undefined);
  assert.equal(pickWeighted({}, 0.5), undefined);
});

test('pickWeighted skips zero weights and matches weights within ± 2 % over 10 000 draws', () => {
  const rng = mulberry32(21);
  const weights = { a: 5, zero: 0, b: 3, c: 2 };
  const counts = { a: 0, zero: 0, b: 0, c: 0 };
  const n = 10000;
  for (let i = 0; i < n; i++) counts[pickWeighted(weights, rng())]++;
  assert.equal(counts.zero, 0);
  for (const key of ['a', 'b', 'c']) {
    const expected = weights[key] / 10;
    assert.ok(Math.abs(counts[key] / n - expected) < 0.02, `${key}: ${counts[key] / n} vs ${expected}`);
  }
});
