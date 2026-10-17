import { DEFAULT_SETTINGS } from '../docs/js/core/state.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, STATES } from '../docs/js/audio/engine.js';
import { detectPlatform, prepareSession, installLifecycle, describeLimitations, requestKeepAwake, releaseKeepAwake, keepAwakeState } from '../docs/js/audio/lifecycle.js';
import { getPreset, resolvePreset } from '../docs/js/core/presets.js';
import { masterGain, layerGain } from '../docs/js/core/levels.js';
import { limitationsCopy } from '../docs/js/core/microcopy.js';
import { mulberry32 } from '../docs/js/core/rng.js';
import { createContextFactory, settle } from './helpers/fake-audio.js';

const T0 = 1_700_000_000_000;
const DEFAULT_MASTER = DEFAULT_SETTINGS.mix.master; // the engine starts from the store's default volume
const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const DESK = { listening: 'headphones', device: 'desktop' };
const calm = () => resolvePreset(getPreset('calm'), DESK);
const sleep = () => resolvePreset(getPreset('sleep'), DESK);

/** Mock timers plus a fake context whose audio clock follows the mocked Date. */
function harness(t, { factoryOptions = {}, engineOptions = {} } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: T0 });
  const clock = { now: () => (Date.now() - T0) / 1000 };
  const factory = createContextFactory({ clock, ...factoryOptions });
  const states = [];
  const events = { timer: [], ready: [], wave: [], warning: [], blocked: 0, interrupted: 0 };
  const nav = { audioSession: { type: 'auto' } };
  const engine = createEngine({
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
    rng: mulberry32(1),
    audioContextFactory: factory,
    nav,
    ...engineOptions,
  });
  engine.on('state', ({ state }) => states.push(state));
  engine.on('timer', (e) => events.timer.push(e));
  engine.on('ready', (e) => events.ready.push(e.layer));
  engine.on('wave', (e) => events.wave.push(e));
  engine.on('warning', (e) => events.warning.push(e));
  engine.on('blocked', () => { events.blocked += 1; });
  engine.on('interrupted', () => { events.interrupted += 1; });
  /** Advances mocked time in small steps so timers and the promise callbacks they trigger interleave. */
  const advance = async (ms, step = 50) => {
    for (let left = ms; left > 0; left -= step) {
      t.mock.timers.tick(Math.min(step, left));
      await settle(3);
    }
  };
  const ctx = () => factory.contexts.at(-1);
  const masterGainNode = () => ctx().nodesOf('gain')[0];
  const toneBus = () => ctx().nodesOf('gain')[3];
  const carrier = () => ctx().nodesOf('constant')[0];
  const halfBeat = () => ctx().nodesOf('constant')[1];
  t.after(() => engine.dispose());
  return { engine, factory, nav, states, events, advance, ctx, masterGainNode, toneBus, carrier, halfBeat };
}

async function playing(t, options) {
  const h = harness(t, options);
  await h.engine.play({ preset: calm() });
  await h.advance(1600);
  assert.equal(h.engine.getState().state, 'playing');
  return h;
}

test('STATES lists the contract states in order', () => {
  assert.deepEqual([...STATES], ['idle', 'starting', 'playing', 'pausing', 'paused', 'ending', 'ended', 'ambient', 'blocked', 'interrupted', 'unavailable']);
});

test('unlock: audio session → context → graph → resume → "running", without leaving idle', async (t) => {
  const { engine, factory, nav, states, ctx } = harness(t);
  const result = await engine.unlock();
  assert.equal(result, 'running');
  assert.equal(nav.audioSession.type, 'playback', 'prepareSession ran before the context was made');
  assert.equal(factory.contexts.length, 1);
  assert.equal(ctx().state, 'running');
  assert.deepEqual(states, [], 'unlock alone does not start a session');
  assert.equal(engine.getState().state, 'idle');
  const compressor = ctx().nodesOf('compressor')[0];
  assert.equal(compressor.threshold.value, -3);
  assert.equal(compressor.ratio.value, 20);
  assert.ok(ctx().nodesOf('gain')[0].isConnectedTo(compressor), 'master → limiter');
  assert.ok(ctx().nodesOf('gain')[2].isConnectedTo(compressor), 'chimeIn → limiter (post-master)');
  assert.equal(await engine.unlock(), 'running', 'idempotent');
  assert.equal(factory.contexts.length, 1);
});

