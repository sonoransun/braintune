import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BANDS, BEAT_RANGE, CARRIER_RANGE, UI_CARRIER,
  bandOf, clampBeat, recommendMode, recommendCarrier, voiceFrequencies, partialBeatTable,
} from '../docs/js/core/entrainment.js';
import { TIMBRES } from '../docs/js/core/timbres.js';
import { mulberry32, randRange } from '../docs/js/core/rng.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

const plain = (table) => Object.fromEntries(Object.entries(table).map(([k, v]) => [k, [...v]]));

test('band and range tables match the plan and are frozen', () => {
  assert.deepEqual(plain(BANDS), { delta: [0.5, 4], theta: [4, 8], alpha: [8, 13], beta: [13, 30], gamma: [30, 60] });
  assert.deepEqual(plain(BEAT_RANGE), { binaural: [0.5, 30], monaural: [0.5, 40], isochronic: [0.5, 60] });
  assert.deepEqual(plain(CARRIER_RANGE), { binaural: [100, 1000], monaural: [120, 1000], isochronic: [120, 1200] });
  assert.deepEqual([...UI_CARRIER], [120, 800]);
  assert.ok([BANDS, BEAT_RANGE, CARRIER_RANGE, UI_CARRIER, BANDS.delta, CARRIER_RANGE.binaural].every(Object.isFrozen));
});

test('bandOf: lower bounds inclusive, upper bounds exclusive, gamma keeps 60, outside maps to the nearest band', () => {
  const cases = [
    [0.5, 'delta'], [2, 'delta'], [3.999, 'delta'],
    [4, 'theta'], [5.5, 'theta'], [7.999, 'theta'],
    [8, 'alpha'], [10, 'alpha'], [12.999, 'alpha'],
    [13, 'beta'], [20, 'beta'], [29.999, 'beta'],
    [30, 'gamma'], [40, 'gamma'], [60, 'gamma'],
    [0.1, 'delta'], [90, 'gamma'],
  ];
  for (const [hz, band] of cases) assert.equal(bandOf(hz), band, `${hz} Hz`);
});

test('clampBeat clamps to the mode range and rejects unknown modes', () => {
  assert.equal(clampBeat(45, 'binaural'), 30);
  assert.equal(clampBeat(45, 'monaural'), 40);
  assert.equal(clampBeat(45, 'isochronic'), 45);
  assert.equal(clampBeat(70, 'isochronic'), 60);
  assert.equal(clampBeat(0.1, 'binaural'), 0.5);
  assert.equal(clampBeat(10, 'binaural'), 10);
  assert.throws(() => clampBeat(10, 'stereo'), RangeError);
});

test('recommendMode matrix: beat >= 30 wins, then override, then headphones -> binaural, else isochronic', () => {
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 10 }), 'binaural');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 10, override: 'auto' }), 'binaural');
  assert.equal(recommendMode({ listening: 'speakers', beatHz: 10, override: 'auto' }), 'isochronic');
  assert.equal(recommendMode({ listening: undefined, beatHz: 10, override: 'auto' }), 'isochronic');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 30, override: 'auto' }), 'isochronic');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 40, override: 'binaural' }), 'isochronic');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 29.5, override: 'auto' }), 'binaural');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 10, override: 'monaural' }), 'monaural');
  assert.equal(recommendMode({ listening: 'speakers', beatHz: 10, override: 'binaural' }), 'binaural');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 10, override: 'isochronic' }), 'isochronic');
  assert.equal(recommendMode({ listening: 'speakers', beatHz: 10, override: 'monaural' }), 'monaural');
  assert.equal(recommendMode({ listening: 'headphones', beatHz: 10, override: null }), 'binaural', 'an empty override reads as auto');
});

