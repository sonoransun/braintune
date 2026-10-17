import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PURR_HZ, BREATH_PARAMS, CUE_PEAK, CUE_SECONDS, purrParams, planBreath, cueEnvelope } from '../docs/js/core/purr-model.js';
import { mulberry32 } from '../docs/js/core/rng.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const INHALE_RATE = 27 / 26;
const EXHALE_RATE = 25 / 26;

test('purrParams is the fixed recipe with the level as breath amplitude', () => {
  assert.equal(PURR_HZ, 26);
  assert.deepEqual(purrParams(), { hz: 26, duty: 0.45, ramp: 0.25, depth: 0.9, lpHz: 300, oscDb: -10, busDb: -12, amplitude: 1 });
  assert.equal(purrParams(0.5).amplitude, 0.5);
  assert.equal(purrParams(3).amplitude, 1);
  assert.equal(purrParams(-1).amplitude, 0);
  assert.deepEqual([...BREATH_PARAMS], ['breath', 'rate', 'lp']);
});

test('breath phases fall in their windows and the cycle length is their sum', () => {
  const rng = mulberry32(3);
  const params = purrParams();
  let t0 = 5;
  for (let n = 0; n < 300; n++) {
    const breath = planBreath(rng, t0, params);
    const { inhale, exhale, pause } = breath.phases;
    assert.ok(inhale >= 0.7 && inhale <= 1.0, `inhale ${inhale}`);
    assert.ok(exhale >= 0.9 && exhale <= 1.3, `exhale ${exhale}`);
    assert.ok(pause >= 0.05 && pause <= 0.15, `pause ${pause}`);
    near(breath.nextStart - t0, inhale + exhale + pause, 1e-9, 'cycle length');
    t0 = breath.nextStart;
  }
});

test('the breath envelope starts and ends at 0, peaks at 0.75·A then A, and uses only known params', () => {
  const rng = mulberry32(17);
  for (const amplitude of [1, 0.4]) {
    const params = purrParams(amplitude);
    const breath = planBreath(rng, 10, params);
    const events = breath.events;
    for (let k = 0; k < events.length; k++) {
      const e = events[k];
      assert.ok(BREATH_PARAMS.includes(e.param), `unknown param ${e.param}`);
      assert.ok(['set', 'linear'].includes(e.kind), `kind ${e.kind}`);
      assert.ok(e.at >= 10 && e.at <= breath.nextStart + 1e-9, 'inside the cycle');
      if (k > 0) assert.ok(e.at >= events[k - 1].at, 'sorted by at');
    }
    const env = events.filter((e) => e.param === 'breath');
    assert.equal(env[0].at, 10);
    assert.equal(env[0].value, 0, 'starts at 0');
    assert.equal(env.at(-1).value, 0, 'ends at 0');
    near(env.at(-1).at, 10 + breath.phases.inhale + breath.phases.exhale, 1e-9, 'ends with the exhale');
    const peak = Math.max(...env.map((e) => e.value));
    near(peak, amplitude, 1e-12, 'exhale peak is A');
    const inhaleEnd = 10 + breath.phases.inhale;
    const inhalePeak = Math.max(...env.filter((e) => e.at < inhaleEnd - 1e-9).map((e) => e.value));
    near(inhalePeak, 0.75 * amplitude, 1e-12, 'inhale peak is 0.75·A');
    const exhaleStart = env.find((e) => e.at >= inhaleEnd - 1e-9 && e.kind === 'set');
    assert.equal(exhaleStart.value, 0, 'the exhale begins from 0 again');
    for (const e of env) assert.ok(e.value >= 0 && e.value <= amplitude + 1e-12);
  }
});

test('phase edges are 80 ms raised cosines', () => {
  const breath = planBreath(mulberry32(4), 0, purrParams());
  const env = breath.events.filter((e) => e.param === 'breath');
  const rise = env.slice(1, 5);
  near(rise.at(-1).at, 0.08, 1e-9, 'rise ends after 80 ms');
  near(rise[1].value, 0.75 * 0.5, 1e-12, 'half way up at half the edge');
  for (let k = 1; k < rise.length; k++) assert.ok(rise[k].value > rise[k - 1].value, 'rise is monotone');
  const inhaleEnd = breath.phases.inhale;
  const fall = env.filter((e) => e.at > inhaleEnd - 0.08 - 1e-9 && e.at <= inhaleEnd + 1e-9 && e.kind === 'linear');
  assert.equal(fall.length, 4);
  near(fall[0].at, inhaleEnd - 0.06, 1e-9, 'fall breakpoints are 20 ms apart');
  assert.equal(fall.at(-1).value, 0);
});

test('rate alternates 27/26 and 25/26 and the low-pass 260 and 340 Hz, each ramped over the edge', () => {
  const rng = mulberry32(6);
  for (let n = 0; n < 20; n++) {
    const breath = planBreath(rng, n * 3, purrParams());
    const rates = breath.events.filter((e) => e.param === 'rate');
    const lps = breath.events.filter((e) => e.param === 'lp');
    for (const e of rates) assert.ok(e.value === INHALE_RATE || e.value === EXHALE_RATE, `rate ${e.value}`);
    for (const e of lps) assert.ok(e.value === 260 || e.value === 340, `lp ${e.value}`);
    assert.deepEqual(rates.map((e) => [e.kind, e.value]), [
      ['set', EXHALE_RATE], ['linear', INHALE_RATE], ['set', INHALE_RATE], ['linear', EXHALE_RATE],
    ]);
    assert.deepEqual(lps.map((e) => [e.kind, e.value]), [['set', 340], ['linear', 260], ['set', 260], ['linear', 340]]);
    near(rates[1].at - rates[0].at, 0.08, 1e-9, 'rate ramps over 80 ms');
    near(rates[2].at - n * 3, breath.phases.inhale, 1e-9, 'exhale rate starts with the exhale');
  }
});

test('cueEnvelope: 0.3 s rise to 0.25, 1.2 s hold, 0.7 s fall to 0', () => {
  const cue = cueEnvelope(20);
  assert.equal(cue.peak, CUE_PEAK);
  assert.equal(CUE_SECONDS, 2.2);
  near(cue.endT, 22.2, 1e-9);
  const events = cue.events;
  assert.ok(events.every((e) => e.param === 'cue'));
  assert.deepEqual(events[0], { param: 'cue', at: 20, kind: 'set', value: 0 });
  for (let k = 1; k < events.length; k++) {
    assert.equal(events[k].kind, 'linear');
    assert.ok(events[k].at >= events[k - 1].at);
    assert.ok(events[k].value >= 0 && events[k].value <= CUE_PEAK + 1e-12);
  }
  const peak = events.find((e) => e.value === CUE_PEAK);
  near(peak.at, 20.3, 1e-9, 'rise ends at 0.3 s');
  const fall = events.filter((e) => e.at > 21.5 - 1e-9);
  near(fall[0].at, 21.5 + 0.7 / 4, 1e-9, 'fall starts after the 1.2 s hold');
  assert.equal(events.at(-1).value, 0);
  near(events.at(-1).at, 22.2, 1e-9, 'ends at 2.2 s');
  const long = cueEnvelope(0, 4.4);
  near(long.endT, 4.4, 1e-9);
  near(long.events.find((e) => e.value === CUE_PEAK).at, 0.6, 1e-9, 'segments scale with the length');
});