test('play(calm): starting → playing, master S-curve 0 → masterGain(DEFAULT_MASTER) over 1.5 s, ambience ready as buffers resolve', async (t) => {
  const { engine, states, events, advance, ctx, masterGainNode } = harness(t);
  const started = engine.play({ preset: calm() });
  assert.equal(engine.getState().state, 'starting');
  assert.equal(await started, true);
  const calls = masterGainNode().gain.calls;
  const start = calls.find((c) => c.method === 'setValueAtTime');
  assert.equal(start.value, 0);
  const ramps = calls.filter((c) => c.method === 'linearRampToValueAtTime');
  assert.equal(ramps.length, 32);
  near(ramps.at(-1).value, masterGain(DEFAULT_MASTER), 1e-12, 'fade target');
  near(ramps.at(-1).time - start.time, 1.5, 1e-9, 'fade length');
  const mid = ramps[15].value;
  near(mid, masterGain(DEFAULT_MASTER) / 2, 1e-6, 'S-curve midpoint');
  assert.ok(ramps[3].value < (masterGain(DEFAULT_MASTER) * 4) / 32, 'S-curve starts gently');
  await advance(1600);
  assert.deepEqual(states, ['starting', 'playing']);
  assert.deepEqual([...events.ready].sort(), ['ocean', 'purr', 'rain'], 'the v2 default mix runs rain, ocean and purr');
  const s = engine.getState();
  assert.equal(s.mode, 'binaural');
  assert.equal(s.carrierHz, 256);
  assert.equal(s.beatHz, 10);
  assert.equal(s.presetId, 'calm');
  assert.equal(s.sampleRate, 48000);
  assert.ok(ctx().nodesOf('oscillator').length >= 8, 'voices, pad and LFOs exist');
  assert.ok(ctx().nodesOf('bufferSource').length >= 3, 'gate, beds');
  await advance(4000);
  assert.ok(events.wave.length >= 1, 'ocean waves are reported');
  const wave = events.wave[0];
  assert.ok(wave.duration >= 3 && wave.duration <= 6);
  assert.ok(wave.inMs >= 0 && wave.inMs < 15000, `inMs ${wave.inMs}`);
  assert.deepEqual(events.warning, []);
});

test('applyPreset(sleep): carrier ramps exponentially, the beat glides 6 → 2 Hz over 12 min, mode stays binaural', async (t) => {
  const { engine, advance, carrier, halfBeat, ctx } = await playing(t);
  const beforeCarrier = carrier().offset.calls.length;
  const beforeBeat = halfBeat().offset.calls.length;
  engine.applyPreset(sleep());
  const carrierCalls = carrier().offset.since(beforeCarrier);
  const exp = carrierCalls.find((c) => c.method === 'exponentialRampToValueAtTime');
  assert.equal(exp.value, 200, 'headphones carrier of Sleep');
  near(exp.time - ctx().currentTime, 2.01, 1e-9, '2 s glide on a preset switch');
  const beatCalls = halfBeat().offset.since(beforeBeat).filter((c) => c.method === 'linearRampToValueAtTime');
  assert.equal(beatCalls.length, 2);
  assert.equal(beatCalls[0].value, 3, 'approach to 6 Hz (half-beat 3)');
  assert.equal(beatCalls[1].value, 1, 'down to 2 Hz (half-beat 1)');
  near(beatCalls[1].time - beatCalls[0].time, 12 * 60, 1e-6, 'twelve minute glide');
  assert.equal(engine.getState().mode, 'binaural');
  assert.equal(engine.getState().presetId, 'sleep');
  await advance(100);
  const mix = getPreset('sleep').mix;
  assert.deepEqual(engine.getLevels(), { master: masterGain(DEFAULT_MASTER), tone: layerGain(mix.tone), rain: layerGain(mix.rain), ocean: layerGain(mix.ocean), purr: layerGain(mix.purr) });
});

