import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanonLayer } from '../docs/js/audio/canon.js';
import { createScheduler } from '../docs/js/audio/automation.js';
import { createCanonPlan, SCALE } from '../docs/js/core/canon.js';
import { canonVoicingFor } from '../docs/js/core/voicing.js';
import { mulberry32 } from '../docs/js/core/rng.js';
import { createFakeAudioContext, createFakeClock } from './helpers/fake-audio.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const STEP_S = 0.2;
const SEED = 11;

/** A running fake context and scheduler, a carrier and a pad input from outside the layer, and the layer's own nodes. */
function harness(t, { carrierHz = 264, seed = SEED } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createFakeClock(0);
  const ctx = createFakeAudioContext({ clock });
  ctx.resume();
  const carrier = ctx.createConstantSource();
  carrier.offset.value = carrierHz;
  const destination = ctx.createGain();
  const scheduler = createScheduler(ctx, { setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) });
  const before = ctx.nodes.length;
  const layer = createCanonLayer(ctx, { carrier, destination, scheduler, rng: mulberry32(seed) });
  const own = ctx.nodes.slice(before);
  const voices = own.filter((n) => n.kind === 'oscillator').map((osc) => ({
    osc,
    ratio: own.find((n) => n.kind === 'gain' && n.isConnectedTo(osc.frequency)),
    level: own.find((n) => n.kind === 'gain' && osc.isConnectedTo(n)),
  }));
  scheduler.start();
  /** Moves audio time and the timers together until context time `untilS`. */
  const runTo = (untilS) => {
    while (ctx.currentTime < untilS - 1e-9) {
      clock.advance(STEP_S);
      t.mock.timers.tick(STEP_S * 1000);
    }
  };
  /** The plan the layer runs: its seed is the first draw of the rng it was given. */
  const plan = createCanonPlan({ seed: Math.floor(mulberry32(seed)() * 2 ** 32) });
  t.after(() => scheduler.stop());
  return { ctx, clock, carrier, destination, scheduler, layer, own, voices, runTo, plan };
}

const phraseStarts = (param) => param.callsOf('setValueAtTime').filter((c) => c.value > 0).map((c) => c.time);
const glides = (param) => param.callsOf('setTargetAtTime');
const isScaleRatio = (r) => {
  const octave = Math.floor(Math.log2(r) + 1e-9);
  return SCALE.some((d) => Math.abs(d - r / 2 ** octave) < 1e-9);
};

test('wiring: two voices, each an oscillator at frequency 0 fed by the carrier through its own ratio gain, a [1, 0.12] wave and a silent level gain into the pad input', (t) => {
  const { ctx, own, voices, carrier, destination } = harness(t);
  assert.equal(voices.length, 2);
  assert.deepEqual(own.map((n) => n.kind).sort(), ['gain', 'gain', 'gain', 'gain', 'oscillator', 'oscillator']);
  for (const { osc, ratio, level } of voices) {
    assert.equal(osc.frequency.value, 0, 'intrinsic frequency 0');
    assert.equal(osc.started, 0, 'started with the layer');
    assert.deepEqual([...osc.periodicWave.imag].map((v) => Math.round(v * 100) / 100), [0, 1, 0.12]);
    assert.ok([...osc.periodicWave.real].every((v) => v === 0));
    assert.ok(carrier.isConnectedTo(ratio), 'the carrier drives the ratio gain');
    const feeds = ctx.nodes.filter((n) => n.isConnectedTo(osc.frequency));
    assert.deepEqual(feeds, [ratio], 'only the ratio gain drives the frequency');
    assert.ok(level.isConnectedTo(destination), 'the level gain feeds the pad input');
    assert.equal(level.gain.value, 0, 'silent until a phrase');
  }
});

