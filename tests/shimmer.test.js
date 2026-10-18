import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../docs/js/core/rng.js';
import { QUALITY_TIERS } from '../docs/js/core/scene-model.js';
import {
  SHIMMER, birthRate, createPinkPacer, createSparkleField, glitterLayout, sparkleAlpha, sparklesAt, spreadScale,
} from '../docs/js/core/shimmer.js';
import { goertzelBandEnergy, powerDb } from './helpers/dft.js';

const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const LAYOUT = { w: 390, h: 520, horizonY: 312, lightX: 304 };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

/** Steps a field at 60 fps for `seconds`; returns birth times (a newborn has age 0 after its step) and the max live count. */
function run(field, seconds, { spread01 = 0.5, light01 = 0 } = {}) {
  const dt = 1 / 60;
  const births = [];
  let t = 0;
  let maxLive = 0;
  const lives = [];
  for (let i = 0; i < seconds * 60; i += 1) {
    t += dt;
    field.step(dt, t, { spread01, light01 });
    for (const s of field.sparkles) {
      if (s.age === 0) {
        births.push(t);
        lives.push(s.life);
      }
    }
    maxLive = Math.max(maxLive, field.sparkles.length);
  }
  return { births, maxLive, lives };
}

function fieldFor(tier, band, seed = 9) {
  const field = createSparkleField({ rng: mulberry32(seed), tier, band });
  field.reset(LAYOUT);
  return field;
}

test('SHIMMER tables: slots match QUALITY_TIERS glints, medium runs at 0.7 of high, the table is frozen', () => {
  for (const tier of Object.keys(QUALITY_TIERS)) assert.equal(SHIMMER.slots[tier], QUALITY_TIERS[tier].glints, tier);
  assert.deepEqual(SHIMMER.slots, { high: 14, medium: 6, low: 0, off: 0 });
  assert.deepEqual(SHIMMER.birthsPerS, { delta: 0.7, theta: 1.0, alpha: 1.6, beta: 1.6, gamma: 2.0 });
  assert.deepEqual(SHIMMER.tierRate, { high: 1, medium: 0.7, low: 0, off: 0 });
  assert.equal(SHIMMER.maxBirthsPerS, 3);
  assert.deepEqual(SHIMMER.lifeS, [1.6, 3.4]);
  assert.deepEqual(SHIMMER.pacer, { baseS: 1.25, octaves: 5 });
  assert.ok(Object.isFrozen(SHIMMER) && Object.isFrozen(SHIMMER.peakAlpha.dark));
});

test('pacer: values in [0, 1), deterministic by seed, different across seeds', () => {
  const series = (seed) => {
    const pacer = createPinkPacer({ rng: mulberry32(seed), baseS: 1.25, octaves: 5 });
    return Array.from({ length: 4000 }, (_, i) => pacer.value(i * 0.25));
  };
  const a = series(4);
  for (const v of a) assert.ok(v >= 0 && v < 1, `${v}`);
  assert.deepEqual(series(4), a);
  assert.notDeepEqual(series(5), a);
  const mean = a.reduce((s, v) => s + v, 0) / a.length;
  near(mean, 0.5, 0.05);
});

test('pacer spectrum is 1/f: −3 ± 1.5 dB per octave over 0.0125–0.2 Hz (65 536 samples at 4 Hz)', () => {
  const SR = 4;
  for (const seed of [1, 2, 3]) {
    const pacer = createPinkPacer({ rng: mulberry32(seed), baseS: 1.25, octaves: 5 });
    const x = Float64Array.from({ length: 65536 }, (_, i) => pacer.value(i / SR));
    const mean = x.reduce((s, v) => s + v, 0) / x.length;
    for (let i = 0; i < x.length; i += 1) x[i] -= mean;
    const low = powerDb(goertzelBandEnergy(x, SR, 0.0125, 0.025));
    const high = powerDb(goertzelBandEnergy(x, SR, 0.1, 0.2));
    const slope = (high - low) / 3;
    assert.ok(Math.abs(slope + 3) <= 1.5, `seed ${seed}: ${slope.toFixed(2)} dB/oct`);
  }
});

test('births never exceed 3 in any rolling second over 10 minutes at 60 fps; live sparkles ≤ slots', () => {
  for (const tier of ['high', 'medium']) {
    for (const band of BANDS) {
      const { births, maxLive } = run(fieldFor(tier, band), 600);
      assert.ok(births.length > 0, `${tier}/${band} births`);
      assert.ok(maxLive <= SHIMMER.slots[tier], `${tier}/${band}: ${maxLive} live`);
      for (let i = 0; i < births.length; i += 1) {
        let inWindow = 0;
        for (let j = i; j >= 0 && births[j] > births[i] - 1; j -= 1) inWindow += 1;
        assert.ok(inWindow <= 3, `${tier}/${band}: ${inWindow} births within 1 s at ${births[i].toFixed(2)} s`);
      }
    }
  }
});

test('every life is in [1.6, 3.4] s and log-uniform, so lives are spread rather than clustered', () => {
  const { lives } = run(fieldFor('high', 'gamma'), 600);
  assert.ok(lives.length > 500);
  for (const life of lives) assert.ok(life >= 1.6 && life <= 3.4, `${life}`);
  const short = lives.filter((l) => l < Math.sqrt(1.6 * 3.4)).length / lives.length;
  near(short, 0.5, 0.06);
});