test('a master change after armTimer re-arms the end fade from the new level, ending at the same time', async (t) => {
  const { engine, advance, ctx, masterGainNode, events } = await playing(t);
  const param = masterGainNode().gain;
  engine.armTimer(600_000, { endFadeSeconds: 30, chime: 'none', after: 'stop' });
  const endT = ctx().currentTime + 600;
  const planned = param.calls.filter((c) => c.method === 'linearRampToValueAtTime' && c.time > endT - 31);
  assert.ok(planned.length >= 32, 'end fade scheduled');
  near(planned.at(-1).time, endT, 0.02, 'fade ends at the timer end');
  assert.equal(planned.at(-1).value, 0);
  const planStart = param.calls.find((c) => c.method === 'setValueAtTime' && c.time > endT - 31);
  near(planStart.value, masterGain(DEFAULT_MASTER), 1e-12, 'planned from the current master');
  const before = param.calls.length;
  engine.setMaster(0.5);
  const since = param.since(before);
  const slider = since.find((c) => c.method === 'linearRampToValueAtTime');
  near(slider.value, masterGain(0.5), 1e-12, 'slider fade');
  near(slider.time - ctx().currentTime, 0.51, 1e-9, '0.5 s slider fade');
  const cancel = since.find((c) => c.method === 'cancelScheduledValues');
  near(cancel.time, endT - 30, 0.02, 'old plan cancelled from the fade start, not from now');
  const replan = since.filter((c) => c.method === 'linearRampToValueAtTime' && c.time > endT - 31);
  assert.ok(replan.length >= 32, 'a NEW end fade exists after the slider move');
  near(replan.at(-1).time, endT, 0.02, 'still ending at the timer end');
  assert.equal(replan.at(-1).value, 0);
  const newStart = since.find((c) => c.method === 'setValueAtTime' && c.time > endT - 31);
  near(newStart.value, masterGain(0.5), 1e-12, 'planned from the NEW master level');
  assert.equal(events.timer.at(-1).phase, 'running');
  assert.equal(engine.timerRemainingMs(), 600_000);
  await advance(2000);
  assert.equal(engine.timerRemainingMs(), 598_000);
  assert.equal(engine.getState().timer.phase, 'running');
});

test('pause fades 0.6 s then suspends; resume runs the context and fades in over 0.8 s', async (t) => {
  const { engine, states, advance, ctx, masterGainNode } = await playing(t);
  const param = masterGainNode().gain;
  const before = param.calls.length;
  engine.pause();
  assert.equal(engine.getState().state, 'pausing');
  const down = param.since(before).filter((c) => c.method === 'linearRampToValueAtTime');
  assert.equal(down.at(-1).value, 0);
  near(down.at(-1).time - ctx().currentTime, 0.61, 1e-9, '0.6 s pause fade');
  await advance(300);
  assert.equal(ctx().state, 'running', 'not suspended before the fade ends');
  await advance(400);
  assert.equal(ctx().state, 'suspended');
  assert.equal(engine.getState().state, 'paused');
  const frozen = ctx().currentTime;
  await advance(1000);
  assert.equal(ctx().currentTime, frozen, 'audio clock stops while suspended');
  const beforeResume = param.calls.length;
  const resumed = engine.resume();
  assert.equal(engine.getState().state, 'starting');
  assert.equal(await resumed, true);
  assert.equal(ctx().state, 'running');
  const up = param.since(beforeResume).filter((c) => c.method === 'linearRampToValueAtTime');
  near(up.at(-1).value, masterGain(DEFAULT_MASTER), 1e-12);
  near(up.at(-1).time - ctx().currentTime, 0.81, 1e-9, '0.8 s resume fade');
  await advance(900);
  assert.deepEqual(states, ['starting', 'playing', 'pausing', 'paused', 'starting', 'playing']);
});

