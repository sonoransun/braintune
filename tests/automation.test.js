import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXP_FLOOR, holdParam, glideTo, fade, applyEvents, crossfade, createScheduler } from '../docs/js/audio/automation.js';
import { fadeBreakpoints } from '../docs/js/core/levels.js';
import { createFakeParam, createFakeAudioContext, createFakeClock } from './helpers/fake-audio.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

test('holdParam uses cancelAndHoldAtTime when present', () => {
  const param = createFakeParam(0.5);
  holdParam(param, 2.01);
  assert.deepEqual(param.calls, [{ method: 'cancelAndHoldAtTime', value: undefined, time: 2.01 }]);
});

test('holdParam falls back to cancelScheduledValues plus a pinned current value', () => {
  const param = createFakeParam(0.5, { holdSupported: false });
  param.value = 0.3;
  holdParam(param, 2.01);
  assert.deepEqual(param.calls, [
    { method: 'cancelScheduledValues', value: undefined, time: 2.01 },
    { method: 'setValueAtTime', value: 0.3, time: 2.01 },
  ]);
});

test('fade pins the start then emits every S-curve breakpoint as a linear ramp, never a value curve', () => {
  const param = createFakeParam(0);
  fade(param, 0, 0.343, 1.01, 1.5, 'scurve');
  const [hold, start, ...ramps] = param.calls;
  assert.equal(hold.method, 'cancelAndHoldAtTime');
  assert.deepEqual(start, { method: 'setValueAtTime', value: 0, time: 1.01 });
  assert.equal(ramps.length, 32);
  const expected = fadeBreakpoints(0, 0.343, 32, 'scurve');
  ramps.forEach((call, i) => {
    assert.equal(call.method, 'linearRampToValueAtTime');
    near(call.value, expected[i + 1], 1e-7, `breakpoint ${i + 1}`);
    near(call.time, 1.01 + (1.5 * (i + 1)) / 32, 1e-9, `time ${i + 1}`);
  });
  assert.equal(ramps.at(-1).value, 0.343);
  assert.ok(!param.calls.some((c) => c.method === 'setValueCurveAtTime'));
});

test('fade: a linear shape is one ramp and a zero length is an immediate set', () => {
  const linear = createFakeParam(1);
  fade(linear, 1, 0.2, 5, 0.5, 'linear');
  assert.deepEqual(linear.calls.slice(1), [
    { method: 'setValueAtTime', value: 1, time: 5 },
    { method: 'linearRampToValueAtTime', value: 0.2, time: 5.5 },
  ]);
  const instant = createFakeParam(1);
  fade(instant, 1, 0, 5, 0);
  assert.deepEqual(instant.calls.slice(1), [
    { method: 'setValueAtTime', value: 1, time: 5 },
    { method: 'setValueAtTime', value: 0, time: 5 },
  ]);
  assert.throws(() => fade(createFakeParam(0), 0, 1, 1, 1, 'bounce'), RangeError);
});

test('glideTo: linear, exponential (clamped above 0) and target kinds, all held first', () => {
  const lin = createFakeParam(256);
  glideTo(lin, 320, 3.01, 1.5, 'lin');
  assert.deepEqual(lin.calls, [
    { method: 'cancelAndHoldAtTime', value: undefined, time: 3.01 },
    { method: 'setValueAtTime', value: 256, time: 3.01 },
    { method: 'linearRampToValueAtTime', value: 320, time: 4.51 },
  ]);
  const exp = createFakeParam(0);
  glideTo(exp, 0, 3.01, 2, 'exp');
  assert.deepEqual(exp.calls.slice(1), [
    { method: 'setValueAtTime', value: EXP_FLOOR, time: 3.01 },
    { method: 'exponentialRampToValueAtTime', value: EXP_FLOOR, time: 5.01 },
  ]);
  const target = createFakeParam(1);
  glideTo(target, 0.5, 3.01, 0.3, 'target');
  assert.deepEqual(target.calls.slice(1), [{ method: 'setTargetAtTime', value: 0.5, time: 3.01, timeConstant: 0.3 }]);
  const instant = createFakeParam(1);
  glideTo(instant, 2, 3.01, 0, 'lin');
  assert.deepEqual(instant.calls.at(-1), { method: 'setValueAtTime', value: 2, time: 3.01 });
  assert.throws(() => glideTo(createFakeParam(1), 2, 1, 1, 'sideways'), RangeError);
});