test('only its own gains are automated: in 30 minutes of canon the carrier, the pad input and the oscillators get no automation, levels stay within voiceGain and notes within the scale and 1200 Hz', (t) => {
  const { layer, own, voices, carrier, destination, runTo } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  runTo(1800);
  assert.equal(carrier.offset.calls.length, 0, 'the carrier is read, never automated');
  assert.equal(destination.gain.calls.length, 0);
  const voiceGain = canonVoicingFor(264).voiceGain;
  for (const { osc, ratio, level } of voices) {
    assert.equal(osc.frequency.calls.length, 0, 'the frequency moves only through the ratio gain');
    assert.equal(osc.detune.calls.length, 0);
    assert.ok(phraseStarts(ratio.gain).length >= 5, 'several phrases in half an hour');
    for (const call of ratio.gain.calls.filter((c) => c.value !== undefined)) {
      assert.ok(isScaleRatio(call.value), `ratio ${call.value}`);
      assert.ok(call.value * 264 <= 1200, `${call.value * 264} Hz`);
    }
    for (const call of level.gain.calls.filter((c) => c.value !== undefined)) assert.ok(call.value >= 0 && call.value <= voiceGain + 1e-12, `level ${call.value}`);
  }
  const automated = own.flatMap((n) => Object.values(n).filter((v) => v && Array.isArray(v.calls) && v.calls.length > 0));
  const ownGains = voices.flatMap(({ ratio, level }) => [ratio.gain, level.gain]);
  assert.ok(automated.every((param) => ownGains.includes(param)), 'nothing but the ratio and level gains');
});

test('notes become automation: the first phrase opens entryS after enabling with its ratio and a 2.5 s swell, glides with τ 0.4 s, and releases over the last 3 s', (t) => {
  const { layer, voices, runTo, plan } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  const voiceGain = canonVoicingFor(264).voiceGain;
  const episode = plan.episode(0, plan.entryS, 264);
  assert.ok(plan.entryS >= 20 && plan.entryS <= 40);
  runTo(episode.endT + 1);
  ['dux', 'comes'].forEach((name, v) => {
    const notes = episode.notes.filter((n) => n.voice === name);
    if (notes.length === 0) return;
    const { ratio, level } = voices[v];
    const [first, ...legato] = notes;
    assert.deepEqual(ratio.gain.callsOf('setValueAtTime')[0], { method: 'setValueAtTime', value: first.ratio, time: first.startT });
    assert.deepEqual(glides(ratio.gain), legato.map((n) => ({ method: 'setTargetAtTime', value: n.ratio, time: n.startT, timeConstant: 0.4 })));
    const ramps = level.gain.callsOf('linearRampToValueAtTime');
    const swellEnd = ramps.find((c) => c.value === voiceGain);
    near(swellEnd.time, first.startT + 2.5, 1e-9, `${name} swell end`);
    const last = notes.at(-1);
    const end = last.startT + last.durationS;
    assert.ok(level.gain.calls.some((c) => c.method === 'setValueAtTime' && c.value === voiceGain && Math.abs(c.time - (end - 3)) < 1e-9), `${name} release starts 3 s before the end`);
    near(ramps.at(-1).time, end, 1e-9, `${name} release ends with the phrase`);
    assert.equal(ramps.at(-1).value, 0);
  });
});

test('episodes follow one another after rests of 10-30 s, and each voice changes note at most every 7 s', (t) => {
  const { layer, voices, runTo, plan } = harness(t, { carrierHz: 198, seed: 5 });
  layer.setCarrierHz(198);
  layer.setEnabled(true, 0);
  const runS = 1500;
  runTo(runS);
  const episodes = [plan.episode(0, plan.entryS, 198)];
  while (episodes.length < 50) {
    const last = episodes.at(-1);
    const startT = last.endT + plan.restS(episodes.length);
    if (startT > runS - 6) break;
    assert.ok(startT - last.endT >= 10 && startT - last.endT <= 30, `rest ${startT - last.endT} s`);
    episodes.push(plan.episode(episodes.length, startT, 198));
  }
  assert.ok(episodes.length >= 5, `${episodes.length} episodes in 25 minutes`);
  const starts = phraseStarts(voices[0].ratio.gain).filter((time) => time <= runS - 6);
  assert.equal(starts.length, episodes.length);
  starts.forEach((time, i) => near(time, episodes[i].startT, 1e-9, `episode ${i} start`));
  assert.ok(starts[0] >= 20 && starts[0] <= 40, 'the first entry comes after the pad entries');
  for (const { ratio } of voices) {
    const onsets = [...phraseStarts(ratio.gain), ...glides(ratio.gain).map((c) => c.time)].sort((a, b) => a - b);
    for (let i = 1; i < onsets.length; i++) assert.ok(onsets[i] - onsets[i - 1] >= 7 - 1e-9, `onsets ${onsets[i - 1]} → ${onsets[i]}`);
  }
});

