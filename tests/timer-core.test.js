import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTimerCore, endFadePlan, chimeEvents } from '../docs/js/core/timer-core.js';

const now = () => Date.now();
const T0 = 1_700_000_000_000;

test('arm computes remaining from the wall clock, never by decrementing', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const timer = createTimerCore({ now });
  assert.equal(timer.remainingMs(), 0);
  assert.equal(timer.isRunning(), false);
  timer.arm(20 * 60_000);
  assert.equal(timer.isRunning(), true);
  assert.equal(timer.isPaused(), false);
  assert.equal(timer.remainingMs(), 1_200_000);
  t.mock.timers.tick(20_000);
  assert.equal(timer.remainingMs(), 1_180_000);
  t.mock.timers.tick(30 * 60_000);
  assert.equal(timer.remainingMs(), 0, 'clamped at zero after the end');
  assert.equal(timer.isRunning(), true, 'still armed until cancelled');
  assert.deepEqual(timer.snapshot(), { durationMs: 1_200_000, endsAt: T0 + 1_200_000, pausedRemainingMs: null });
});

test('pause freezes the remainder and resume re-anchors it', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const timer = createTimerCore({ now });
  timer.arm(600_000);
  t.mock.timers.tick(100_000);
  timer.pause();
  assert.equal(timer.isPaused(), true);
  assert.equal(timer.isRunning(), false);
  assert.equal(timer.remainingMs(), 500_000);
  t.mock.timers.tick(250_000);
  assert.equal(timer.remainingMs(), 500_000, 'paused time does not drain');
  assert.deepEqual(timer.snapshot(), { durationMs: 600_000, endsAt: null, pausedRemainingMs: 500_000 });
  timer.resume();
  assert.equal(timer.isRunning(), true);
  assert.equal(timer.remainingMs(), 500_000);
  assert.equal(timer.snapshot().endsAt, Date.now() + 500_000);
  t.mock.timers.tick(100_000);
  assert.equal(timer.remainingMs(), 400_000);
  timer.resume();
  timer.pause();
  timer.pause();
  assert.equal(timer.remainingMs(), 400_000);
});

test('cancel clears everything; arm with no duration cancels', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const timer = createTimerCore({ now });
  timer.arm(60_000);
  timer.cancel();
  assert.equal(timer.remainingMs(), 0);
  assert.equal(timer.isRunning(), false);
  assert.equal(timer.isPaused(), false);
  assert.deepEqual(timer.snapshot(), { durationMs: 0, endsAt: null, pausedRemainingMs: null });
  timer.arm(60_000);
  timer.arm(0);
  assert.equal(timer.isRunning(), false);
  timer.arm(Infinity);
  assert.equal(timer.isRunning(), false);
});

test('snapshot round-trips through restore, including a store-style session', (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: T0 });
  const a = createTimerCore({ now });
  a.arm(900_000);
  t.mock.timers.tick(60_000);
  const b = createTimerCore({ now });
  b.restore(JSON.parse(JSON.stringify(a.snapshot())));
  assert.deepEqual(b.snapshot(), a.snapshot());
  assert.equal(b.remainingMs(), 840_000);
  a.pause();
  const c = createTimerCore({ now });
  c.restore(a.snapshot());
  assert.equal(c.isPaused(), true);
  assert.equal(c.remainingMs(), 840_000);
  const d = createTimerCore({ now });
  d.restore({ presetId: 'calm', endsAt: Date.now() + 120_000, pausedRemainingMs: null });
  assert.equal(d.remainingMs(), 120_000);
  assert.equal(d.snapshot().durationMs, 120_000);
  const e = createTimerCore({ now });
  e.arm(1000);
  e.restore(null);
  assert.equal(e.isRunning(), false);
  e.restore({ endsAt: 'soon' });
  assert.equal(e.isRunning(), false);
});