test('stop fades to 0 over 2 s, then suspends and returns to idle; play again reuses the context', async (t) => {
  const { engine, states, advance, ctx, masterGainNode, factory } = await playing(t);
  const param = masterGainNode().gain;
  const before = param.calls.length;
  const stopped = engine.stop();
  assert.equal(engine.getState().state, 'pausing');
  const down = param.since(before).filter((c) => c.method === 'linearRampToValueAtTime');
  assert.equal(down.at(-1).value, 0);
  near(down.at(-1).time - ctx().currentTime, 2.01, 1e-9, '2 s stop fade');
  await advance(2100);
  await stopped;
  assert.equal(ctx().state, 'suspended');
  assert.equal(engine.getState().state, 'idle');
  await engine.play({ preset: calm() });
  await advance(1600);
  assert.equal(factory.contexts.length, 1, 'same context');
  assert.equal(engine.getState().state, 'playing');
  assert.deepEqual(states, ['starting', 'playing', 'pausing', 'idle', 'starting', 'playing']);
});

test('timer with after:"ambient": tone bus fades, state goes ending → ambient, the timer reports done', async (t) => {
  const { engine, states, events, advance, toneBus, ctx } = await playing(t);
  const tone = toneBus().gain;
  engine.armTimer(4000, { endFadeSeconds: 2, chime: 'none', after: 'ambient' });
  const endT = ctx().currentTime + 4;
  const plan = tone.calls.filter((c) => c.method === 'linearRampToValueAtTime' && c.time > endT - 2.5);
  assert.ok(plan.length >= 32, 'the end fade targets the tone bus');
  near(plan.at(-1).time, endT, 0.02);
  assert.equal(plan.at(-1).value, 0);
  await advance(4500);
  assert.equal(engine.getState().state, 'ambient');
  assert.ok(states.includes('ending'), 'ending announced before ambient');
  assert.equal(states.at(-1), 'ambient');
  assert.equal(events.timer.at(-1).phase, 'done');
  assert.equal(events.timer.at(-1).remainingMs, 0);
  assert.ok(events.timer.some((e) => e.phase === 'ending'));
  assert.equal(ctx().state, 'running', 'rain and sea continue');
  assert.equal(engine.timerRemainingMs(), 0);
  engine.pause();
  await advance(800);
  assert.equal(engine.getState().state, 'paused');
  await engine.resume();
  await advance(900);
  assert.equal(engine.getState().state, 'ambient', 'resume returns to ambient');
});

test('timer with after:"stop": ending → ended with a soft chime into chimeIn, context suspended', async (t) => {
  const { engine, states, advance, ctx } = await playing(t);
  engine.armTimer(3000, { endFadeSeconds: 1, chime: 'soft', after: 'stop' });
  await advance(3200);
  assert.equal(engine.getState().state, 'ending');
  const chimeIn = ctx().nodesOf('gain')[2];
  const chimes = ctx().nodesOf('oscillator').filter((o) => o.frequency.value === 523.25 || o.frequency.value === 783.99);
  assert.equal(chimes.length, 2, 'two chime notes');
  assert.ok(chimes.every((o) => o.connections[0].target.isConnectedTo(chimeIn)), 'chime envelope → chimeIn');
  near(chimes[1].started - chimes[0].started, 0.8, 1e-9, 'second note 0.8 s later');
  await advance(2600);
  assert.equal(engine.getState().state, 'ended');
  assert.equal(ctx().state, 'suspended');
  assert.deepEqual(states.slice(-3), ['playing', 'ending', 'ended']);
  await engine.stop();
  assert.equal(engine.getState().state, 'idle');
});

test('cancelTimer during the end fade restores the level and the playing state', async (t) => {
  const { engine, advance, masterGainNode } = await playing(t);
  engine.armTimer(5000, { endFadeSeconds: 4 });
  await advance(2000);
  assert.equal(engine.getState().state, 'ending');
  const before = masterGainNode().gain.calls.length;
  engine.cancelTimer();
  assert.equal(engine.getState().state, 'playing');
  const restore = masterGainNode().gain.since(before).filter((c) => c.method === 'linearRampToValueAtTime');
  near(restore.at(-1).value, masterGain(DEFAULT_MASTER), 1e-12, 'master restored');
  assert.equal(engine.timerRemainingMs(), 0);
  await advance(4000);
  assert.equal(engine.getState().state, 'playing', 'no end after cancel');
});