test('applyEvents dispatches by kind on a Map or an object and clamps exponential targets', () => {
  const a = createFakeParam(0);
  const b = createFakeParam(100);
  const events = [
    { param: 'a', at: 1, kind: 'set', value: 0.5 },
    { param: 'a', at: 2, kind: 'linear', value: 1 },
    { param: 'b', at: 2, kind: 'exp', value: 0 },
    { param: 'b', at: 3, kind: 'exp', value: 50 },
    { param: 'a', at: 4, kind: 'target', value: 0, timeConstant: 0.6 },
  ];
  applyEvents(new Map([['a', a], ['b', b]]), events);
  assert.deepEqual(a.calls, [
    { method: 'setValueAtTime', value: 0.5, time: 1 },
    { method: 'linearRampToValueAtTime', value: 1, time: 2 },
    { method: 'setTargetAtTime', value: 0, time: 4, timeConstant: 0.6 },
  ]);
  assert.deepEqual(b.calls, [
    { method: 'exponentialRampToValueAtTime', value: EXP_FLOOR, time: 2 },
    { method: 'exponentialRampToValueAtTime', value: 50, time: 3 },
  ]);
  const c = createFakeParam(0);
  applyEvents({ c }, [{ param: 'c', at: 9, kind: 'set', value: 2 }]);
  assert.equal(c.calls.length, 1);
  assert.throws(() => applyEvents({ c }, [{ param: 'zzz', at: 1, kind: 'set', value: 0 }]), /unknown param/);
  assert.throws(() => applyEvents({ c }, [{ param: 'c', at: 1, kind: 'wobble', value: 0 }]), /unknown kind/);
});

test('crossfade is equal-power: out² + in² = 1 at every breakpoint', () => {
  const out = createFakeParam(1);
  const inn = createFakeParam(0);
  crossfade(out, inn, 10.01);
  const outRamps = out.callsOf('linearRampToValueAtTime');
  const inRamps = inn.callsOf('linearRampToValueAtTime');
  assert.equal(outRamps.length, 32);
  assert.equal(inRamps.length, 32);
  outRamps.forEach((o, i) => {
    near(o.value ** 2 + inRamps[i].value ** 2, 1, 1e-6, `power at step ${i}`);
    assert.equal(o.time, inRamps[i].time);
  });
  near(outRamps.at(-1).time, 11.21, 1e-9, 'default 1.2 s');
  assert.equal(outRamps.at(-1).value, 0);
  assert.equal(inRamps.at(-1).value, 1);
});

function recordingPlanner(label, log, horizon) {
  const planner = {
    plannedUpTo: 0,
    plan(from, to) {
      log.push({ label, from, to });
      return [{ at: from, label }, { at: (from + to) / 2, label }];
    },
    apply(item) {
      log.push({ label, applied: item.at });
    },
  };
  if (horizon !== undefined) planner.horizon = horizon;
  return planner;
}

test('scheduler plans contiguous 1 s windows at 200 ms ticks and stops cleanly', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createFakeClock(0);
  const ctx = createFakeAudioContext({ clock });
  ctx.resume();
  const log = [];
  const scheduler = createScheduler(ctx, { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) });
  const planner = recordingPlanner('a', log);
  scheduler.add(planner);
  scheduler.start();
  assert.deepEqual(log.filter((e) => e.from !== undefined), [{ label: 'a', from: 0, to: 1 }]);
  assert.equal(planner.plannedUpTo, 1);
  for (let i = 0; i < 5; i++) {
    clock.advance(0.2);
    t.mock.timers.tick(200);
  }
  const windows = log.filter((e) => e.from !== undefined);
  for (let i = 1; i < windows.length; i++) assert.equal(windows[i].from, windows[i - 1].to, 'contiguous');
  near(planner.plannedUpTo, 2, 1e-9, 'planned one second ahead of now = 1');
  assert.equal(scheduler.running, true);
  scheduler.stop();
  const before = log.length;
  clock.advance(1);
  t.mock.timers.tick(1000);
  assert.equal(log.length, before, 'no planning after stop');
  assert.equal(scheduler.running, false);
});