test('recommendCarrier: 400 Hz floor for phone speakers, then clamped to the mode range', () => {
  assert.equal(recommendCarrier({ presetCarrierHz: 256, mode: 'isochronic', device: 'phone', listening: 'speakers' }), 400);
  assert.equal(recommendCarrier({ presetCarrierHz: 420, mode: 'isochronic', device: 'phone', listening: 'speakers' }), 420);
  assert.equal(recommendCarrier({ presetCarrierHz: 256, mode: 'isochronic', device: 'desktop', listening: 'speakers' }), 256);
  assert.equal(recommendCarrier({ presetCarrierHz: 256, mode: 'binaural', device: 'phone', listening: 'headphones' }), 256);
  assert.equal(recommendCarrier({ presetCarrierHz: 300, mode: 'binaural', device: 'phone', listening: 'speakers' }), 400);
  assert.equal(recommendCarrier({ presetCarrierHz: 50, mode: 'binaural', device: 'desktop', listening: 'headphones' }), 100);
  assert.equal(recommendCarrier({ presetCarrierHz: 2000, mode: 'binaural', device: 'desktop', listening: 'headphones' }), 1000);
  assert.equal(recommendCarrier({ presetCarrierHz: 110, mode: 'monaural', device: 'desktop', listening: 'headphones' }), 120);
  assert.equal(recommendCarrier({ presetCarrierHz: 1100, mode: 'monaural', device: 'desktop', listening: 'headphones' }), 1000);
  assert.equal(recommendCarrier({ presetCarrierHz: 2000, mode: 'isochronic', device: 'phone', listening: 'speakers' }), 1200);
  assert.equal(recommendCarrier({ presetCarrierHz: 110, mode: 'isochronic', device: 'desktop', listening: 'speakers' }), 120);
  assert.throws(() => recommendCarrier({ presetCarrierHz: 256, mode: 'stereo', device: 'desktop', listening: 'speakers' }), RangeError);
});

test('voiceFrequencies: right - left = beat within 1e-9 over 200 pairs, centred on the carrier', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 200; i++) {
    const f = randRange(rng, 100, 1000);
    const beat = randRange(rng, 0.5, 40);
    const mode = i % 2 ? 'binaural' : 'monaural';
    const { left, right } = voiceFrequencies(f, beat, mode);
    near(right - left, beat, 1e-9, `pair ${i} beat`);
    near((left + right) / 2, f, 1e-9, `pair ${i} centre`);
    assert.ok(left < right);
  }
  assert.deepEqual(voiceFrequencies(256, 10, 'binaural'), { left: 251, right: 261 });
  assert.deepEqual(voiceFrequencies(256, 10, 'isochronic'), { carrier: 256, pulse: 10 });
  assert.throws(() => voiceFrequencies(256, 10, 'stereo'), RangeError);
});

test('partialBeatTable(256, 10): partial n beats at n * 10 Hz; perceptible while n * f < 1000 and n * beat < 35', () => {
  const rows = partialBeatTable(256, 10, TIMBRES.velvet);
  assert.deepEqual(rows.map((r) => r.n), [1, 2, 3, 4, 5, 6, 7]);
  for (const row of rows) {
    assert.equal(row.left, row.n * 251);
    assert.equal(row.right, row.n * 261);
    assert.equal(row.interauralHz, row.n * 10);
    assert.equal(row.perceptible, row.n <= 3, `partial ${row.n}: ${row.n * 256} Hz beating at ${row.n * 10} Hz`);
  }
  assert.ok(rows.filter((r) => r.perceptible && r.n > 1).length > 0, 'a timbre on binaural voices would add audible secondary beats');
});

test('partialBeatTable skips silent partials and both limits cut perception', () => {
  assert.deepEqual(partialBeatTable(256, 10, TIMBRES.glass).map((r) => r.n), [1, 2, 3, 4, 5, 7]);
  assert.deepEqual(partialBeatTable(256, 10, TIMBRES.sine).map((r) => [r.n, r.perceptible]), [[1, true]]);
  assert.deepEqual(partialBeatTable(256, 12, TIMBRES.velvet).filter((r) => r.perceptible).map((r) => r.n), [1, 2], '36 Hz is past the beat limit');
  assert.deepEqual(partialBeatTable(600, 10, TIMBRES.velvet).filter((r) => r.perceptible).map((r) => r.n), [1], '1200 Hz is past the partial limit');
  assert.deepEqual(partialBeatTable(256, 10, []), []);
});
