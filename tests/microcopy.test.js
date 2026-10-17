import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRINGS,
  statusLine,
  fill,
  formatHz,
  formatPitch,
  formatPercent,
  formatTimeLeft,
  formatMinutes,
  limitationsCopy,
} from '../docs/js/core/microcopy.js';

const STATES = ['idle', 'starting', 'playing', 'pausing', 'paused', 'ending', 'ended', 'ambient', 'blocked', 'interrupted', 'unavailable'];
const CTX = { presetName: 'Calm', beatHz: 10, band: 'alpha' };

function* walk(value, path = 'STRINGS') {
  if (typeof value === 'string') yield [path, value];
  else if (Array.isArray(value)) for (const [i, v] of value.entries()) yield* walk(v, `${path}[${i}]`);
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) yield* walk(v, `${path}.${k}`);
}

test('STRINGS is deep-frozen and holds the required groups', () => {
  assert.ok(Object.isFrozen(STRINGS));
  assert.ok(Object.isFrozen(STRINGS.settings.listening));
  assert.ok(Object.isFrozen(STRINGS.limitations.apple));
  for (const group of ['app', 'orb', 'status', 'toasts', 'firstRun', 'settings', 'fineTuning', 'timer', 'about', 'cats', 'limitations']) {
    assert.ok(STRINGS[group], `group ${group}`);
  }
  assert.equal(STRINGS.app.title, 'Brain Tune');
  assert.equal(STRINGS.app.tagline, 'Set your head straight');
  assert.equal(STRINGS.firstRun.button, "Let's begin");
  assert.equal(STRINGS.about.privacy, 'Nothing leaves your device.');
  for (const row of ['listening', 'stereoCheck', 'cats', 'keepAwake', 'theme', 'stillMode', 'scene', 'haptics', 'nightDim', 'shortcuts', 'addToHome', 'reset']) {
    assert.equal(typeof STRINGS.settings[row].label, 'string', row);
    assert.equal(typeof STRINGS.settings[row].description, 'string', row);
  }
  for (const key of ['beat', 'pitch', 'timbre', 'pad', 'beatStyle']) {
    assert.equal(typeof STRINGS.fineTuning[key], 'string');
    assert.equal(typeof STRINGS.fineTuning.explainer[key], 'string');
  }
});

test('no string contains an exclamation mark or the word error, and every string is non-empty', () => {
  let count = 0;
  for (const [path, s] of walk(STRINGS)) {
    count += 1;
    assert.ok(s.trim().length > 0, path);
    assert.ok(!s.includes('!'), `${path} has "!"`);
    assert.ok(!/\berror\b/i.test(s), `${path} says error`);
  }
  assert.ok(count > 100);
  for (const state of STATES) {
    for (const listening of ['speakers', 'headphones']) {
      for (const s of Object.values(statusLine(state, { ...CTX, listening, remainingMs: 61000, mark: 'one', returning: true }))) {
        if (typeof s === 'string') assert.ok(!s.includes('!') && !/\berror\b/i.test(s), `${state}: ${s}`);
      }
    }
  }
});

test('statusLine returns a complete shape for every state and listening choice', () => {
  for (const state of STATES) {
    for (const listening of ['speakers', 'headphones']) {
      const line = statusLine(state, { ...CTX, listening });
      assert.equal(typeof line.label, 'string', state);
      assert.ok(line.label.length > 0, state);
      assert.equal(typeof line.status, 'string', state);
      assert.equal(typeof line.sub, 'string', state);
      assert.ok(line.announce === null || typeof line.announce === 'string', state);
    }
  }
});