test('hidden mode widens the lookahead to 3 s and slows ticks to 1 s; a planner may set its own horizon', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createFakeClock(10);
  const ctx = createFakeAudioContext({ clock });
  ctx.resume();
  const log = [];
  const scheduler = createScheduler(ctx, { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) });
  const planner = recordingPlanner('a', log);
  const wide = recordingPlanner('w', log, 5);
  scheduler.add(planner);
  scheduler.add(wide);
  scheduler.start();
  assert.equal(planner.plannedUpTo, 1, 'first window ends at now + 1 (context time 0)');
  assert.equal(wide.plannedUpTo, 5, 'own horizon');
  scheduler.setHidden(true);
  assert.equal(scheduler.hidden, true);
  assert.equal(planner.plannedUpTo, 3, 'restart on hidden plans up to now + 3');
  clock.advance(0.5);
  t.mock.timers.tick(500);
  assert.equal(planner.plannedUpTo, 3, 'no tick before 1 s while hidden');
  clock.advance(0.5);
  t.mock.timers.tick(500);
  near(planner.plannedUpTo, 4, 1e-9, 'tick at 1 s plans to now + 3');
  scheduler.setHidden(false);
  clock.advance(0.2);
  t.mock.timers.tick(200);
  near(planner.plannedUpTo, 4, 1e-9, 'visible again: already ahead, nothing new until now + 1 passes 4');
  scheduler.stop();
});

test('flush re-plans from now, prunes stale items and calls a planner reset', () => {
  const clock = createFakeClock(0);
  const ctx = createFakeAudioContext({ clock });
  ctx.resume();
  const log = [];
  let resets = 0;
  const scheduler = createScheduler(ctx, { setTimer: () => 1, clearTimer: () => {} });
  const planner = {
    plannedUpTo: 0,
    plan(from, to) {
      log.push({ from, to });
      return [{ at: from - 0.5 }, { at: from }, { at: to - 0.1 }];
    },
    apply(item) {
      log.push({ applied: item.at });
    },
    reset() {
      resets += 1;
    },
  };
  scheduler.add(planner);
  scheduler.start();
  assert.deepEqual(log, [{ from: 0, to: 1 }, { applied: 0 }, { applied: 0.9 }], 'the item at -0.5 was pruned');
  clock.advance(7);
  log.length = 0;
  scheduler.flush();
  assert.equal(resets, 1);
  assert.deepEqual(log[0], { from: 7, to: 8 }, 'planning restarts from now, not from the stale plannedUpTo');
  scheduler.remove(planner);
  log.length = 0;
  scheduler.flush();
  assert.deepEqual(log, [], 'removed planners are not planned');
  scheduler.stop();
});

test('a planner that advances its own plannedUpTo (wave bundles) is left ahead', () => {
  const clock = createFakeClock(0);
  const ctx = createFakeAudioContext({ clock });
  ctx.resume();
  const scheduler = createScheduler(ctx, { setTimer: () => 1, clearTimer: () => {} });
  const bundles = [];
  const planner = {
    plannedUpTo: 0,
    plan(from) {
      this.plannedUpTo = from + 8;
      return [{ at: from }];
    },
    apply(item) {
      bundles.push(item.at);
    },
  };
  scheduler.add(planner);
  scheduler.start();
  assert.deepEqual(bundles, [0]);
  assert.equal(planner.plannedUpTo, 8);
  scheduler.add(planner);
  assert.deepEqual(bundles, [0], 'nothing new while the bundle covers the lookahead');
  scheduler.stop();
});
