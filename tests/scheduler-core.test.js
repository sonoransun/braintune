import { test } from 'node:test';
import assert from 'node:assert/strict';
import { horizonWindow, pruneStale } from '../docs/js/core/scheduler-core.js';

test('horizonWindow is null when planning is already ahead of the lookahead', () => {
  assert.equal(horizonWindow(10, 11, 1), null);
  assert.equal(horizonWindow(10, 11.5, 1), null);
  assert.equal(horizonWindow(10, 13, 3), null);
});

test('horizonWindow starts at the later of plannedUpTo and now', () => {
  assert.deepEqual(horizonWindow(10, 10.4, 1), [10.4, 11]);
  assert.deepEqual(horizonWindow(10, 9, 1), [10, 11], 'stale plan after a suspend restarts from now');
  assert.deepEqual(horizonWindow(10, 0, 3), [10, 13]);
  assert.deepEqual(horizonWindow(10, undefined, 1), [10, 11]);
});

test('successive windows are contiguous', () => {
  let plannedUpTo = 0;
  let prevTo = null;
  for (let now = 0; now < 5; now += 0.2) {
    const w = horizonWindow(now, plannedUpTo, 1);
    if (w === null) continue;
    const [from, to] = w;
    if (prevTo !== null) assert.equal(from, prevTo);
    assert.ok(to > from);
    assert.ok(Math.abs(to - (now + 1)) < 1e-9);
    plannedUpTo = to;
    prevTo = to;
  }
  assert.ok(prevTo > 5);
});

test('pruneStale keeps events at or after now, in order', () => {
  const events = [
    { param: 'a', at: 1, kind: 'set', value: 0 },
    { param: 'b', at: 2, kind: 'set', value: 0 },
    { param: 'c', at: 2.5, kind: 'linear', value: 1 },
    { param: 'd', at: 4, kind: 'target', value: 0, timeConstant: 0.3 },
  ];
  assert.deepEqual(pruneStale(events, 2).map((e) => e.param), ['b', 'c', 'd']);
  assert.deepEqual(pruneStale(events, 2.6).map((e) => e.param), ['d']);
  assert.deepEqual(pruneStale(events, 10), []);
  assert.deepEqual(pruneStale(events, 0), events);
  assert.equal(events.length, 4, 'input not mutated');
});