test('statusLine follows the §7.4 table', () => {
  assert.deepEqual(statusLine('idle', CTX), { label: 'Begin', status: 'Calm · 10 Hz', sub: 'Ready when you are.', announce: null, timeLeft: null });
  assert.equal(statusLine('idle', { ...CTX, returning: true }).sub, 'Welcome back.');
  const starting = statusLine('starting', CTX);
  assert.equal(starting.label, 'Pause');
  assert.equal(starting.sub, 'Settling in…');
  assert.equal(starting.announce, 'Playing Calm, 10 hertz, alpha.');
  assert.equal(statusLine('starting', { ...CTX, presetName: 'Rest', beatHz: 3.5, band: 'delta' }).announce, 'Playing Rest, 3.5 hertz, delta.');

  const headphones = statusLine('playing', { ...CTX, listening: 'headphones' });
  assert.equal(headphones.label, 'Pause');
  assert.equal(headphones.sub, 'Breathe with the glow.');
  assert.equal(headphones.announce, null);
  assert.equal(headphones.timeLeft, null);
  const speakers = statusLine('playing', { ...CTX, listening: 'speakers', remainingMs: 1180000 });
  assert.equal(speakers.sub, 'Playing out loud. 19:40 left');
  assert.ok(speakers.sub.endsWith(`${formatTimeLeft(1180000)} left`));
  assert.equal(speakers.timeLeft, '19:40 left');
  assert.equal(statusLine('playing', { ...CTX, mark: 'five' }).announce, 'Five minutes left.');
  assert.equal(statusLine('playing', { ...CTX, mark: 'one' }).announce, 'One minute left, winding down.');

  assert.deepEqual(statusLine('pausing', CTX), { label: 'Begin', status: 'Calm · 10 Hz', sub: 'Letting go…', announce: 'Paused.', timeLeft: null });
  assert.deepEqual(statusLine('paused', CTX), { label: 'Resume', status: 'Calm · 10 Hz', sub: 'Paused. Take your time.', announce: 'Paused.', timeLeft: null });
  assert.deepEqual(statusLine('ending', CTX), { label: 'Pause', status: 'Calm · 10 Hz', sub: 'Winding down…', announce: null, timeLeft: null });
  assert.deepEqual(statusLine('ended', CTX), { label: 'Begin', status: 'Session complete', sub: 'Rest well.', announce: 'Session complete.', timeLeft: null });
  const ambient = statusLine('ambient', CTX);
  assert.equal(ambient.label, 'Pause');
  assert.equal(ambient.status, 'Rain and sea');
  assert.equal(ambient.sub, 'Tone finished — rain and sea continue.');
  assert.equal(ambient.announce, ambient.sub);
  const blocked = statusLine('blocked', CTX);
  assert.equal(blocked.label, 'Tap to begin');
  assert.equal(blocked.status, 'Calm · 10 Hz');
  assert.equal(blocked.sub, 'Your browser waits for a tap before playing sound.');
  assert.equal(blocked.announce, 'Sound is ready. Press Begin to start.');
  const interrupted = statusLine('interrupted', CTX);
  assert.equal(interrupted.label, 'Tap to continue');
  assert.equal(interrupted.sub, 'Sound paused while you were away.');
  assert.equal(interrupted.announce, 'Sound paused while you were away. Press Resume to continue.');
  const unavailable = statusLine('unavailable', CTX);
  assert.equal(unavailable.label, 'Sound unavailable');
  assert.equal(unavailable.status, 'Calm');
  assert.equal(unavailable.sub, "Sound isn't available in this browser. The scene and the cats still work.");
  assert.equal(unavailable.announce, unavailable.sub);
  assert.equal(statusLine('nonsense', CTX).label, 'Begin');
  assert.equal(statusLine('idle', { presetName: 'Calm' }).status, 'Calm');
});

test('formatHz trims trailing zeros and keeps at most one decimal', () => {
  assert.equal(formatHz(7.5), '7.5 Hz');
  assert.equal(formatHz(10), '10 Hz');
  assert.equal(formatHz(0.5), '0.5 Hz');
  assert.equal(formatHz(256), '256 Hz');
  assert.equal(formatHz(523.25), '523.3 Hz');
  assert.equal(formatHz(39.96), '40 Hz');
  assert.equal(formatHz(NaN), '—');
});

