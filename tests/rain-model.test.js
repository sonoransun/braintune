import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_DROP_RATE, KIT_VARIANTS, MAX_DROP_SECONDS,
  rainParams, gustAt, planDrops, renderDropVariant, renderDropKit, kitVariantKind,
} from '../docs/js/core/rain-model.js';
import { gustAt as textureGustAt, createTexture } from '../docs/js/core/texture-model.js';
import { mulberry32 } from '../docs/js/core/rng.js';
import { dbToGain } from '../docs/js/core/levels.js';

const SR = 48000;
const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

test('rainParams follows the plan curves and caps the drop rate at 30/s', () => {
  const quiet = rainParams(0);
  const full = rainParams(1);
  assert.equal(quiet.dropRate, 2);
  assert.equal(full.dropRate, MAX_DROP_RATE);
  assert.equal(rainParams(5).dropRate, MAX_DROP_RATE, 'intensity clamped to 1');
  near(rainParams(0.5).dropRate, 2 + 28 * 0.25, 1e-12);
  assert.equal(quiet.bedGainDb, -14);
  assert.equal(full.bedGainDb, 0);
  assert.equal(quiet.bedLpHz, 2500);
  assert.equal(full.bedLpHz, 8000);
  assert.equal(quiet.rumbleGainDb, -36);
  assert.equal(full.rumbleGainDb, -16);
  assert.deepEqual(full.dropLevelDb, [-18, -6]);
  near(quiet.dropLevelDb[0], -18 - 6.0206, 1e-3, 'drops at s = 0 are 6 dB softer');
  near(quiet.dropLevelDb[1], -6 - 6.0206, 1e-3);
  assert.deepEqual(full.dropRateRange, [0.75, 1.35]);
  assert.equal(quiet.gustSpanDb, 1);
  assert.equal(full.gustSpanDb, 3);
});

test('rainParams is monotone in intensity', () => {
  let prev = rainParams(0);
  for (let s = 0.02; s <= 1.0001; s += 0.02) {
    const p = rainParams(s);
    for (const key of ['dropRate', 'bedGainDb', 'bedLpHz', 'rumbleGainDb', 'gustSpanDb']) {
      assert.ok(p[key] >= prev[key] - 1e-12, `${key} decreases at s = ${s}`);
    }
    assert.ok(p.dropLevelDb[0] >= prev.dropLevelDb[0] - 1e-12 && p.dropLevelDb[1] >= prev.dropLevelDb[1] - 1e-12, `drop level window at s = ${s}`);
    assert.ok(p.dropRate <= MAX_DROP_RATE);
    prev = p;
  }
});

test('planDrops: a Poisson stream, sorted, inside the window, with gains and rates in range', () => {
  const rng = mulberry32(7);
  const params = rainParams(0.6);
  const windows = 100;
  let count = 0;
  for (let w = 0; w < windows; w++) {
    const from = 10 + w;
    const drops = planDrops(rng, from, from + 1, params);
    count += drops.length;
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      assert.ok(d.at >= from && d.at < from + 1, `drop at ${d.at} outside [${from}, ${from + 1})`);
      if (i > 0) assert.ok(d.at >= drops[i - 1].at, 'sorted by at');
      assert.ok(Number.isInteger(d.variant) && d.variant >= 0 && d.variant < KIT_VARIANTS, `variant ${d.variant}`);
      assert.ok(d.gain >= dbToGain(params.dropLevelDb[0]) - 1e-12 && d.gain <= dbToGain(params.dropLevelDb[1]) + 1e-12, `gain ${d.gain}`);
      assert.ok(d.rate >= 0.75 && d.rate <= 1.35, `rate ${d.rate}`);
    }
  }
  const expected = params.dropRate * windows;
  assert.ok(Math.abs(count - expected) <= 0.3 * expected, `${count} drops vs ${expected} expected`);
});

test('planDrops honours the gust rate scale and the 30/s cap, and is empty on an empty window', () => {
  const count = (params, gust, seed = 3) => {
    const rng = mulberry32(seed);
    let n = 0;
    for (let w = 0; w < 200; w++) n += planDrops(rng, w, w + 1, params, gust).length;
    return n / 200;
  };
  const params = rainParams(0.5);
  const slow = count(params, { rateScale: 0.6 });
  const fast = count(params, { rateScale: 1.4 });
  near(slow, params.dropRate * 0.6, params.dropRate * 0.6 * 0.3, 'slow gust rate');
  near(fast, params.dropRate * 1.4, params.dropRate * 1.4 * 0.3, 'fast gust rate');
  const capped = count(rainParams(1), { rateScale: 1.4 });
  assert.ok(capped <= MAX_DROP_RATE * 1.25, `capped rate ${capped} exceeds 30/s by too much`);
  assert.ok(capped >= MAX_DROP_RATE * 0.75, `capped rate ${capped} far below 30/s`);
  assert.deepEqual(planDrops(mulberry32(1), 5, 5, params), []);
  assert.deepEqual(planDrops(mulberry32(1), 5, 6, { ...params, dropRate: 0 }), []);
});