test('armTimer before play waits for the session; a non-positive length cancels', async (t) => {
  const { engine, advance, events } = harness(t);
  engine.armTimer(120_000);
  assert.equal(engine.timerRemainingMs(), 120_000);
  assert.equal(engine.getState().timer.phase, 'paused');
  await advance(5000);
  assert.equal(engine.timerRemainingMs(), 120_000, 'not counting before play');
  await engine.play({ preset: calm() });
  await advance(2000);
  assert.ok(engine.timerRemainingMs() <= 118_100 && engine.timerRemainingMs() >= 117_900, `counting after play: ${engine.timerRemainingMs()}`);
  assert.equal(events.timer.at(-1).phase, 'running');
  engine.armTimer(0);
  assert.equal(engine.timerRemainingMs(), 0);
});

test('recover() when resume never settles → interrupted; the next tap resumes', async (t) => {
  const { engine, events, advance, ctx } = await playing(t);
  ctx().forceState('interrupted');
  ctx().behaviour.resume = 'hang';
  const recovered = engine.recover();
  await advance(1000);
  assert.equal(engine.getState().state, 'playing', 'still waiting inside the 1.5 s window');
  await advance(600);
  assert.equal(await recovered, false);
  assert.equal(engine.getState().state, 'interrupted');
  assert.equal(events.interrupted, 1);
  assert.equal(await engine.recover(), false, 'interrupted waits for a tap');
  ctx().behaviour.resume = 'ok';
  const resumed = engine.resume();
  assert.equal(engine.getState().state, 'starting');
  assert.equal(await resumed, true);
  await advance(900);
  assert.equal(engine.getState().state, 'playing');
  assert.equal(ctx().state, 'running');
});

test('recover() is a no-op while paused and re-arms the timer when the context already runs', async (t) => {
  const { engine, advance, ctx } = await playing(t);
  assert.equal(await engine.recover(), true, 'running: nothing to do');
  engine.pause();
  await advance(800);
  assert.equal(engine.getState().state, 'paused');
  assert.equal(await engine.recover(), false);
  assert.equal(ctx().state, 'suspended', 'no automatic resume while paused');
});

test('rebuild() closes the context, makes a second one and fades back in over 0.8 s', async (t) => {
  const { engine, factory, states, advance, ctx, masterGainNode } = await playing(t);
  engine.armTimer(300_000, { endFadeSeconds: 30 });
  const first = ctx();
  const rebuilt = engine.rebuild();
  assert.equal(factory.contexts.length, 2);
  assert.equal(ctx() !== first, true);
  assert.equal(await rebuilt, true);
  await settle();
  assert.equal(first.state, 'closed');
  assert.equal(ctx().state, 'running');
  const calls = masterGainNode().gain.calls;
  const lastHold = calls.findLastIndex((c) => c.method === 'cancelAndHoldAtTime');
  const ramps = calls.slice(lastHold).filter((c) => c.method === 'linearRampToValueAtTime');
  near(ramps[31].value, masterGain(DEFAULT_MASTER), 1e-12, 'fade-in target');
  near(ramps[31].time - ramps[0].time, 0.8 - 0.8 / 32, 1e-9, '0.8 s rebuild fade');
  await advance(900);
  assert.equal(engine.getState().state, 'playing');
  assert.deepEqual(states.slice(-2), ['starting', 'playing']);
  assert.ok(engine.timerRemainingMs() > 298_000, 'the wall-clock timer survived the rebuild');
  const endFade = masterGainNode().gain.calls.filter((c) => c.method === 'linearRampToValueAtTime' && c.value === 0);
  assert.ok(endFade.length > 0, 'the end fade was re-armed on the new master');
  const s = engine.getState();
  assert.equal(s.mode, 'binaural');
  assert.equal(s.carrierHz, 256);
});