test('endFadePlan is null when nothing remains', () => {
  assert.equal(endFadePlan({ remainingMs: 0, endFadeSeconds: 30, nowT: 5, masterValue: 0.7 }), null);
  assert.equal(endFadePlan({ remainingMs: -1, endFadeSeconds: 30, nowT: 5, masterValue: 0.7 }), null);
  assert.equal(endFadePlan({ remainingMs: NaN, endFadeSeconds: 30, nowT: 5, masterValue: 0.7 }), null);
});

test('fade starts at now + remaining - endFade and lands on zero along an S-curve', () => {
  const plan = endFadePlan({ remainingMs: 120_000, endFadeSeconds: 30, nowT: 10, masterValue: 0.7 });
  assert.ok(Math.abs(plan.startT - (10 + 120 - 30)) < 1e-9);
  assert.ok(Math.abs(plan.duration - 30) < 1e-9);
  assert.equal(plan.events.length, 33);
  const [first, ...ramps] = plan.events;
  assert.deepEqual(first, { param: 'master', kind: 'set', value: 0.7, at: plan.startT });
  assert.ok(ramps.every((e) => e.kind === 'linear' && e.param === 'master'));
  for (let i = 1; i < plan.events.length; i += 1) {
    assert.ok(plan.events[i].at > plan.events[i - 1].at, 'sorted by at');
    assert.ok(plan.events[i].value <= plan.events[i - 1].value + 1e-12, 'monotone down');
  }
  const last = ramps.at(-1);
  assert.equal(last.value, 0);
  assert.ok(Math.abs(last.at - (plan.startT + 30)) < 1e-9);
  const mid = ramps[15];
  assert.ok(Math.abs(mid.value - 0.35) < 1e-9, 'smoothstep midpoint is half');
  const early = ramps[3].value;
  assert.ok(early > 0.7 - 0.7 * (4 / 32), 'S-curve starts gently (above the straight line)');
  const custom = endFadePlan({ remainingMs: 120_000, endFadeSeconds: 30, nowT: 10, masterValue: 0.7, n: 8 });
  assert.equal(custom.events.length, 9);
});

test('master changed after arm → the plan is recomputed from the live value with the same start', () => {
  const armed = endFadePlan({ remainingMs: 300_000, endFadeSeconds: 60, nowT: 0, masterValue: 0.7 });
  const later = endFadePlan({ remainingMs: 300_000 - 45_000, endFadeSeconds: 60, nowT: 45, masterValue: 0.3 });
  assert.ok(Math.abs(armed.startT - later.startT) < 1e-9);
  assert.equal(armed.events[0].value, 0.7);
  assert.equal(later.events[0].value, 0.3);
  assert.equal(later.events.at(-1).value, 0);
  assert.ok(later.events.slice(1).every((e) => e.value <= 0.3 + 1e-12));
});

test('a fade that should already have started fades over whatever time is left', () => {
  const plan = endFadePlan({ remainingMs: 10_000, endFadeSeconds: 30, nowT: 100, masterValue: 0.5 });
  assert.equal(plan.startT, 100);
  assert.ok(Math.abs(plan.duration - 10) < 1e-9);
  assert.ok(Math.abs(plan.events.at(-1).at - 110) < 1e-9);
  assert.equal(plan.events.at(-1).value, 0);
  const zero = endFadePlan({ remainingMs: 10_000, endFadeSeconds: 0, nowT: 100, masterValue: 0.5 });
  assert.equal(zero.startT, 110);
  assert.equal(zero.duration, 0);
  assert.deepEqual(zero.events.map((e) => e.value), [0.5, 0]);
});

test('chime: C5 then G5, 1.2 s each, 0.4 s overlap, peak 0.15', () => {
  const chime = chimeEvents(12.5);
  assert.deepEqual(chime, [
    { freq: 523.25, startT: 12.5, duration: 1.2, peak: 0.15 },
    { freq: 783.99, startT: 13.3, duration: 1.2, peak: 0.15 },
  ]);
  const overlap = chime[0].startT + chime[0].duration - chime[1].startT;
  assert.ok(Math.abs(overlap - 0.4) < 1e-9);
});

test('timer core requires an injected clock', () => {
  assert.throws(() => createTimerCore({}), TypeError);
});
