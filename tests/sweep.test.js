import test from 'node:test';
import assert from 'node:assert/strict';
import { sweepLeg, sweepValueAt } from '../docs/js/core/sweep.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('sweepLeg: leg index and phase, negative elapsed clamps to the start', () => {
  assert.deepEqual(sweepLeg(0, 60), { leg: 0, phase: 0 });
  assert.deepEqual(sweepLeg(-5, 60), { leg: 0, phase: 0 });
  assert.deepEqual(sweepLeg(30, 60), { leg: 0, phase: 0.5 });
  assert.deepEqual(sweepLeg(60, 60), { leg: 1, phase: 0 });
  assert.deepEqual(sweepLeg(150, 60), { leg: 2, phase: 0.5 });
  assert.throws(() => sweepLeg(1, 0), RangeError);
  assert.throws(() => sweepLeg(1, -2), RangeError);
});

test('ping-pong: even legs run from → to, odd legs back, continuous at every boundary', () => {
  for (const kind of ['exp', 'lin']) {
    near(sweepValueAt(0, 180, 520, 60, kind), 180);
    near(sweepValueAt(60, 180, 520, 60, kind), 520);
    near(sweepValueAt(120, 180, 520, 60, kind), 180);
    near(sweepValueAt(180, 180, 520, 60, kind), 520);
    for (const boundary of [60, 120, 180, 240]) {
      const before = sweepValueAt(boundary - 1e-6, 180, 520, 60, kind);
      const after = sweepValueAt(boundary + 1e-6, 180, 520, 60, kind);
      assert.ok(Math.abs(before - after) < 1e-3, `${kind} jump at ${boundary}: ${before} vs ${after}`);
    }
    for (let t = 0; t < 240; t += 0.5) {
      const v = sweepValueAt(t, 180, 520, 60, kind);
      assert.ok(v >= 180 - 1e-9 && v <= 520 + 1e-9, `${kind} out of bounds at ${t}: ${v}`);
    }
  }
});

test('negative elapsed returns fromHz; descending sweeps stay in bounds', () => {
  assert.equal(sweepValueAt(-3, 180, 520, 60), 180);
  assert.equal(sweepValueAt(-3, 520, 180, 60, 'lin'), 520);
  for (let t = 0; t < 100; t += 1) {
    const v = sweepValueAt(t, 520, 180, 20);
    assert.ok(v >= 180 - 1e-9 && v <= 520 + 1e-9);
  }
});

test('exponential midpoint is the geometric mean, linear midpoint the arithmetic mean', () => {
  near(sweepValueAt(30, 180, 520, 60, 'exp'), Math.sqrt(180 * 520));
  near(sweepValueAt(90, 180, 520, 60, 'exp'), Math.sqrt(180 * 520));
  near(sweepValueAt(30, 180, 520, 60, 'lin'), 350);
  near(sweepValueAt(15, 100, 1600, 60, 'exp'), 200);
  near(sweepValueAt(45, 100, 1600, 60, 'exp'), 800);
  assert.equal(sweepValueAt(10, 180, 520, 60), sweepValueAt(10, 180, 520, 60, 'exp'));
});

test('exp sweeps are monotone within a leg and increase in equal ratios per equal time', () => {
  let prev = 0;
  for (let t = 0; t <= 60; t += 1) {
    const v = sweepValueAt(t, 180, 520, 60, 'exp');
    assert.ok(v > prev);
    prev = v;
  }
  const ratioA = sweepValueAt(20, 180, 520, 60) / sweepValueAt(10, 180, 520, 60);
  const ratioB = sweepValueAt(50, 180, 520, 60) / sweepValueAt(40, 180, 520, 60);
  near(ratioA, ratioB, 1e-9);
});

test('unknown kinds throw', () => {
  assert.throws(() => sweepValueAt(1, 180, 520, 60, 'sine'), RangeError);
});
