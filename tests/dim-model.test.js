import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DIM_STAGES, dimStage, nextDimInMs } from '../docs/js/core/dim-model.js';

test('DIM_STAGES: a minute to the night stage, five to the deep one, frozen', () => {
  assert.deepEqual({ ...DIM_STAGES }, { night: 60000, deep: 300000 });
  assert.ok(Object.isFrozen(DIM_STAGES));
});

test('dimStage: none below a minute, night below five, deep from five minutes on', () => {
  assert.equal(dimStage(0), 'none');
  assert.equal(dimStage(59999), 'none');
  assert.equal(dimStage(60000), 'night');
  assert.equal(dimStage(299999), 'night');
  assert.equal(dimStage(300000), 'deep');
  assert.equal(dimStage(8 * 3600e3), 'deep');
  for (const odd of [-1, Number.NaN, undefined, null]) assert.equal(dimStage(odd), 'none', String(odd));
});

test('dimStage honours custom stages', () => {
  const stages = { night: 1000, deep: 5000 };
  assert.deepEqual([0, 999, 1000, 4999, 5000].map((ms) => dimStage(ms, stages)), ['none', 'none', 'night', 'night', 'deep']);
  assert.equal(dimStage(60000, { night: 120000, deep: 600000 }), 'none');
});

test('nextDimInMs: the wait until the next stage, null once deep', () => {
  assert.equal(nextDimInMs(0), 60000);
  assert.equal(nextDimInMs(45000), 15000);
  assert.equal(nextDimInMs(60000), 240000);
  assert.equal(nextDimInMs(299000), 1000);
  assert.equal(nextDimInMs(300000), null);
  assert.equal(nextDimInMs(Number.NaN), 60000, 'an unknown idle time counts from zero');
  assert.equal(nextDimInMs(-5000), 60000);
  assert.equal(nextDimInMs(2500, { night: 1000, deep: 5000 }), 2500);
  for (let idle = 0; idle < 400000; idle += 7919) {
    const wait = nextDimInMs(idle);
    if (wait === null) continue;
    assert.notEqual(dimStage(idle + wait), dimStage(idle), `the stage changes after the wait from ${idle} ms`);
    assert.equal(dimStage(idle + wait - 1), dimStage(idle), `and not a millisecond before (${idle} ms)`);
  }
});