test('unavailable when no AudioContext can be made (factory missing or throwing)', async (t) => {
  const factories = { missing: null, throwing: () => { throw new ReferenceError('AudioContext is not defined'); } };
  for (const [name, factory] of Object.entries(factories)) {
    await t.test(name, async (tt) => {
      const { engine, states, events } = harness(tt, { engineOptions: { audioContextFactory: factory } });
      assert.equal(await engine.unlock(), 'blocked');
      assert.equal(engine.getState().state, 'unavailable');
      assert.equal(await engine.play({ preset: calm() }), false);
      assert.deepEqual(states, ['unavailable']);
      assert.equal(events.warning[0].code, 'no-audio-context');
      assert.equal(await engine.stereoCheck(), false);
      assert.equal(await engine.purrCue(), false);
    });
  }
  const bare = createEngine({ audioContextFactory: undefined });
  assert.equal(await bare.unlock(), 'blocked');
  assert.equal(bare.getState().state, 'unavailable');
  bare.dispose();
});

test('blocked when the context will not run; a later unlock from a tap plays the pending preset', async (t) => {
  const { engine, states, events, advance, ctx } = harness(t, { factoryOptions: { behaviour: { resume: 'fail' } } });
  assert.equal(await engine.play({ preset: calm() }), false);
  assert.equal(engine.getState().state, 'blocked');
  assert.equal(events.blocked, 1);
  ctx().behaviour.resume = 'ok';
  assert.equal(await engine.unlock(), 'running');
  await settle();
  assert.equal(engine.getState().state, 'starting');
  await advance(1600);
  assert.equal(engine.getState().state, 'playing');
  assert.deepEqual(states, ['starting', 'blocked', 'idle', 'starting', 'playing']);
});

test('getLevels reflects setLayerLevel and setMuted; ambience layers start and stop with their level', async (t) => {
  const { engine, events, advance, ctx } = await playing(t);
  engine.setLayerLevel('rain', 0.5);
  assert.equal(engine.getLevels().rain, 0.25);
  engine.setMuted('rain', true);
  assert.equal(engine.getLevels().rain, 0);
  engine.setMuted('rain', false);
  assert.equal(engine.getLevels().rain, 0.25);
  engine.setLayerLevel('purr', 0.6);
  near(engine.getLevels().purr, 0.36, 1e-12);
  await advance(300);
  assert.ok(events.ready.includes('purr'), 'raising a slider from 0 starts that layer');
  engine.setMaster(1);
  assert.equal(engine.getLevels().master, 0.7);
  engine.setMaster(0.3);
  near(engine.getLevels().master, masterGain(0.3), 1e-12);
  assert.throws(() => engine.setLayerLevel('wind', 1), RangeError);
  const rainBus = ctx().nodesOf('gain')[4];
  const last = rainBus.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime').at(-1);
  assert.equal(last.value, 0.25);
  engine.setRainIntensity(0.9);
  engine.setOceanIntensity(0.1);
  assert.deepEqual(events.warning, []);
});

test('purrCue plays only while running and audible, through a dedicated gain into the master', async (t) => {
  const { engine, advance, ctx } = harness(t);
  assert.equal(await engine.purrCue(), false, 'idle: no cue');
  await engine.play({ preset: calm() });
  await advance(300);
  const cued = engine.purrCue();
  await advance(100);
  assert.equal(await cued, true);
  const master = ctx().nodesOf('gain')[0];
  const cueGain = ctx().nodesOf('gain').find((g) => g.isConnectedTo(master) && g.gain.calls.some((c) => c.method === 'linearRampToValueAtTime' && c.value === 0.25));
  assert.ok(cueGain, 'cue gain found, wired to the master, peaking at 0.25');
  const ramps = cueGain.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime');
  assert.equal(ramps.at(-1).value, 0);
  near(ramps.at(-1).time - ramps[0].time, 2.2 - 2.2 * (0.3 / 2.2 / 4), 0.01, 'about 2.2 s long');
  engine.setMaster(0);
  assert.equal(await engine.purrCue(), false, 'volume at zero: no cue');
});

