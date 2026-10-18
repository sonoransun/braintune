import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gateShape, gateParams, renderGatePeriod, gatePlaybackRate } from '../docs/js/core/gate.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

const SOFT = { duty: 0.5, ramp: 0.2, depth: 0.85 };
const PURR = { duty: 0.45, ramp: 0.25, depth: 0.9 };

test('gateShape is continuous at ramp, duty and duty + ramp', () => {
  const eps = 1e-7;
  for (const params of [SOFT, PURR]) {
    for (const x of [params.ramp, params.duty, params.duty + params.ramp]) {
      near(gateShape(x - eps, params), gateShape(x + eps, params), 1e-5, `jump at ${x}`);
    }
    near(gateShape(1 - eps, params), gateShape(0, params), 1e-5, 'jump at the period seam');
  }
});

test('gateShape floor is 1 - depth, plateau is 1, rise is a raised cosine, values stay in range', () => {
  near(gateShape(0, SOFT), 0.15, 1e-12);
  for (const x of [0.7, 0.8, 0.9, 0.999]) near(gateShape(x, SOFT), 0.15, 1e-12, `floor at ${x}`);
  for (const x of [0.2, 0.3, 0.4, 0.499]) near(gateShape(x, SOFT), 1, 1e-12, `plateau at ${x}`);
  near(gateShape(0.1, SOFT), 0.15 + 0.85 * 0.5, 1e-12, 'half way up the rise');
  near(gateShape(0.6, SOFT), 0.15 + 0.85 * 0.5, 1e-12, 'half way down the fall');
  for (let i = 0; i <= 1000; i++) {
    const g = gateShape(i / 1000, SOFT);
    assert.ok(g >= 0.15 - 1e-12 && g <= 1 + 1e-12, `out of range at ${i / 1000}: ${g}`);
  }
  near(gateShape(0.3, PURR), 1, 1e-12);
  near(gateShape(0.8, PURR), 0.1, 1e-12);
});

test('gateShape is periodic in 1 and duty defaults to 0.5', () => {
  near(gateShape(1.3, SOFT), gateShape(0.3, SOFT), 1e-12);
  near(gateShape(-0.1, SOFT), gateShape(0.9, SOFT), 1e-12);
  near(gateShape(2.05, SOFT), gateShape(0.05, SOFT), 1e-12);
  assert.equal(gateShape(0.45, { ramp: 0.2, depth: 0.85 }), gateShape(0.45, SOFT));
  assert.equal(gateShape(0.55, { ramp: 0.2, depth: 0.85 }), gateShape(0.55, SOFT));
});

test('gateParams: 2 Hz -> .2/.85, 40 Hz -> .35/.45, clamped outside 12-30 Hz, monotone between', () => {
  assert.deepEqual(gateParams(2), { duty: 0.5, ramp: 0.2, depth: 0.85 });
  assert.deepEqual(gateParams(12), { duty: 0.5, ramp: 0.2, depth: 0.85 });
  assert.deepEqual(gateParams(30), { duty: 0.5, ramp: 0.35, depth: 0.45 });
  assert.deepEqual(gateParams(40), { duty: 0.5, ramp: 0.35, depth: 0.45 });
  near(gateParams(21).ramp, 0.275, 1e-12, 'ramp at the midpoint');
  near(gateParams(21).depth, 0.65, 1e-12, 'depth at the midpoint');
  let prev = gateParams(0.5);
  for (let hz = 1; hz <= 60; hz += 0.5) {
    const g = gateParams(hz);
    assert.ok(g.ramp >= prev.ramp, `ramp decreases at ${hz} Hz`);
    assert.ok(g.depth <= prev.depth, `depth increases at ${hz} Hz`);
    assert.equal(g.duty, 0.5);
    prev = g;
  }
});

test('gateParams gentle: 2 Hz -> .30/.60, 40 Hz -> .35/.45, monotone between, same duty; the default is unchanged', () => {
  const gentle = { gentle: true };
  assert.deepEqual(gateParams(2, gentle), { duty: 0.5, ramp: 0.3, depth: 0.6 });
  assert.deepEqual(gateParams(12, gentle), { duty: 0.5, ramp: 0.3, depth: 0.6 });
  assert.deepEqual(gateParams(30, gentle), { duty: 0.5, ramp: 0.35, depth: 0.45 });
  assert.deepEqual(gateParams(40, gentle), { duty: 0.5, ramp: 0.35, depth: 0.45 });
  near(20 * Math.log10(1 / (1 - gateParams(6, gentle).depth)), 7.96, 0.01, 'gentle swing at 6 Hz, dB');
  near(20 * Math.log10(1 / (1 - gateParams(6).depth)), 16.48, 0.01, 'standard swing at 6 Hz, dB');
  let prev = gateParams(0.5, gentle);
  for (let hz = 1; hz <= 60; hz += 0.5) {
    const g = gateParams(hz, gentle);
    assert.ok(g.ramp >= prev.ramp, `gentle ramp decreases at ${hz} Hz`);
    assert.ok(g.depth <= prev.depth, `gentle depth increases at ${hz} Hz`);
    assert.ok(g.depth <= gateParams(hz).depth && g.ramp >= gateParams(hz).ramp, `gentle is never harder than standard at ${hz} Hz`);
    assert.ok(g.ramp <= g.duty && g.duty + g.ramp <= 1, `gate shape constraints at ${hz} Hz`);
    prev = g;
  }
  assert.deepEqual(gateParams(6, { gentle: false }), gateParams(6));
  assert.deepEqual(gateParams(6, {}), gateParams(6));
});

test('renderGatePeriod: round(sampleRate / hz) finite samples from the floor to a plateau of 1', () => {
  const params = gateParams(10);
  const buf = renderGatePeriod(48000, 10, params);
  assert.ok(buf instanceof Float32Array);
  assert.equal(buf.length, 4800);
  let min = Infinity;
  let max = -Infinity;
  for (const v of buf) {
    assert.ok(Number.isFinite(v));
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  near(min, 1 - params.depth, 1e-6, 'min');
  near(max, 1, 1e-6, 'max');
  near(buf[0], 1 - params.depth, 1e-6, 'first sample');
  near(buf[Math.round(4800 * 0.4)], 1, 1e-6, 'plateau sample');
  assert.equal(renderGatePeriod(44100, 26, PURR).length, 1696);
  assert.equal(renderGatePeriod(48000, 7, params).length, 6857);
  assert.equal(renderGatePeriod(48000, 0.5, params).length, 96000);
});

test('gatePlaybackRate: len * hz / sampleRate, 1 for a period rendered at the same rate', () => {
  for (const [sampleRate, hz] of [[48000, 10], [44100, 26], [48000, 0.5], [96000, 40], [44100, 7.5]]) {
    const len = renderGatePeriod(sampleRate, hz, gateParams(hz)).length;
    near(gatePlaybackRate(len, hz, sampleRate), 1, 1e-3, `${hz} Hz at ${sampleRate}`);
  }
  assert.equal(gatePlaybackRate(4800, 20, 48000), 2);
  assert.equal(gatePlaybackRate(4800, 5, 48000), 0.5);
  assert.equal(gatePlaybackRate(4800, 10, 48000), 1);
});
