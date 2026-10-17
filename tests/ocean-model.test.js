import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAVE_PARAMS, MIN_WAVE_PERIOD, oceanParams, planWave } from '../docs/js/core/ocean-model.js';
import { mulberry32 } from '../docs/js/core/rng.js';
import { dbToGain } from '../docs/js/core/levels.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const INTENSITIES = [0, 0.35, 0.6, 1];
const KINDS = new Set(['set', 'linear', 'exp', 'target']);

test('oceanParams matches the plan table at the ends and clamps intensity', () => {
  const calm = oceanParams(0);
  const wild = oceanParams(1);
  assert.equal(calm.surfGainDb, -14);
  assert.equal(wild.surfGainDb, -8);
  assert.deepEqual(calm.periodRange, [8, 14]);
  assert.deepEqual(wild.periodRange, [6, 12]);
  assert.deepEqual(oceanParams(2).periodRange, [6, 12]);
  assert.deepEqual(calm.swell, { Tb: [2.5, 4], lpFrom: 250, lpTo: 700, peakDb: -12 });
  assert.deepEqual(wild.swell, { Tb: [2.5, 4], lpFrom: 250, lpTo: 1400, peakDb: -6 });
  assert.deepEqual(calm.crash, { bpFrom: 2600, bpTo: 800, Q: 0.8, peakDb: -6, release: 0.6 });
  assert.deepEqual(wild.crash, { bpFrom: 2600, bpTo: 800, Q: 0.8, peakDb: 0, release: 1 });
  assert.deepEqual(calm.wash, { hpFrom: 1800, hpTo: 350, Tw: 3, peakDb: -10 });
  assert.deepEqual(wild.wash, { hpFrom: 1800, hpTo: 350, Tw: 6, peakDb: -4 });
  assert.deepEqual(calm.pan, [-0.35, 0.35]);
  assert.deepEqual(calm.surfLfo, { hz: 0.04, depthDb: 2 });
  near(oceanParams(1.5).periodRange[0], MIN_WAVE_PERIOD, 1e-12, 'period floor');
  assert.ok(oceanParams(0.9).periodRange[0] >= MIN_WAVE_PERIOD);
});

test('wave periods stay inside the range and never below 6 s', () => {
  for (const i of INTENSITIES) {
    const rng = mulberry32(31);
    const params = oceanParams(i);
    let t0 = 100;
    for (let n = 0; n < 300; n++) {
      const wave = planWave(rng, t0, params);
      const period = wave.nextStart - t0;
      assert.ok(period >= MIN_WAVE_PERIOD, `period ${period} < 6 at i = ${i}`);
      assert.ok(period >= params.periodRange[0] - 1e-9 && period <= params.periodRange[1] + 1e-9, `period ${period} at i = ${i}`);
      t0 = wave.nextStart;
    }
  }
});

test('a wave bundle uses only the known params and kinds, sorted by time from t0', () => {
  const rng = mulberry32(5);
  for (const i of INTENSITIES) {
    const { events } = planWave(rng, 42, oceanParams(i));
    assert.ok(events.length >= 20);
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      assert.ok(WAVE_PARAMS.includes(e.param), `unknown param ${e.param}`);
      assert.ok(KINDS.has(e.kind), `unknown kind ${e.kind}`);
      assert.ok(Number.isFinite(e.value) && Number.isFinite(e.at), 'finite');
      assert.ok(e.at >= 42, `event before t0 at ${e.at}`);
      if (k > 0) assert.ok(e.at >= events[k - 1].at, 'sorted by at');
      if (e.kind === 'target') assert.ok(e.timeConstant > 0, 'targets carry a time constant');
      else assert.equal(e.timeConstant, undefined);
      if (e.kind === 'exp') assert.ok(e.value > 0, 'exponential ramps never aim at 0');
    }
    for (const param of WAVE_PARAMS) assert.ok(events.some((e) => e.param === param), `${param} is driven`);
  }
});