test('formatPitch names the nearest equal-tempered note', () => {
  assert.equal(formatPitch(440), '440 Hz · A4');
  assert.equal(formatPitch(256), '256 Hz · near C4');
  assert.equal(formatPitch(523.25), '523.3 Hz · C5');
  assert.equal(formatPitch(261.63), '261.6 Hz · C4');
  assert.equal(formatPitch(220), '220 Hz · A3');
  assert.equal(formatPitch(466.16), '466.2 Hz · A#4');
  assert.equal(formatPitch(441), '441 Hz · A4');
  assert.equal(formatPitch(450), '450 Hz · near A4');
  assert.equal(formatPitch(120), '120 Hz · near B2');
  assert.equal(formatPitch(0), '—');
});

test('formatPercent, formatTimeLeft and formatMinutes', () => {
  assert.equal(formatPercent(0.7), '70%');
  assert.equal(formatPercent(0), '0%');
  assert.equal(formatPercent(1), '100%');
  assert.equal(formatPercent(0.555), '56%');
  assert.equal(formatPercent(2), '100%');
  assert.equal(formatTimeLeft(1180000), '19:40');
  assert.equal(formatTimeLeft(0), '0:00');
  assert.equal(formatTimeLeft(-5000), '0:00');
  assert.equal(formatTimeLeft(59000), '0:59');
  assert.equal(formatTimeLeft(60000), '1:00');
  assert.equal(formatTimeLeft(3600000), '1:00:00');
  assert.equal(formatTimeLeft(5400000 + 7000), '1:30:07');
  assert.equal(formatTimeLeft(1500), '0:02');
  assert.equal(formatMinutes(20), '20 min');
  assert.equal(formatMinutes(0), '∞');
  assert.equal(formatMinutes(90), '90 min');
  assert.equal(formatMinutes(120), '2 h');
  assert.equal(formatMinutes(720), '12 h');
  assert.equal(formatMinutes(150), '2 h 30 min');
  assert.equal(formatMinutes(Infinity), '∞');
});

test('fill replaces placeholders and blanks missing ones', () => {
  assert.equal(fill(STRINGS.cats.label, { coat: STRINGS.cats.coats.calico, pose: STRINGS.cats.poses.sit }), 'A calico cat sitting nearby');
  assert.equal(fill(STRINGS.cats.petting, { coat: 'grey' }), 'A grey cat, purring');
  assert.equal(fill(STRINGS.cats.milestone, { n: 10 }), "You've spotted 10 cats. They like you.");
  assert.equal(fill(STRINGS.toasts.timerSet, { minutes: formatMinutes(30) }), 'Timer set to 30 min.');
  assert.equal(fill(STRINGS.titles.playing, { preset: 'Calm', beat: formatHz(10) }), 'Playing Calm 10 Hz — Brain Tune');
  assert.equal(fill('{a} and {b}', { a: 'x' }), 'x and ');
});

test('limitationsCopy gives platform lines plus the shared line', () => {
  for (const platform of ['apple', 'android', 'desktop']) {
    const lines = limitationsCopy(platform);
    assert.ok(lines.length >= 2, platform);
    assert.ok(lines.every((l) => typeof l === 'string' && l.length > 0));
    assert.equal(lines.at(-1), 'Binaural needs headphones; on speakers Brain Tune uses a pulsing tone.');
  }
  assert.ok(limitationsCopy('apple')[0].includes('iOS'));
  assert.ok(limitationsCopy('android').some((l) => l.includes('Keep screen awake')));
  assert.ok(limitationsCopy('desktop')[0].includes('background tab'));
  assert.deepEqual(limitationsCopy('shared'), [STRINGS.limitations.shared]);
  assert.deepEqual(limitationsCopy('tv'), [STRINGS.limitations.shared]);
});

test('formatRainfall and formatSea pick words by intensity band', async () => {
  const { formatRainfall, formatSea, describeLevel } = await import('../docs/js/core/microcopy.js');
  assert.equal(formatRainfall(0), 'drizzle');
  assert.equal(formatRainfall(0.45), 'steady');
  assert.equal(formatRainfall(0.7), 'heavy');
  assert.equal(formatRainfall(1), 'downpour');
  assert.equal(formatSea(0.35), 'gentle');
  assert.equal(formatSea(0.9), 'heavy swell');
  assert.equal(describeLevel(Number.NaN, ['a', 'b', 'c', 'd']), 'a');
});
