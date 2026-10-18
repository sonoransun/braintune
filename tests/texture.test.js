import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTexturePlanner } from '../docs/js/audio/texture.js';
import { createScheduler } from '../docs/js/audio/automation.js';
import { createTexture, planTextureEvents } from '../docs/js/core/texture-model.js';
import { createFakeAudioContext, createFakeClock, createFakeParam } from './helpers/fake-audio.js';

const NOMINAL = Object.freeze({ padBus: 0.2, padFilterHz: 1800 });

/** A running fake context, a scheduler on mocked timers and a texture planner on two params plus a decoy. */
function rig(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createFakeClock(0);
  const ctx = createFakeAudioContext({ clock });
  ctx.resume();
  const scheduler = createScheduler(ctx, { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (h) => clearTimeout(h) });
  const params = { padBus: createFakeParam(NOMINAL.padBus), padFilter: createFakeParam(NOMINAL.padFilterHz), decoy: createFakeParam(1) };
  const texture = createTexture(31);
  const snapshots = [];
  let nominalReads = 0;
  const planner = createTexturePlanner({
    texture,
    params,
    nominal: () => {
      nominalReads += 1;
      return NOMINAL;
    },
    onSnapshot: (at, snapshot) => snapshots.push({ at, snapshot }),
  });
  /** Advances audio time and the timers together in 100 ms steps. */
  const run = (seconds) => {
    for (let i = 0; i < seconds * 10; i++) {
      clock.advance(0.1);
      t.mock.timers.tick(100);
    }
  };
  t.after(() => scheduler.stop());
  return { ctx, scheduler, params, texture, planner, snapshots, run, reads: () => nominalReads };
}

test('the planner drives only its two params, with setTargetAtTime only, at the texture knots', (t) => {
  const { scheduler, params, texture, planner, run, reads } = rig(t);
  planner.reset();
  scheduler.add(planner);
  scheduler.start();
  run(120);
  assert.equal(params.decoy.calls.length, 0, 'the decoy param is never touched');
  for (const name of ['padBus', 'padFilter']) {
    const methods = new Set(params[name].calls.map((c) => c.method));
    assert.deepEqual([...methods], ['setTargetAtTime'], `${name} receives only setTargetAtTime`);
  }
  const expected = planTextureEvents(texture, NOMINAL, 0, 124);
  const busCalls = params.padBus.calls.map((c) => [c.time, c.value, c.timeConstant]);
  assert.deepEqual(busCalls, expected.filter((e) => e.param === 'padBus').map((e) => [e.at, e.value, e.timeConstant]));
  assert.ok(busCalls.length >= 120 / 8.1, `${busCalls.length} knots`);
  assert.ok(reads() > 0, 'nominal is read per window');
});

test('one snapshot per whole second, each once, planned up to 4 s ahead', (t) => {
  const { ctx, scheduler, planner, snapshots, run } = rig(t);
  scheduler.add(planner);
  scheduler.start();
  run(30);
  const times = snapshots.map((s) => s.at);
  assert.deepEqual(times, Array.from({ length: times.length }, (_, k) => k), 'whole seconds 0, 1, 2 … without gaps or repeats');
  assert.ok(times.at(-1) >= ctx.currentTime + 3, `snapshots reach ${times.at(-1)} at ${ctx.currentTime}`);
  for (const { snapshot } of snapshots) {
    assert.deepEqual(Object.keys(snapshot), ['pad', 'gust', 'set']);
    for (const v of Object.values(snapshot)) assert.ok(v >= -1 && v <= 1);
  }
});

test('the 4 s horizon holds while the tab is hidden (the scheduler lookahead is 3 s then)', (t) => {
  const { ctx, scheduler, planner, run } = rig(t);
  scheduler.add(planner);
  scheduler.start();
  assert.equal(planner.horizon, 4);
  assert.equal(planner.plannedUpTo, 4);
  scheduler.setHidden(true);
  for (let i = 0; i < 20; i++) {
    run(1);
    assert.ok(planner.plannedUpTo >= ctx.currentTime + 4 - 1e-9, `planned to ${planner.plannedUpTo} at ${ctx.currentTime}`);
    assert.ok(planner.plannedUpTo <= ctx.currentTime + 5 + 1e-9, 'never far beyond the horizon');
  }
});
