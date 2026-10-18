import { DEFAULT_SETTINGS } from '../docs/js/core/state.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, STATES } from '../docs/js/audio/engine.js';
import { detectPlatform, prepareSession, installLifecycle, describeLimitations, requestKeepAwake, releaseKeepAwake, keepAwakeState } from '../docs/js/audio/lifecycle.js';
import { createToneLayer } from '../docs/js/audio/tone.js';
import { createBufferCache, prewarmLoops } from '../docs/js/audio/buffers.js';
import { getPreset, resolvePreset } from '../docs/js/core/presets.js';
import { masterGain, layerGain } from '../docs/js/core/levels.js';
import { limitationsCopy } from '../docs/js/core/microcopy.js';
import { mulberry32 } from '../docs/js/core/rng.js';
import { entrancePlan, entranceEnd } from '../docs/js/core/entrance.js';
import { createTexture } from '../docs/js/core/texture-model.js';
import { PAD_SLOTS } from '../docs/js/core/voicing.js';
import { createContextFactory, createFakeAudioContext, settle } from './helpers/fake-audio.js';

const T0 = 1_700_000_000_000;
const DEFAULT_MASTER = DEFAULT_SETTINGS.mix.master; // the engine starts from the store's default volume
const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const DESK = { listening: 'headphones', device: 'desktop' };
const calm = (options = {}) => resolvePreset(getPreset('calm'), { ...DESK, ...options });
const sleep = () => resolvePreset(getPreset('sleep'), DESK);
/** Milliseconds until a fresh session of `resolved` reaches 'playing' at the default mix, plus a margin. */
const arrivalMs = (resolved) => Math.ceil(entranceEnd(entrancePlan(resolved.mood, DEFAULT_SETTINGS)) * 1000) + 100;
/** The texture a harness engine draws for its first graph (mulberry32(1), one draw at the end of createGraph). */
const firstTexture = () => createTexture(Math.floor(mulberry32(1)() * 2 ** 32) >>> 0);

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
  const bus = (layer) => ctx().nodesOf('gain')[{ tone: 3, rain: 4, ocean: 5, purr: 6 }[layer]];
  const carrier = () => ctx().nodesOf('constant')[0];
  const halfBeat = () => ctx().nodesOf('constant')[1];
  t.after(() => engine.dispose());
  return { engine, factory, nav, states, events, advance, ctx, masterGainNode, toneBus, bus, carrier, halfBeat };
}

async function playing(t, options, resolved = calm()) {
  const h = harness(t, options);
  await h.engine.play({ preset: resolved });
  await h.advance(arrivalMs(resolved));
  assert.equal(h.engine.getState().state, 'playing');
  return h;
}

/** Nodes of `ctx` wired straight into `target` (a node or an AudioParam), in creation order. */
const feeders = (ctx, target) => ctx.nodes.filter((n) => n.connections.some((c) => c.target === target));

/** The tone layer's pad nodes in a fake context: the sum the slots feed, its low-pass and the five slot levels by name. */
function padNodes(ctx) {
  const lpPad = ctx.nodesOf('biquad').find((f) => f.Q.value === 0.7 && feeders(ctx, f).length === 1 && feeders(ctx, f)[0].kind === 'gain');
  const padInput = feeders(ctx, lpPad)[0];
  const levels = feeders(ctx, padInput).slice(0, PAD_SLOTS.length);
  return { lpPad, padInput, slots: Object.fromEntries(PAD_SLOTS.map(({ name }, i) => [name, levels[i].gain])) };
}

test('STATES lists the contract states in order', () => {
  assert.deepEqual([...STATES], ['idle', 'starting', 'playing', 'pausing', 'paused', 'ending', 'ended', 'ambient', 'blocked', 'interrupted', 'unavailable']);
});