test('stereoCheck: 1 s 440 Hz hard left then hard right at −24 dBFS, post-master; idle suspends again', async (t) => {
  const { engine, advance, ctx } = harness(t);
  const done = engine.stereoCheck();
  await settle();
  const checks = ctx().nodesOf('oscillator').filter((o) => o.frequency.value === 440);
  assert.equal(checks.length, 2);
  const panners = checks.map((o) => o.connections[0].target.connections[0].target);
  assert.deepEqual(panners.map((p) => p.pan.value), [-1, 1]);
  near(checks[1].started - checks[0].started, 1, 1e-9, 'right follows left after 1 s');
  const chimeIn = ctx().nodesOf('gain')[2];
  assert.ok(panners.every((p) => p.isConnectedTo(chimeIn)), 'post-master path');
  const peak = checks[0].connections[0].target.gain.calls.find((c) => c.method === 'linearRampToValueAtTime').value;
  near(20 * Math.log10(peak) - 1, -24, 0.01, 'amplitude lands at −24 dBFS after the −1 dB makeup+ceiling');
  await advance(2300);
  assert.equal(await done, true);
  assert.equal(ctx().state, 'suspended', 'idle again after the check');
  assert.equal(engine.getState().state, 'idle');
});

test('attune: sweep legs on the carrier, commit returns the held value, cancel glides back', async (t) => {
  const { engine, advance, carrier, ctx } = await playing(t);
  const before = carrier().offset.calls.length;
  engine.startAttune();
  const calls = carrier().offset.since(before).filter((c) => c.method === 'exponentialRampToValueAtTime');
  assert.deepEqual(calls.map((c) => c.value), [180, 520, 180], 'approach, then two legs ahead');
  near(calls[0].time - ctx().currentTime, 1.01, 1e-9, '1 s approach');
  near(calls[1].time - calls[0].time, 60, 1e-9, '60 s legs');
  await advance(61_000);
  const legs = carrier().offset.since(before).filter((c) => c.method === 'exponentialRampToValueAtTime');
  assert.equal(legs.length, 4, 'a third leg was scheduled by the timer');
  assert.equal(legs[3].value, 520);
  const hz = engine.commitAttune();
  assert.equal(typeof hz, 'number');
  assert.equal(engine.getState().carrierHz, hz);
  assert.equal(carrier().offset.calls.at(-1).method, 'setValueAtTime');
  engine.startAttune();
  engine.cancelAttune();
  const back = carrier().offset.calls.filter((c) => c.method === 'exponentialRampToValueAtTime').at(-1);
  assert.equal(back.value, hz, 'cancel glides back to the committed carrier');
  assert.equal(engine.commitAttune(), hz, 'commit without a sweep returns the current carrier');
});

test('setMode / setCarrier / setBeat / setTimbre / setPad reach the tone and survive into getState', async (t) => {
  const { engine, halfBeat, carrier, ctx } = await playing(t);
  engine.setMode('monaural');
  assert.equal(engine.getState().mode, 'monaural');
  engine.setCarrier(300);
  assert.equal(engine.getState().carrierHz, 300);
  assert.equal(carrier().offset.calls.at(-1).value, 300);
  const oscillatorsBefore = ctx().nodesOf('bufferSource').length;
  engine.setBeat(12);
  assert.equal(engine.getState().beatHz, 12);
  assert.equal(halfBeat().offset.calls.at(-1).value, 6);
  assert.equal(ctx().nodesOf('bufferSource').length, oscillatorsBefore, 'a small shape change keeps the gate period');
  engine.setBeat(40);
  assert.equal(ctx().nodesOf('bufferSource').length, oscillatorsBefore + 1, 'a large shape change re-renders the gate period');
  engine.setTimbre('glass');
  engine.setPad(false);
  engine.setMode('isochronic');
  assert.equal(engine.getState().mode, 'isochronic');
  assert.throws(() => engine.setMode('sideways'), RangeError);
});

test('setHidden reaches the scheduler and dispose closes the context', async (t) => {
  const { engine, ctx, events } = await playing(t);
  engine.setHidden(true);
  engine.setHidden(false);
  const c = ctx();
  engine.dispose();
  await settle();
  assert.equal(c.state, 'closed');
  assert.equal(engine.getState().state, 'idle');
  assert.deepEqual(events.warning, []);
});