test('gains never exceed their peakDb and the sweeps run between the recipe frequencies', () => {
  const rng = mulberry32(8);
  for (const i of INTENSITIES) {
    const params = oceanParams(i);
    const { events } = planWave(rng, 0, params);
    const of = (param) => events.filter((e) => e.param === param);
    const peaks = { swellGain: params.swell.peakDb, crashGain: params.crash.peakDb, washGain: params.wash.peakDb };
    for (const [param, db] of Object.entries(peaks)) {
      const list = of(param);
      assert.equal(list[0].kind, 'set');
      assert.equal(list[0].value, 0, `${param} starts from 0`);
      for (const e of list) assert.ok(e.value <= dbToGain(db) + 1e-12, `${param} ${e.value} above ${db} dB`);
      near(Math.max(...list.map((e) => e.value)), dbToGain(db), 1e-12, `${param} reaches its peak`);
      assert.equal(list.at(-1).kind, 'target');
      assert.equal(list.at(-1).value, 0, `${param} releases to 0`);
    }
    assert.deepEqual(of('swellLP').map((e) => [e.kind, e.value]), [['set', 250], ['linear', params.swell.lpTo]]);
    assert.deepEqual(of('crashBP').map((e) => [e.kind, e.value]), [['set', 2600], ['exp', 800]]);
    assert.deepEqual(of('washHP').map((e) => [e.kind, e.value]), [['set', 1800], ['exp', 350]]);
    const crash = of('crashGain');
    near(crash[1].at - crash[0].at, 0.25, 1e-9, 'crash attack');
    near(crash[2].timeConstant, params.crash.release, 1e-12, 'crash release');
    const wash = of('washGain');
    near(wash[1].at - wash[0].at, 0.5, 1e-9, 'wash attack');
    near(wash[2].timeConstant, params.wash.Tw / 3, 1e-12, 'wash release');
    near(of('washHP')[1].at - of('washHP')[0].at, params.wash.Tw, 1e-9, 'wash sweep lasts Tw');
  }
});

test('visual.at is the crash time, 0.2 s before the swell peak, and the wash follows 0.3 s later', () => {
  const rng = mulberry32(13);
  for (let n = 0; n < 50; n++) {
    const params = oceanParams(n / 50);
    const t0 = 7 + n;
    const wave = planWave(rng, t0, params);
    const crashStart = wave.events.find((e) => e.param === 'crashGain').at;
    const swellPeak = wave.events.filter((e) => e.param === 'swellGain' && e.kind === 'linear').at(-1).at;
    const washStart = wave.events.find((e) => e.param === 'washGain').at;
    assert.equal(wave.visual.at, crashStart);
    near(swellPeak - crashStart, 0.2, 1e-9, 'crash leads the swell peak');
    near(washStart - crashStart, 0.3, 1e-9, 'wash follows the crash');
    assert.ok(wave.visual.at >= t0 + 2.3 && wave.visual.at <= t0 + 3.8, `crash at ${wave.visual.at - t0} s after t0`);
    near(wave.visual.duration, params.wash.Tw, 1e-12, 'visual duration is Tw');
  }
});

test('pan starts within ±0.35 and drifts to half the opposite side', () => {
  const rng = mulberry32(21);
  let extreme = 0;
  for (let n = 0; n < 200; n++) {
    const wave = planWave(rng, 0, oceanParams(0.5));
    const [start, end] = wave.events.filter((e) => e.param === 'pan');
    assert.equal(start.kind, 'set');
    assert.equal(end.kind, 'linear');
    assert.ok(Math.abs(start.value) <= 0.35, `pan ${start.value}`);
    near(end.value, -0.5 * start.value, 1e-12, 'pan settles opposite');
    assert.ok(end.at > start.at + 6, 'pan drift is slow');
    extreme = Math.max(extreme, Math.abs(start.value));
  }
  assert.ok(extreme > 0.25, 'pan uses its range');
});

test('planWave is deterministic for a seed and never mutates params', () => {
  const params = Object.freeze(oceanParams(0.35));
  const a = planWave(mulberry32(99), 3, params);
  const b = planWave(mulberry32(99), 3, params);
  assert.deepEqual(a, b);
});
