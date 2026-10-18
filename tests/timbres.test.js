import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIMBRES, TIMBRE_ORDER, CARRIER_LP_RATIO, timbreCoefficients, pulseCoefficients, timbreGainTrim, carrierLowpassRatio,
} from '../docs/js/core/timbres.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

/** Amplitude of partial n (1-based) of a timbre, 0 past the end of its table. */
const partial = (name, n) => TIMBRES[name][n - 1] ?? 0;

test('TIMBRES holds six tables in TIMBRE_ORDER, frozen', () => {
  assert.deepEqual([...TIMBRE_ORDER], ['sine', 'velvet', 'warm', 'amber', 'glass', 'bell']);
  assert.deepEqual(Object.keys(TIMBRES), [...TIMBRE_ORDER]);
  assert.deepEqual([...TIMBRES.sine], [1]);
  assert.deepEqual([...TIMBRES.velvet], [1, 0.32, 0.14, 0.07, 0.03, 0.015, 0.008]);
  assert.deepEqual([...TIMBRES.warm], [1, 0.45, 0.22, 0.12, 0.06, 0.03, 0.015, 0.008]);
  assert.deepEqual([...TIMBRES.amber], [1, 0.55, 0.05, 0.28, 0.04, 0.1, 0, 0.05]);
  assert.deepEqual([...TIMBRES.glass], [1, 0.04, 0.22, 0.02, 0.06, 0, 0.02]);
  assert.deepEqual([...TIMBRES.bell], [1, 0, 0.18, 0, 0.12, 0.08, 0, 0.04, 0, 0.03]);
  assert.ok([TIMBRES, TIMBRE_ORDER, CARRIER_LP_RATIO].every(Object.isFrozen));
  assert.ok(Object.values(TIMBRES).every((amps) => Object.isFrozen(amps)));
});

test('every table: unit fundamental, at most 12 partials in [0, 1], seventh partial at most 0.1', () => {
  for (const name of TIMBRE_ORDER) {
    const amps = TIMBRES[name];
    assert.equal(amps[0], 1, `${name} fundamental`);
    assert.ok(amps.length <= 12, `${name} has ${amps.length} partials`);
    assert.ok(amps.every((a) => a >= 0 && a <= 1), `${name} amplitudes`);
    assert.ok(partial(name, 7) <= 0.1, `${name} seventh partial ${partial(name, 7)} would clash with the pad's fifth`);
  }
});

test('amber keeps partials 2 and 4 above 3 and drops 7; bell is sparse (nothing at 2, 4, 7, 9)', () => {
  assert.ok(partial('amber', 2) > partial('amber', 3), 'amber a2 > a3');
  assert.ok(partial('amber', 4) > partial('amber', 3), 'amber a4 > a3');
  assert.equal(partial('amber', 7), 0);
  for (const n of [2, 4, 7, 9]) assert.equal(partial('bell', n), 0, `bell partial ${n}`);
  for (const n of [1, 3, 5, 6, 8, 10]) assert.ok(partial('bell', n) > 0, `bell partial ${n}`);
});

test('timbreCoefficients: Float32 real zeros and imag with imag[0] = 0, both n + 1 long', () => {
  for (const [name, amps] of Object.entries(TIMBRES)) {
    const { real, imag } = timbreCoefficients(name);
    assert.ok(real instanceof Float32Array && imag instanceof Float32Array, name);
    assert.equal(real.length, amps.length + 1, `${name} real length`);
    assert.equal(imag.length, amps.length + 1, `${name} imag length`);
    assert.ok(real.every((v) => v === 0), `${name} real not all zero`);
    assert.equal(imag[0], 0, `${name} imag[0]`);
    amps.forEach((a, i) => assert.equal(imag[i + 1], Math.fround(a), `${name} partial ${i + 1}`));
  }
  assert.throws(() => timbreCoefficients('brass'), RangeError);
});

test('timbreGainTrim: sine exactly 1, amber 1.05 and bell 0.95, every other within [0.6, 1.5]', () => {
  assert.equal(timbreGainTrim('sine'), 1);
  for (const name of TIMBRE_ORDER.slice(1)) {
    const trim = timbreGainTrim(name);
    assert.ok(trim >= 0.6 && trim <= 1.5, `${name} trim ${trim}`);
    assert.notEqual(trim, 1, `${name} should differ from a sine`);
  }
  near(timbreGainTrim('amber'), 1.05, 0.01, 'amber trim');
  near(timbreGainTrim('bell'), 0.95, 0.01, 'bell trim');
  assert.throws(() => timbreGainTrim('brass'), RangeError);
});

test('carrierLowpassRatio: 4 by default, 7 for bell, RangeError for an unknown timbre', () => {
  assert.deepEqual({ ...CARRIER_LP_RATIO }, { default: 4, bell: 7 });
  for (const name of TIMBRE_ORDER) assert.equal(carrierLowpassRatio(name), name === 'bell' ? 7 : 4, name);
  for (const bad of ['brass', 'default', 'toString', '__proto__', undefined]) {
    assert.throws(() => carrierLowpassRatio(bad), RangeError, String(bad));
  }
});

test('pulseCoefficients: 43 entries by default, imag[k] = k^-0.7 strictly decreasing, duty ignored', () => {
  const { real, imag } = pulseCoefficients();
  assert.equal(imag.length, 43);
  assert.equal(real.length, 43);
  assert.ok(real.every((v) => v === 0));
  assert.equal(imag[0], 0);
  assert.equal(imag[1], 1);
  for (let k = 2; k < imag.length; k++) {
    assert.ok(imag[k] < imag[k - 1], `not decreasing at ${k}`);
    near(imag[k], k ** -0.7, 1e-6, `partial ${k}`);
  }
  assert.deepEqual(pulseCoefficients(0.5), pulseCoefficients(0.2));
  assert.equal(pulseCoefficients(0.2, 8).imag.length, 9);
});