test('lifecycle: detectPlatform, prepareSession, describeLimitations use feature detection only', () => {
  const queries = {};
  const matchMedia = (q) => ({ matches: Boolean(queries[q]) });
  assert.deepEqual(detectPlatform({ nav: {}, matchMedia }), { coarse: false, hasAudioSession: false, hasWakeLock: false, hasVibrate: false, standalone: false });
  queries['(pointer: coarse)'] = true;
  queries['(display-mode: standalone)'] = true;
  const apple = detectPlatform({ nav: { audioSession: { type: 'auto' }, wakeLock: {} }, matchMedia });
  assert.deepEqual(apple, { coarse: true, hasAudioSession: true, hasWakeLock: true, hasVibrate: false, standalone: true });
  assert.deepEqual(detectPlatform({ nav: undefined, matchMedia: undefined }), { coarse: false, hasAudioSession: false, hasWakeLock: false, hasVibrate: false, standalone: false });
  assert.deepEqual(describeLimitations(apple), { platform: 'apple', lines: limitationsCopy('apple') });
  assert.equal(describeLimitations({ coarse: true, hasAudioSession: false }).platform, 'android');
  assert.equal(describeLimitations({ coarse: false, hasAudioSession: true }).platform, 'desktop');
  const nav = { audioSession: { type: 'auto' } };
  assert.equal(prepareSession(nav), true);
  assert.equal(nav.audioSession.type, 'playback');
  assert.equal(prepareSession({}), false);
  const throwing = { audioSession: { set type(v) { throw new Error(`refused ${v}`); } } };
  assert.equal(prepareSession(throwing), false, 'a refusing setter is swallowed');
});

test('lifecycle: installLifecycle forwards visibility to the scheduler and recovers on statechange and visible', async (t) => {
  const { engine, advance, ctx } = await playing(t);
  const listeners = {};
  const doc = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const dispose = installLifecycle(engine, { doc, nav: {} });
  assert.equal(typeof listeners.visibilitychange, 'function');
  doc.visibilityState = 'hidden';
  listeners.visibilitychange();
  ctx().forceState('interrupted');
  ctx().behaviour.resume = 'hang';
  await advance(1600);
  assert.equal(engine.getState().state, 'interrupted', 'statechange → recover → interrupted after 1.5 s');
  ctx().behaviour.resume = 'ok';
  ctx().forceState('running');
  await advance(100);
  assert.equal(engine.getState().state, 'starting', 'the context coming back by itself restarts the session');
  await advance(900);
  assert.equal(engine.getState().state, 'playing');
  doc.visibilityState = 'visible';
  listeners.visibilitychange();
  await advance(100);
  assert.equal(engine.getState().state, 'playing');
  dispose();
  assert.equal(listeners.visibilitychange, undefined);
});

test('wake lock: opt-in, feature-detected, released on demand', async () => {
  assert.equal(await requestKeepAwake({}), false, 'no wakeLock API');
  assert.deepEqual(keepAwakeState(), { wanted: true, held: false });
  releaseKeepAwake();
  assert.deepEqual(keepAwakeState(), { wanted: false, held: false });
  let released = 0;
  const sentinel = { addEventListener() {}, release: async () => { released += 1; } };
  const nav = { wakeLock: { request: async (type) => { assert.equal(type, 'screen'); return sentinel; } } };
  assert.equal(await requestKeepAwake(nav), true);
  assert.deepEqual(keepAwakeState(), { wanted: true, held: true });
  assert.equal(await requestKeepAwake(nav), true, 'already held');
  releaseKeepAwake();
  await settle();
  assert.equal(released, 1);
  assert.deepEqual(keepAwakeState(), { wanted: false, held: false });
  const refusing = { wakeLock: { request: async () => { throw new Error('NotAllowedError'); } } };
  assert.equal(await requestKeepAwake(refusing), false);
  releaseKeepAwake();
});