test('gustAt, re-exported from the texture model: bed offset within ±gustSpanDb and drop rate 0.6–1.4, reached at ±0.77', () => {
  assert.equal(gustAt, textureGustAt);
  for (const s of [0, 0.5, 1]) {
    const span = rainParams(s).gustSpanDb;
    for (let x = -1.2; x <= 1.2; x += 0.01) {
      const { gainDb, rateScale } = gustAt(x, span);
      assert.ok(Math.abs(gainDb) <= span + 1e-9, `gain ${gainDb} outside ±${span}`);
      assert.ok(rateScale >= 0.6 - 1e-9 && rateScale <= 1.4 + 1e-9, `rate ${rateScale}`);
    }
    near(gustAt(0.77, span).gainDb, span, 1e-12, `full gust at s = ${s}`);
    near(gustAt(-0.77, span).rateScale, 0.6, 1e-12);
  }
});

test('gusts on the texture curve: an hour of gust knots stays in bounds, uses its range and moves smoothly', () => {
  const texture = createTexture(5);
  const span = rainParams(0.35).gustSpanDb;
  const knots = texture.gustTicks(0, 3600);
  assert.ok(knots.length >= 3600 / 8.1, `${knots.length} gust knots`);
  const gains = knots.map(({ t }) => gustAt(texture.gust.at(t), span).gainDb);
  assert.ok(Math.max(...gains) > span / 2 && Math.min(...gains) < -span / 2, 'both louder and quieter gusts happen');
  for (let i = 1; i < gains.length; i++) assert.ok(Math.abs(gains[i] - gains[i - 1]) < span, 'no gust jumps across its whole span between knots');
});

test('drop kit: 24 stereo variants, 8 plinks then patter, each at most 130 ms, peak at most 0.9, finite, panned within ±0.8', () => {
  const kit = renderDropKit(SR, mulberry32(5));
  assert.equal(kit.length, KIT_VARIANTS);
  assert.equal(kit.filter((v) => v.kind === 'plink').length, 8);
  assert.ok(kit.slice(0, 8).every((v) => v.kind === 'plink') && kit.slice(8).every((v) => v.kind === 'patter'));
  for (const variant of kit) {
    const [left, right] = variant.channels;
    assert.equal(variant.channels.length, 2);
    assert.equal(left.length, right.length, 'stereo pair of equal length');
    assert.ok(left.length > 0 && left.length <= Math.round(MAX_DROP_SECONDS * SR), `length ${left.length}`);
    let peak = 0;
    for (const channel of variant.channels) {
      for (let i = 0; i < channel.length; i++) {
        assert.ok(Number.isFinite(channel[i]), 'finite samples');
        peak = Math.max(peak, Math.abs(channel[i]));
      }
    }
    assert.ok(peak <= 0.9 + 1e-6, `peak ${peak}`);
    assert.ok(peak > 0.5, `variant has energy (peak ${peak})`);
    assert.ok(Math.abs(variant.pan) <= 0.8, `pan ${variant.pan}`);
    assert.ok(Math.abs(left[left.length - 1]) === 0, 'ends on zero');
  }
});

test('kitVariantKind: the first round(35 %) of a kit are plinks; renderDropKit follows it variant by variant', () => {
  assert.deepEqual(Array.from({ length: KIT_VARIANTS }, (_, i) => kitVariantKind(i)), [...Array(8).fill('plink'), ...Array(16).fill('patter')]);
  assert.equal(kitVariantKind(0, 4), 'plink', 'round(1.4) = 1 plink in a kit of four');
  assert.equal(kitVariantKind(1, 4), 'patter');
  const rng = mulberry32(31);
  const oneByOne = Array.from({ length: KIT_VARIANTS }, (_, i) => renderDropVariant(SR, rng, kitVariantKind(i)));
  assert.deepEqual(oneByOne, renderDropKit(SR, mulberry32(31)), 'the same kit whether rendered at once or one variant at a time');
});

test('drop variants are deterministic per seed and the pan is constant-power', () => {
  const a = renderDropVariant(SR, mulberry32(9), 'plink');
  const b = renderDropVariant(SR, mulberry32(9), 'plink');
  assert.deepEqual(Array.from(a.channels[0]), Array.from(b.channels[0]));
  assert.equal(a.pan, b.pan);
  const [left, right] = a.channels;
  const i = left.findIndex((v) => Math.abs(v) > 0.05);
  const theta = ((a.pan + 1) * Math.PI) / 4;
  near(left[i] / Math.cos(theta), right[i] / Math.sin(theta), 1e-5, 'both channels carry the same mono source');
  const plinkLength = renderDropVariant(SR, mulberry32(4), 'plink').channels[0].length;
  const patterLength = renderDropVariant(SR, mulberry32(4), 'patter').channels[0].length;
  assert.ok(plinkLength <= 0.13 * SR && patterLength <= 0.13 * SR);
  const small = renderDropKit(22050, mulberry32(1), { variants: 4 });
  assert.equal(small.length, 4);
  assert.ok(small.every((v) => v.channels[0].length <= Math.round(0.13 * 22050)));
});