test('setEnabled(false) releases the sounding voices over 3 s and plans nothing more; enabling again waits entryS', (t) => {
  const { ctx, layer, voices, runTo, plan } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  const episode = plan.episode(0, plan.entryS, 264);
  const off = episode.startT + episode.slotS + 1;
  runTo(off - 0.01);
  layer.setEnabled(false, off);
  const dux = voices[0];
  const ramps = dux.level.gain.callsOf('linearRampToValueAtTime');
  near(ramps.at(-1).time, off + 3, 1e-9, 'release length');
  assert.equal(ramps.at(-1).value, 0);
  assert.ok(dux.ratio.gain.calls.some((c) => c.method === 'cancelScheduledValues' && c.time === off), 'later glides dropped');
  const counts = voices.map(({ ratio, level }) => ratio.gain.calls.length + level.gain.calls.length);
  runTo(off + 600);
  assert.deepEqual(voices.map(({ ratio, level }) => ratio.gain.calls.length + level.gain.calls.length), counts, 'nothing planned while off');
  const on = ctx.currentTime;
  layer.setEnabled(true, on);
  runTo(on + plan.entryS + 1);
  assert.ok(phraseStarts(dux.ratio.gain).some((time) => Math.abs(time - (on + plan.entryS)) < 1e-9), 'back entryS after enabling');
});

test('hold() releases every sounding voice, cancels a swell not yet begun, and the next episode follows a rest', (t) => {
  const { layer, voices, runTo, plan } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  const episode = plan.episode(0, plan.entryS, 264);
  assert.equal(episode.alone, false);
  const comesStart = episode.startT + episode.k * episode.slotS;
  const at = comesStart - 2;
  runTo(at - 0.01);
  const [dux, comes] = voices;
  assert.ok(comes.level.gain.calls.length > 0, 'the comes swell is already scheduled');
  layer.hold(at);
  near(dux.level.gain.callsOf('linearRampToValueAtTime').at(-1).time, at + 3, 1e-9, 'the dux releases over 3 s');
  assert.deepEqual(comes.level.gain.calls.at(-1), { method: 'cancelAndHoldAtTime', value: undefined, time: at }, 'the comes swell is cancelled, not faded');
  const after = at + 3 + plan.restS(1);
  runTo(after + 1);
  const next = phraseStarts(dux.ratio.gain).filter((time) => time > at);
  near(next[0], after, 1e-9, 'the next episode starts a rest after the release');
  near(next[0] - (at + 3), plan.restS(1), 1e-9);
});

test('setCarrierHz: the same register keeps the phrase; another one releases it, and later notes keep the new cap and voiceGain', (t) => {
  const { ctx, layer, voices, carrier, runTo, plan } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  const episode = plan.episode(0, plan.entryS, 264);
  runTo(episode.startT + 1.5 * episode.slotS);
  const dux = voices[0];
  const before = dux.level.gain.calls.length;
  layer.setCarrierHz(270);
  carrier.offset.value = 270;
  assert.equal(dux.level.gain.calls.length, before, '270 Hz is still the mid register with the dux at 2f-4f');
  const at = ctx.currentTime + 0.01;
  const marks = { ratio: dux.ratio.gain.calls.length, level: dux.level.gain.calls.length };
  layer.setCarrierHz(440);
  carrier.offset.value = 440;
  near(dux.level.gain.callsOf('linearRampToValueAtTime').at(-1).time, at + 3, 1e-6, 'released over 3 s');
  assert.ok(dux.ratio.gain.since(marks.ratio).some((c) => c.method === 'cancelScheduledValues' && Math.abs(c.time - at) < 1e-6), 'planned glides dropped');
  runTo(at + 400);
  const later = dux.ratio.gain.since(marks.ratio).filter((c) => c.value !== undefined);
  assert.ok(later.length > 0, 'the canon came back');
  for (const call of later) assert.ok(call.value * 440 <= 1200 && call.value <= 2, `${call.value} × 440 Hz`);
  const levels = dux.level.gain.since(marks.level).filter((c) => c.value !== undefined).map((c) => c.value);
  assert.ok(levels.includes(canonVoicingFor(440).voiceGain), 'the high register voiceGain');
  assert.ok(Math.max(...levels) <= canonVoicingFor(264).voiceGain, 'the release starts from the old level at most');
});

