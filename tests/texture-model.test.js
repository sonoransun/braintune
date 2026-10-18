import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TEXTURE_PARAMS, TEXTURE_RECIPE,
  createTexture, planTextureEvents, textureSnapshot, gustAt, setScales, textureBandwidthHz,
} from '../docs/js/core/texture-model.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const NOMINAL = Object.freeze({ padBus: 0.2, padFilterHz: 1584 });

test('the recipe is frozen and every knot stream updates at most 0.256 times a second (≤ 0.3 Hz)', () => {
  assert.deepEqual([...TEXTURE_PARAMS], ['padBus', 'padFilter']);
  assert.ok(Object.isFrozen(TEXTURE_RECIPE) && Object.isFrozen(TEXTURE_RECIPE.set.amp) && Object.isFrozen(TEXTURE_RECIPE.purr.tempo));
  const bandwidth = textureBandwidthHz();
  assert.deepEqual(Object.keys(bandwidth), ['padBus', 'padFilter', 'gust', 'surf']);
  for (const [stream, hz] of Object.entries(bandwidth)) {
    assert.ok(hz <= 0.3, `${stream} knots at ${hz} Hz`);
    near(hz, 1 / (6 * 0.65), 1e-12, stream);
  }
});

test('600 one-second windows: two target events per knot on the texture params only, inside their ceiling-anchored ranges', () => {
  const texture = createTexture(2024);
  let knots = [];
  for (let w = 0; w < 600; w++) {
    const events = planTextureEvents(texture, NOMINAL, w, w + 1);
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      assert.ok(TEXTURE_PARAMS.includes(e.param), `param ${e.param}`);
      assert.equal(e.kind, 'target');
      assert.ok(e.at >= w && e.at < w + 1, `event at ${e.at} outside [${w}, ${w + 1})`);
      if (k > 0) assert.ok(e.at >= events[k - 1].at, 'sorted by at');
      if (e.param === 'padBus') {
        assert.equal(e.timeConstant, 2);
        assert.ok(e.value >= NOMINAL.padBus * 10 ** (-3 / 20) - 1e-12 && e.value <= NOMINAL.padBus + 1e-12, `padBus ${e.value}`);
      } else {
        assert.equal(e.timeConstant, 1.5);
        assert.ok(e.value >= (NOMINAL.padFilterHz * 5) / 6 - 1e-9 && e.value <= (NOMINAL.padFilterHz * 7) / 6 + 1e-9, `padFilter ${e.value}`);
      }
    }
    assert.equal(events.filter((e) => e.param === 'padBus').length, events.filter((e) => e.param === 'padFilter').length);
    knots = knots.concat(events.filter((e) => e.param === 'padBus').map((e) => e.at));
  }
  assert.ok(knots.length >= 600 / 8.1 && knots.length <= 600 / 3.9 + 1, `${knots.length} knots in 600 s`);
  for (let i = 1; i < knots.length; i++) {
    const gap = knots[i] - knots[i - 1];
    assert.ok(gap >= 3.9 && gap <= 8.1, `knots ${gap} s apart`);
  }
  const values = planTextureEvents(texture, NOMINAL, 0, 600).filter((e) => e.param === 'padBus').map((e) => e.value);
  assert.ok(new Set(values).size === values.length, 'the breath never sits on one value');
});

test('the ambience streams: gust and surf knots of their own, set energy, purr drift, all inside their ranges', () => {
  const texture = createTexture(7);
  const tone = texture.ticks(0, 3600).map((k) => k.t);
  for (const stream of ['gustTicks', 'surfTicks']) {
    const knots = texture[stream](0, 3600).map((k) => k.t);
    for (let i = 1; i < knots.length; i++) assert.ok(knots[i] - knots[i - 1] >= 3.9 && knots[i] - knots[i - 1] <= 8.1);
    assert.notDeepEqual(knots.slice(0, 20), tone.slice(0, 20), `${stream} has its own jitter`);
  }
  for (let t = 0; t < 3600; t += 1.7) {
    const E = texture.set.at(t);
    assert.ok(E >= 0 && E <= 1, `set ${E}`);
    const { tempo, amplitude } = texture.purr.at(t);
    assert.ok(tempo >= 0.9 && tempo <= 1.2, `tempo ${tempo}`);
    assert.ok(amplitude >= 10 ** (-2 / 20) - 1e-12 && amplitude <= 1, `amplitude ${amplitude}`);
    for (const name of ['gust', 'surf', 'padFilter']) assert.ok(Math.abs(texture[name].at(t)) <= 1, `${name} at ${t}`);
    const snap = textureSnapshot(texture, t);
    assert.deepEqual(Object.keys(snap), ['pad', 'gust', 'set']);
    for (const [key, v] of Object.entries(snap)) assert.ok(v >= -1 && v <= 1, `snapshot ${key} ${v}`);
    near(snap.set, 2 * E - 1, 1e-12, 'set snapshot');
  }
});

test('gustAt: ±0.77 is the extreme (±spanDb, rate 1.4 / 0.6), 0 is neutral, beyond is clamped', () => {
  assert.deepEqual(gustAt(0, 3), { gainDb: 0, rateScale: 1 });
  near(gustAt(0.77, 3).gainDb, 3, 1e-12);
  near(gustAt(0.77, 3).rateScale, 1.4, 1e-12);
  near(gustAt(-0.77, 3).gainDb, -3, 1e-12);
  near(gustAt(-0.77, 3).rateScale, 0.6, 1e-12);
  assert.deepEqual(gustAt(1, 2), gustAt(0.9, 2));
  near(gustAt(0.385, 1).gainDb, 0.5, 1e-12, 'linear inside');
});

test('setScales: a quiet lull at E = 0, the recipe peak at E = 1', () => {
  const lull = setScales(0);
  near(lull.ampDb, -5.19, 0.01, 'ampDb at 0');
  near(lull.period, 1.15, 1e-12);
  near(lull.swell, 0.9, 1e-12);
  near(lull.wash, 0.85, 1e-12);
  assert.deepEqual(setScales(1), { ampDb: 0, period: 0.85, swell: 1.1, wash: 1.15 });
  near(setScales(0.5).ampDb, 20 * Math.log10(0.775), 1e-12);
  assert.deepEqual(setScales(3), setScales(1), 'clamped');
});

test('a texture is deterministic per seed and differs between seeds', () => {
  const a = createTexture(99);
  const b = createTexture(99);
  const c = createTexture(100);
  assert.deepEqual(planTextureEvents(a, NOMINAL, 0, 120), planTextureEvents(b, NOMINAL, 0, 120));
  assert.deepEqual(textureSnapshot(a, 333.3), textureSnapshot(b, 333.3));
  assert.deepEqual(a.purr.at(50), b.purr.at(50));
  assert.notDeepEqual(planTextureEvents(a, NOMINAL, 0, 120), planTextureEvents(c, NOMINAL, 0, 120));
  assert.equal(a.seed, 99);
  assert.equal(a.recipe, TEXTURE_RECIPE);
});
