import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TIMBRES, timbreCoefficients, pulseCoefficients, timbreGainTrim } from '../docs/js/core/timbres.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

test('TIMBRES holds the four plan tables with a unit fundamental, frozen', () => {
  assert.deepEqual(Object.keys(TIMBRES), ['sine', 'velvet', 'glass', 'warm']);
  assert.deepEqual([...TIMBRES.sine], [1]);
  assert.deepEqual([...TIMBRES.velvet], [1, 0.32, 0.14, 0.07, 0.03, 0.015, 0.008]);
  assert.deepEqual([...TIMBRES.glass], [1, 0.04, 0.22, 0.02, 0.06, 0, 0.02]);
  assert.deepEqual([...TIMBRES.warm], [1, 0.45, 0.22, 0.12, 0.06, 0.03, 0.015, 0.008]);
  assert.ok(Object.isFrozen(TIMBRES));
  assert.ok(Object.values(TIMBRES).every((amps) => Object.isFrozen(amps)));
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

test('timbreGainTrim: sine exactly 1, the others within [0.6, 1.5]', () => {
  assert.equal(timbreGainTrim('sine'), 1);
  for (const name of ['velvet', 'glass', 'warm']) {
    const trim = timbreGainTrim(name);
    assert.ok(trim >= 0.6 && trim <= 1.5, `${name} trim ${trim}`);
    assert.notEqual(trim, 1, `${name} should differ from a sine`);
  }
  assert.throws(() => timbreGainTrim('brass'), RangeError);
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