// First in the file on purpose: generated loops are shared by every engine in the process, so this is the
// only test that sees the store empty and the prewarm generating everything.
test('prewarm() generates every loop and the kit without an AudioContext, once, a macrotask at a time; the cache then builds 48 kHz buffers on a 44.1 kHz context', async (t) => {
  const { engine, factory, advance, ctx, events } = harness(t, { factoryOptions: { sampleRate: 44100 } });
  let warmed = false;
  engine.prewarm().then(() => { warmed = true; });
  engine.prewarm();
  assert.equal(prewarmLoops(), prewarmLoops(), 'one prewarm per page, however often it is asked for');
  assert.equal(factory.contexts.length, 0, 'no context before a gesture');
  await advance(200);
  assert.equal(warmed, false, 'generation yields to the event loop between channels and kit variants');
  await advance(2800);
  assert.equal(warmed, true, 'seven bed channels and 24 drop variants, one macrotask each');
  assert.equal(factory.contexts.length, 0);
  assert.deepEqual(events.warning, []);
  await engine.play({ preset: calm() });
  await advance(arrivalMs(calm()));
  assert.deepEqual([...events.ready].sort(), ['ocean', 'purr', 'rain']);
  const loops = ctx().buffers.filter((b) => b.length === 6 * 48000);
  assert.equal(loops.length, 5, 'one buffer per bed');
  assert.ok(loops.every((b) => b.sampleRate === 48000), 'loops keep the 48 kHz generation rate');
  const kit = ctx().buffers.filter((b) => b.numberOfChannels === 2 && b.length <= 0.13 * 48000);
  assert.equal(kit.length, 24);
  assert.ok(kit.every((b) => b.sampleRate === 48000));
  const gates = ctx().buffers.filter((b) => b.numberOfChannels === 1 && b.length === Math.round(44100 / 10));
  assert.ok(gates.length >= 1 && gates.every((b) => b.sampleRate === 44100), 'gate periods stay at the context rate');
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
  assert.deepEqual(states, ['starting'], 'still settling in while the calm entrance runs');
  await advance(2700);
  assert.deepEqual(states, ['starting', 'playing'], 'playing once the tone has arrived (4.2 s)');
  assert.deepEqual([...events.ready].sort(), ['ocean', 'purr', 'rain'], 'the default mix runs rain, ocean and purr');
  const s = engine.getState();
  assert.equal(s.mode, 'binaural');
  assert.equal(s.carrierHz, 264);
  assert.equal(s.beatHz, 10);
  assert.equal(s.presetId, 'calm');
  assert.equal(s.sampleRate, 48000);
  assert.ok(ctx().nodesOf('oscillator').length >= 11, 'voices and pad slots exist');
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
  assert.equal(exp.value, 198, 'headphones carrier of Sleep');
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
  await advance(arrivalMs(calm()));
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

test('timer with after:"stop": ending → ended with a soft chime at the session pitch and volume into chimeIn, context suspended', async (t) => {
  const { engine, states, advance, ctx } = await playing(t);
  engine.armTimer(3000, { endFadeSeconds: 1, chime: 'soft', after: 'stop' });
  await advance(3200);
  assert.equal(engine.getState().state, 'ending');
  const chimeIn = ctx().nodesOf('gain')[2];
  const chimes = ctx().nodesOf('oscillator').filter((o) => o.frequency.value === 528 || o.frequency.value === 792);
  assert.equal(chimes.length, 2, 'two chime notes: the octave and twelfth of the 264 Hz carrier');
  assert.deepEqual(chimes.map((o) => o.frequency.value), [528, 792]);
  assert.ok(chimes.every((o) => o.connections[0].target.isConnectedTo(chimeIn)), 'chime envelope → chimeIn');
  near(chimes[1].started - chimes[0].started, 0.8, 1e-9, 'second note 0.8 s later');
  const peak = Math.max(...chimes[0].connections[0].target.gain.callsOf('linearRampToValueAtTime').map((c) => c.value));
  near(peak, 0.15 * layerGain(DEFAULT_MASTER), 1e-6, 'peak follows the volume slider (−31.4 dBFS at 0.45)');
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
  assert.equal(s.carrierHz, 264);
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
  await advance(arrivalMs(calm()));
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
  const { engine, advance, ctx, bus } = harness(t);
  assert.equal(await engine.purrCue(), false, 'idle: no cue');
  await engine.play({ preset: calm() });
  await advance(300);
  const cued = engine.purrCue();
  await advance(100);
  assert.equal(await cued, true);
  const master = ctx().nodesOf('gain')[0];
  const buses = ['tone', 'rain', 'ocean', 'purr'].map(bus);
  const cueGain = ctx().nodesOf('gain').find((g) => g.isConnectedTo(master) && !buses.includes(g) && g.gain.calls.some((c) => c.method === 'linearRampToValueAtTime' && c.value === 0.25));
  assert.ok(cueGain, 'cue gain found, wired to the master, peaking at 0.25');
  const ramps = cueGain.gain.calls.filter((c) => c.method === 'linearRampToValueAtTime');
  assert.equal(ramps.at(-1).value, 0);
  near(ramps.at(-1).time - ramps[0].time, 2.2 - 2.2 * (0.3 / 2.2 / 4), 0.01, 'about 2.2 s long');
  engine.setMaster(0);
  assert.equal(await engine.purrCue(), false, 'volume at zero: no cue');
});

test('stereoCheck: 1.5 s of 440 Hz hard left, a 0.5 s gap, 1.5 s hard right at −30 dBFS with 60 ms edges, post-master; resolves at 3.5 s, idle suspends again', async (t) => {
  const { engine, advance, ctx } = harness(t);
  let resolved = false;
  const done = engine.stereoCheck();
  done.then(() => { resolved = true; });
  await settle();
  const checks = ctx().nodesOf('oscillator').filter((o) => o.frequency.value === 440);
  assert.equal(checks.length, 2);
  const panners = checks.map((o) => o.connections[0].target.connections[0].target);
  assert.deepEqual(panners.map((p) => p.pan.value), [-1, 1]);
  near(checks[1].started - checks[0].started, 2, 1e-9, 'right starts 2 s after left: 1.5 s tone, 0.5 s gap');
  const chimeIn = ctx().nodesOf('gain')[2];
  assert.ok(panners.every((p) => p.isConnectedTo(chimeIn)), 'post-master path');
  for (const osc of checks) {
    const env = osc.connections[0].target.gain;
    const [rise, holdEnd, fall] = [env.callsOf('linearRampToValueAtTime')[0], env.callsOf('setValueAtTime')[1], env.callsOf('linearRampToValueAtTime')[1]];
    near(20 * Math.log10(rise.value) - 1, -30, 0.01, 'amplitude lands at −30 dBFS after the −1 dB makeup+ceiling');
    near(rise.time - osc.started, 0.06, 1e-9, '60 ms rise');
    near(holdEnd.time - osc.started, 1.44, 1e-9, 'held until 60 ms before the end');
    near(fall.time - osc.started, 1.5, 1e-9, '1.5 s tone');
    assert.equal(fall.value, 0);
  }
  await advance(3400);
  assert.equal(resolved, false, 'not before 3.5 s');
  await advance(150);
  assert.equal(await done, true);
  assert.equal(ctx().state, 'running', 'still running when it resolves, so a session can follow inside the same gesture');
  await advance(600);
  assert.equal(ctx().state, 'suspended', 'idle: suspended once the right tone has ended');
  assert.equal(engine.getState().state, 'idle');
});

test('stereoCheck followed at once by play: the context is never suspended in between', async (t) => {
  const { engine, advance, ctx } = harness(t);
  const suspends = [];
  const done = engine.stereoCheck();
  await settle();
  const real = ctx().suspend;
  ctx().suspend = () => {
    suspends.push(ctx().currentTime);
    return real();
  };
  await advance(3550);
  assert.equal(await done, true);
  await engine.play({ preset: calm() });
  await advance(arrivalMs(calm()));
  assert.equal(engine.getState().state, 'playing');
  assert.deepEqual(suspends, []);
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

// --- 0.4: entrance, prewarm, unlock limit, pad voicing and entries, texture, entrainment safety ----------------

const LAYER_NAMES = ['tone', 'rain', 'ocean', 'purr'];
const linear = (c) => c.method === 'linearRampToValueAtTime';

test('play(sleep) from idle enters by mood: buses pinned at 0, ocean from 0 s over 3 s, purr from 1.2 s, tone from 2.5 s over 4 s, rain from 4 s; playing at 6.5 s', async (t) => {
  const { engine, advance, bus, states } = harness(t);
  const entrances = [];
  engine.on('entrance', (e) => entrances.push(e));
  await engine.play({ preset: sleep() });
  assert.deepEqual(entrances, [{ steps: entrancePlan('sleepy', DEFAULT_SETTINGS), endS: 6.5 }]);
  const t0 = bus('ocean').gain.calls.filter(linear).at(-1).time - 3;
  for (const layer of LAYER_NAMES) {
    const calls = bus(layer).gain.calls;
    const pinned = calls.some((c, i) => c.method === 'setValueAtTime' && c.value === 0 && Math.abs(c.time - t0) < 1e-9 && calls[i - 1]?.method === 'cancelAndHoldAtTime');
    assert.ok(pinned, `${layer} bus pinned at 0 at the session start`);
  }
  const plan = { ocean: [0, 3], purr: [1.2, 3], tone: [2.5, 4], rain: [4, 4] };
  for (const [layer, [atS, seconds]] of Object.entries(plan)) {
    const ramps = bus(layer).gain.calls.filter(linear);
    assert.equal(ramps.length, 32, `${layer}: one S-curve`);
    near(ramps[0].time, t0 + atS + seconds / 32, 1e-9, `${layer} starts at +${atS} s`);
    near(ramps.at(-1).time, t0 + atS + seconds, 1e-9, `${layer} arrives after ${seconds} s`);
    near(ramps.at(-1).value, layerGain(DEFAULT_SETTINGS.mix[layer]), 1e-12, `${layer} level`);
    near(ramps[15].value, layerGain(DEFAULT_SETTINGS.mix[layer]) / 2, 1e-6, `${layer} S-curve midpoint`);
  }
  await advance(6400);
  assert.equal(engine.getState().state, 'starting', 'settling in until the tone has arrived');
  await advance(200);
  assert.equal(engine.getState().state, 'playing');
  assert.deepEqual(states, ['starting', 'playing']);
});

test('resume after a pause keeps the 0.8 s fade: no entrance, no bus ramps, the pad entries are not replayed', async (t) => {
  const { engine, advance, ctx, bus, masterGainNode } = await playing(t, undefined, sleep());
  const entrances = [];
  engine.on('entrance', (e) => entrances.push(e));
  engine.pause();
  await advance(800);
  const { slots } = padNodes(ctx());
  const busCalls = LAYER_NAMES.map((layer) => bus(layer).gain.calls.length);
  const slotCalls = Object.values(slots).map((p) => p.calls.length);
  const masterCalls = masterGainNode().gain.calls.length;
  assert.equal(await engine.resume(), true);
  const up = masterGainNode().gain.since(masterCalls).filter(linear);
  near(up.at(-1).time - up[0].time, 0.8 - 0.8 / 32, 1e-9, '0.8 s resume fade');
  await advance(900);
  assert.equal(engine.getState().state, 'playing');
  assert.deepEqual(entrances, []);
  LAYER_NAMES.forEach((layer, i) => assert.ok(!bus(layer).gain.since(busCalls[i]).some(linear), `${layer} bus does not enter again`));
  Object.values(slots).forEach((p, i) => assert.equal(p.calls.length, slotCalls[i], 'pad slots untouched'));
});

test('unlock() gives up after 1.5 s when resume() hangs: blocked, and a late resume leaves it blocked until the next tap', async (t) => {
  const { engine, advance, ctx, events, states } = harness(t, { factoryOptions: { behaviour: { resume: 'hang' } } });
  let started = null;
  engine.play({ preset: calm() }).then((ok) => { started = ok; });
  await advance(1400);
  assert.equal(started, null, 'still waiting inside the 1.5 s window');
  assert.equal(engine.getState().state, 'starting');
  await advance(200);
  assert.equal(started, false);
  assert.equal(engine.getState().state, 'blocked');
  assert.equal(events.blocked, 1);
  ctx().forceState('running');
  await advance(2000);
  assert.equal(engine.getState().state, 'blocked', 'the late resume does not start a session by itself');
  ctx().behaviour.resume = 'ok';
  assert.equal(await engine.unlock(), 'running', 'the next tap');
  await advance(arrivalMs(calm()));
  assert.equal(engine.getState().state, 'playing', 'and it plays the pending preset');
  assert.deepEqual(states, ['starting', 'blocked', 'idle', 'starting', 'playing']);
});

test('the tone layer drives exactly 11 oscillators from the carrier (L, R, carrier pair, fifth pair, octave pair, sub, twelfth, double) and has no LFO', () => {
  const ctx = createFakeAudioContext();
  const tone = createToneLayer(ctx, ctx.createGain(), createBufferCache(ctx), { carrierHz: 264, beatHz: 6, mode: 'binaural', timbre: 'velvet' });
  tone.start();
  const carrierDriven = (osc) => feeders(ctx, osc.frequency).some((n) => n === tone.carrierNode || tone.carrierNode.isConnectedTo(n));
  const oscillators = ctx.nodesOf('oscillator');
  assert.equal(oscillators.filter(carrierDriven).length, 11);
  assert.equal(oscillators.length, 11, 'every oscillator follows the carrier');
  assert.ok(oscillators.every((o) => o.frequency.value === 0 && o.frequency.calls.length === 0), 'intrinsic frequency 0, never automated');
  assert.equal(tone.carrierNode, ctx.nodesOf('constant')[0]);
  const { padInput, lpPad } = padNodes(ctx);
  assert.equal(tone.padInput, padInput, 'padInput feeds the pad low-pass');
  assert.equal(tone.textureParams.padFilter, lpPad.frequency);
  assert.deepEqual(tone.textureNominal(), { padBus: 10 ** (-14 / 20), padFilterHz: 1584 });
  assert.equal(tone.getState().register, 'mid');
});

test('entrainment safety over a 60 s Sleep session: the beat path is never automated, voices stay sines, only the purr oscillator has a frequency of its own', async (t) => {
  const { advance, ctx, carrier, halfBeat, toneBus } = await playing(t, undefined, sleep());
  const c = ctx();
  const [binaural, monaural, isochronic] = feeders(c, toneBus());
  const panners = feeders(c, binaural);
  const voices = panners.flatMap((p) => feeders(c, p));
  const [vM] = feeders(c, monaural);
  const [gateNode] = feeders(c, isochronic);
  const [lpC] = feeders(c, gateNode);
  const [vIso] = feeders(c, lpC);
  const gateSources = feeders(c, gateNode.gain).flatMap((mix) => feeders(c, mix));
  const watched = [
    ['carrier.offset', carrier().offset], ['halfBeat.offset', halfBeat().offset], ['vL', voices[0].gain], ['vR', voices[1].gain], ['vM', vM.gain],
    ['panL', panners[0].pan], ['panR', panners[1].pan], ['binaural', binaural.gain], ['monaural', monaural.gain], ['isochronic', isochronic.gain],
    ['gateNode', gateNode.gain], ['vIso', vIso.gain], ...gateSources.map((source, i) => [`gate source ${i}`, source.playbackRate]),
  ];
  assert.ok(gateSources.length >= 1);
  const before = watched.map(([, param]) => param.calls.length);
  await advance(60_000, 200);
  watched.forEach(([name, param], i) => assert.equal(param.calls.length, before[i], `${name} was automated during the session`));
  for (const voice of voices) assert.ok(feeders(c, voice).every((osc) => osc.kind === 'oscillator' && osc.type === 'sine'), 'beat voices are sines');
  const own = c.nodesOf('oscillator').filter((o) => o.frequency.value !== 0 || o.frequency.calls.length > 0);
  assert.equal(own.length, 1, 'no LFO: one oscillator with a frequency of its own');
  near(own[0].frequency.value, 26, 1.1, 'the disclosed ~26 Hz purr');
  const { lpPad } = padNodes(c);
  assert.ok(lpPad.frequency.callsOf('setTargetAtTime').length >= 60 / 8.1, 'meanwhile the pad filter breathes on the texture knots');
});

test("'texture' snapshots once per second with inMs ≥ 0 from the graph's texture; 'wave' carries a set strength in [0, 1]", async (t) => {
  const { engine, advance, events } = await playing(t);
  const snapshots = [];
  engine.on('texture', (e) => snapshots.push(e));
  await advance(30_000, 200);
  assert.ok(snapshots.length >= 29, `${snapshots.length} snapshots in 30 s`);
  const texture = firstTexture();
  snapshots.forEach((s, i) => {
    assert.deepEqual(Object.keys(s), ['at', 'inMs', 'pad', 'gust', 'set']);
    assert.ok(Number.isInteger(s.at) && s.inMs >= 0 && s.inMs <= 5000, `at ${s.at}, inMs ${s.inMs}`);
    if (i > 0) assert.equal(s.at, snapshots[i - 1].at + 1, 'one per whole second');
    near(s.pad, texture.padBus.at(s.at), 1e-12, 'the pad curve of the graph seed');
    for (const key of ['pad', 'gust', 'set']) assert.ok(Math.abs(s[key]) <= 1);
  });
  assert.ok(events.wave.length >= 2);
  for (const wave of events.wave) {
    assert.ok(wave.strength >= 0 && wave.strength <= 1, `strength ${wave.strength}`);
    assert.ok(wave.inMs >= 0 && wave.duration > 0);
  }
});

test('the three ambience layers ride the texture: rain gust and ocean sway knots at the texture times, purr breaths drift below full depth', async (t) => {
  const { advance, ctx, bus } = await playing(t);
  await advance(60_000, 200);
  const c = ctx();
  const texture = firstTexture();
  const tauTwo = (param) => param.callsOf('setTargetAtTime').filter((call) => call.timeConstant === 2);
  const knotTimes = (ticks) => new Set(ticks.map((k) => k.t));
  const [rainOut] = feeders(c, bus('rain'));
  const [bedGain] = feeders(c, rainOut);
  const gusts = tauTwo(bedGain.gain);
  assert.ok(gusts.length >= 50 / 8.1, `${gusts.length} gust knots`);
  const gustKnots = knotTimes(texture.gustTicks(0, 70));
  assert.ok(gusts.every((call) => gustKnots.has(call.time)), 'bed glides land on the gust knots');
  const [oceanOut] = feeders(c, bus('ocean'));
  const [surfSway] = feeders(c, oceanOut);
  const sways = tauTwo(surfSway.gain);
  assert.ok(sways.length >= 50 / 8.1, `${sways.length} sway knots`);
  const surfKnots = knotTimes(texture.surfTicks(0, 90));
  for (const call of sways) {
    assert.ok(surfKnots.has(call.time), 'sway on the surf knots');
    near(call.value, 10 ** ((3 * (texture.surf.at(call.time) - 1)) / 40), 1e-12, 'mapDb(surf, 3)');
  }
  const [purrOut] = feeders(c, bus('purr'));
  const [breath] = feeders(c, purrOut);
  const peaks = breath.gain.calls.filter(linear).map((call) => call.value);
  const deepest = Math.max(...peaks);
  assert.ok(deepest < 1 && deepest >= 10 ** (-2 / 20) - 1e-9, `breath depth ${deepest} follows the texture amplitude`);
});

test('pad entries start with the tone: octave at once, twelfth from +12 s over 8 s (ending 20 s after the tone enters), sub from +24 s; no fifth or double below 240 Hz', async (t) => {
  const { engine, ctx, bus } = harness(t);
  await engine.play({ preset: sleep() });
  const toneT = bus('tone').gain.calls.filter(linear).at(-1).time - 4;
  const { slots } = padNodes(ctx());
  const expected = { octave: [0, 1.5, 0.6], twelfth: [12, 8, 0.35], sub: [24, 10, 0.45] };
  for (const [name, [at, seconds, target]] of Object.entries(expected)) {
    const calls = slots[name].calls;
    assert.ok(calls.some((c) => c.method === 'setValueAtTime' && c.value === 0 && Math.abs(c.time - toneT) < 1e-9), `${name} pinned at 0 when the tone enters`);
    const swell = calls.filter(linear).slice(-32);
    near(swell[0].time, toneT + at + seconds / 32, 1e-9, `${name} swells from +${at} s`);
    near(swell.at(-1).time, toneT + at + seconds, 1e-9, `${name} arrives`);
    near(swell.at(-1).value, target, 1e-12, `${name} target`);
  }
  near(slots.twelfth.calls.filter(linear).at(-1).time - toneT, 20, 1e-9, 'twelfth ends 20 s after the tone enters');
  assert.deepEqual(slots.fifth.calls, [], 'no fifth at 198 Hz');
  assert.deepEqual(slots.double.calls, [], 'no double octave at 198 Hz');
});

test('setCarrier(110) from 264 re-voices over 6 s: fifth → 0, twelfth → 0.3, double → 0.15; sub and octave are left alone', async (t) => {
  const { engine, ctx } = await playing(t, undefined, calm({ padStyle: 'drone' }));
  const { slots } = padNodes(ctx());
  const before = Object.fromEntries(Object.entries(slots).map(([name, p]) => [name, p.calls.length]));
  const at = ctx().currentTime + 0.01;
  engine.setCarrier(110);
  for (const [name, value] of [['fifth', 0], ['twelfth', 0.3], ['double', 0.15]]) {
    const ramps = slots[name].since(before[name]).filter(linear);
    assert.equal(ramps.length, 1, `${name}: one linear crossfade`);
    near(ramps[0].value, value, 1e-12, `${name} target`);
    near(ramps[0].time - at, 6, 1e-9, `${name} over 6 s`);
  }
  assert.deepEqual(slots.octave.since(before.octave), [], 'octave untouched');
  assert.deepEqual(slots.sub.since(before.sub), [], 'sub untouched (0.40 in both registers)');
  assert.equal(engine.getState().carrierHz, 110);
});

test('setTimbre("bell") moves the carrier low-pass drive to 7·f; startAttune never touches the pad slots', async (t) => {
  const { engine, ctx, advance } = await playing(t);
  const c = ctx();
  const lpC = c.nodesOf('biquad').find((f) => f.Q.value === 0.6);
  const [lpDrive] = feeders(c, lpC.frequency);
  assert.equal(lpDrive.gain.value, 4, 'velvet: 4·f');
  const at = c.currentTime + 0.01;
  engine.setTimbre('bell');
  assert.deepEqual(lpDrive.gain.calls.at(-1), { method: 'setTargetAtTime', value: 7, time: at, timeConstant: 0.3 });
  const { slots } = padNodes(c);
  const before = Object.values(slots).map((p) => p.calls.length);
  engine.startAttune();
  await advance(5000);
  engine.cancelAttune();
  Object.values(slots).forEach((p, i) => assert.equal(p.calls.length, before[i], 'the sweep does not re-voice the pad'));
});

test('setBeat keeps a gentle preset gentle: Sleep at 4 Hz keeps its soft gate, a large change still re-renders', async (t) => {
  const { engine, ctx } = await playing(t, undefined, sleep());
  const sources = () => ctx().nodesOf('bufferSource').length;
  const n = sources();
  engine.setBeat(4);
  assert.equal(sources(), n, 'gateParams(4, { gentle: true }) is the gate already playing');
  engine.setBeat(40);
  assert.equal(sources(), n + 1, 'a large shape change re-renders the gate period');
});

test('pad style: Calm under Auto plays the canon voicing (upper slots silent) and reports canon; Drone brings the slots back over 6 s', async (t) => {
  const { engine, ctx } = await playing(t);
  assert.equal(engine.getState().canon, true, 'Auto picks Canon for a calm preset');
  const { slots } = padNodes(ctx());
  for (const name of ['fifth', 'twelfth', 'double']) assert.deepEqual(slots[name].calls, [], `${name} stays silent under the canon voices`);
  near(slots.octave.calls.filter(linear).at(-1).value, 0.6, 1e-12);
  near(slots.sub.calls.filter(linear).at(-1).value, 0.4, 1e-12);
  engine.setPad(false);
  assert.equal(engine.getState().canon, false, 'no pad, no canon');
  engine.setPad(true);
  assert.equal(engine.getState().canon, true);
  const at = ctx().currentTime + 0.01;
  engine.applyPreset(calm({ padStyle: 'drone' }));
  assert.equal(engine.getState().canon, false);
  const fifth = slots.fifth.calls.filter(linear).at(-1);
  near(fifth.value, 0.4, 1e-12, 'the fifth returns');
  near(fifth.time - at, 6, 1e-9, 'over the 6 s voicing crossfade');
  engine.applyPreset(sleep());
  assert.equal(engine.getState().canon, false, 'Sleep stays drone under Auto');
});

test('setCanon switches drone ⇄ canon without a preset re-apply: no new beat or carrier automation, getState().canon follows', async (t) => {
  const { engine, advance, halfBeat, carrier } = await playing(t, undefined, calm({ padStyle: 'drone' }));
  assert.equal(engine.getState().canon, false, 'Calm resolved with padStyle drone');
  const beatCalls = halfBeat().offset.calls.length;
  const carrierCalls = carrier().offset.calls.length;
  engine.setCanon(true);
  await advance(100);
  assert.equal(engine.getState().canon, true);
  engine.setCanon(false);
  await advance(100);
  assert.equal(engine.getState().canon, false);
  assert.equal(halfBeat().offset.calls.length, beatCalls, 'the beat (and any Sleep glide) is left alone');
  assert.equal(carrier().offset.calls.length, carrierCalls, 'the carrier is left alone');
});