test('sparkleAlpha: 0 at birth and at the end of life, the peak halfway, symmetric and bounded', () => {
  const s = { life: 2.4, peak: 0.27 };
  assert.equal(sparkleAlpha({ ...s, age: 0 }), 0);
  assert.equal(sparkleAlpha({ ...s, age: 2.4 }), 0);
  assert.equal(sparkleAlpha({ ...s, age: 3 }), 0);
  near(sparkleAlpha({ ...s, age: 1.2 }), 0.27);
  for (let i = 1; i < 48; i += 1) {
    const age = i * 0.05;
    const a = sparkleAlpha({ ...s, age });
    assert.ok(a > 0 && a <= 0.27 + 1e-12);
    near(a, sparkleAlpha({ ...s, age: 2.4 - age }), 1e-12);
  }
});

test('glitterLayout keeps x within ± half-width of the light and y between the horizon and the stage bottom', () => {
  const rng = mulberry32(21);
  for (let i = 0; i < 2000; i += 1) {
    const u = rng();
    const s = 2 * rng() - 1;
    const spread01 = rng();
    const { x, y, halfWidth } = glitterLayout({ ...LAYOUT, u, s, spread01 });
    assert.ok(Math.abs(x - LAYOUT.lightX) <= halfWidth + 1e-9);
    assert.ok(y >= LAYOUT.horizonY && y <= LAYOUT.h);
  }
  const width = (u, spread01) => glitterLayout({ ...LAYOUT, u, s: 1, spread01 }).halfWidth;
  assert.ok(width(0.5, 1) > width(0.5, 0.5) && width(0.5, 0.5) > width(0.5, 0), 'widens with the sea');
  assert.ok(width(1, 0.5) > width(0.3, 0.5) && width(0.3, 0.5) > width(0, 0.5), 'widens toward the viewer');
  near(width(0, 1), (LAYOUT.w * 0.05 * 1.3) / 2);
  near(width(1, 0), (LAYOUT.w * 0.22 * 0.7) / 2);
  near(spreadScale(0.25), 0.85);
  near(spreadScale(7), 1.3, 1e-12);
});

test('field sparkles lie on the path with sizes and alphas from the tables', () => {
  const field = fieldFor('high', 'gamma');
  const dt = 1 / 60;
  for (let i = 1; i <= 1800; i += 1) {
    field.step(dt, i * dt, { spread01: 0.4, light01: 0 });
    for (const s of field.sparkles) {
      const { x, y } = glitterLayout({ ...LAYOUT, u: s.u, s: s.s, spread01: 0.4 });
      near(s.x, x);
      near(s.y, y);
      assert.ok(s.len >= 5 && s.len <= 21 && s.thick >= 1.2 && s.thick <= 2.6);
      assert.ok(s.peak >= 0.12 && s.peak <= 0.3);
      near(s.alpha, sparkleAlpha(s));
    }
  }
});

test('per-band rates match the table; realised rates follow it while the caps rarely bind', () => {
  for (const band of BANDS) {
    for (const tier of ['high', 'medium']) {
      const table = SHIMMER.birthsPerS[band] * (tier === 'high' ? 1 : 0.7);
      near(birthRate({ band, tier, m: 0.5 }), table, 1e-12);
      near(birthRate({ band, tier, m: 0 }), table * 0.35, 1e-12);
      near(birthRate({ band, tier, m: 1 }), table * 1.65, 1e-12);
    }
    assert.equal(birthRate({ band, tier: 'low', m: 0.9 }), 0);
  }
  for (const band of ['delta', 'theta']) {
    const rate = run(fieldFor('high', band), 600).births.length / 600;
    near(rate, SHIMMER.birthsPerS[band], 0.1 * SHIMMER.birthsPerS[band]);
  }
  const realised = BANDS.map((band) => run(fieldFor('high', band), 600).births.length / 600);
  for (let i = 1; i < BANDS.length; i += 1) assert.ok(realised[i] >= realised[i - 1], `${BANDS[i]} ≥ ${BANDS[i - 1]}`);
  for (const [i, band] of BANDS.entries()) assert.ok(realised[i] <= SHIMMER.birthsPerS[band] * 1.1, band);
});

test('low and off tiers never birth', () => {
  for (const tier of ['low', 'off']) {
    for (const band of BANDS) {
      const { births, maxLive } = run(fieldFor(tier, band), 120);
      assert.equal(births.length, 0);
      assert.equal(maxLive, 0);
    }
  }
});

test('light theme peaks come from the light range', () => {
  const field = fieldFor('high', 'alpha');
  const dt = 1 / 60;
  for (let i = 1; i <= 1800; i += 1) {
    field.step(dt, i * dt, { spread01: 0.5, light01: 1 });
    for (const s of field.sparkles) assert.ok(s.peak >= 0.1 - 1e-12 && s.peak <= 0.24 + 1e-12, `${s.peak}`);
  }
});

test('sparklesAt (renderFrame) rebuilds the same sparkle list for the same time, and moves on with time', () => {
  const opts = { tier: 'high', band: 'gamma', layout: LAYOUT, tS: 123.4, spread01: 0.3, light01: 0 };
  const a = sparklesAt(77, opts);
  assert.ok(a.length > 0, 'ten seconds of gamma leave live sparkles');
  assert.deepEqual(sparklesAt(77, opts), a);
  assert.notDeepEqual(sparklesAt(77, { ...opts, tS: 140.2 }), a);
  assert.notDeepEqual(sparklesAt(78, opts), a);
  assert.deepEqual(sparklesAt(77, { ...opts, tier: 'low' }), []);
});