test('no episode starts while the carrier is away from setCarrierHz (an Attune sweep); it resumes once the carrier settles', (t) => {
  const { ctx, layer, voices, carrier, runTo, plan } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  const episode = plan.episode(0, plan.entryS, 264);
  runTo(episode.startT + 1);
  const at = ctx.currentTime + 0.01;
  layer.hold(at);
  carrier.offset.value = 520;
  runTo(at + 180);
  const dux = voices[0];
  assert.deepEqual(phraseStarts(dux.ratio.gain).filter((time) => time > at), [], 'silent through the sweep');
  carrier.offset.value = 264;
  const settled = ctx.currentTime;
  runTo(settled + 8);
  const next = phraseStarts(dux.ratio.gain).filter((time) => time > at);
  assert.equal(next.length, 1, 'the next episode starts once the carrier is back');
  assert.ok(next[0] >= settled && next[0] <= settled + 6 + 1e-9, `starts at ${next[0]}, within the 6 s horizon of ${settled}`);
});

test('a scheduler that sleeps through notes releases the voices and rests instead of leaving a phrase hanging', (t) => {
  const { ctx, clock, scheduler, layer, voices, runTo, plan } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  const episode = plan.episode(0, plan.entryS, 264);
  runTo(episode.startT + 1);
  scheduler.stop();
  clock.advance(30);
  const woke = ctx.currentTime;
  scheduler.flush();
  scheduler.start();
  const dux = voices[0];
  const ramps = dux.level.gain.callsOf('linearRampToValueAtTime');
  assert.equal(ramps.at(-1).value, 0, 'released');
  near(ramps.at(-1).time, woke + 3, 1e-9, 'from the moment planning resumed');
  assert.ok(dux.ratio.gain.calls.every((c) => c.time === undefined || c.time < woke || c.method === 'cancelScheduledValues'), 'no stale note applied');
});

test('silent until it has a carrier: enabling first plans nothing, the carrier then starts the clock it already set', (t) => {
  const { layer, voices, runTo, plan } = harness(t);
  layer.setEnabled(true, 0);
  runTo(plan.entryS + 5);
  assert.ok(voices.every(({ ratio, level }) => ratio.gain.calls.length === 0 && level.gain.calls.length === 0));
  layer.setCarrierHz(264);
  runTo(plan.entryS + 10);
  assert.equal(phraseStarts(voices[0].ratio.gain).length, 1, 'the overdue first episode starts at once');
});

test('dispose stops both oscillators, disconnects the voices and plans nothing more', (t) => {
  const { ctx, layer, voices, runTo } = harness(t);
  layer.setCarrierHz(264);
  layer.setEnabled(true, 0);
  runTo(60);
  layer.dispose();
  for (const { osc, ratio, level } of voices) {
    assert.equal(osc.stopped, ctx.currentTime);
    assert.equal(level.connections.length, 0, 'the voice leaves the pad');
    assert.equal(ratio.connections.length, 0, 'the ratio gain no longer drives the oscillator');
  }
  const counts = voices.map(({ ratio, level }) => ratio.gain.calls.length + level.gain.calls.length);
  runTo(600);
  assert.deepEqual(voices.map(({ ratio, level }) => ratio.gain.calls.length + level.gain.calls.length), counts);
  layer.dispose();
});
