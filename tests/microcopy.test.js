import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  STRINGS,
  JUST_STOPS,
  statusLine,
  fill,
  formatHz,
  formatPitch,
  formatPercent,
  formatTimeLeft,
  formatMinutes,
  limitationsCopy,
} from '../docs/js/core/microcopy.js';
import { UI_CARRIER } from '../docs/js/core/entrainment.js';
import { TIMBRE_ORDER } from '../docs/js/core/timbres.js';

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

test('statusLine during a beat glide: "Sleep · easing 6 → 2 Hz" while active, and the start announcement names where the glide begins', () => {
  const sleep = { presetName: 'Sleep', beatHz: 2, band: 'delta' };
  const glide = { fromHz: 6, toHz: 2, active: true };
  assert.equal(statusLine('playing', { ...sleep, glide }).status, 'Sleep · easing 6 → 2 Hz');
  assert.equal(statusLine('starting', { ...sleep, glide }).status, 'Sleep · easing 6 → 2 Hz');
  assert.equal(statusLine('starting', { ...sleep, glide }).announce, 'Playing Sleep, 6 hertz, delta.');
  assert.equal(statusLine('ending', { ...sleep, glide }).status, 'Sleep · easing 6 → 2 Hz');
  const done = { ...glide, active: false };
  assert.equal(statusLine('playing', { ...sleep, glide: done }).status, 'Sleep · 2 Hz');
  assert.equal(statusLine('starting', { ...sleep, glide: done }).announce, 'Playing Sleep, 2 hertz, delta.');
  assert.equal(statusLine('playing', { presetName: 'Deep sleep', beatHz: 1, glide: { fromHz: 3, toHz: 1, active: true } }).status, 'Deep sleep · easing 3 → 1 Hz');
  assert.equal(statusLine('playing', { presetName: 'Odd', beatHz: 4, glide: { fromHz: 7.25, toHz: 3.5, active: true } }).status, 'Odd · easing 7.3 → 3.5 Hz');
  assert.equal(statusLine('playing', { ...sleep, glide: { fromHz: Number.NaN, toHz: 2, active: true } }).status, 'Sleep · 2 Hz', 'an incomplete glide is ignored');
  assert.equal(statusLine('ambient', { ...sleep, glide }).status, 'Rain and sea', 'states with their own status keep it');
  assert.equal(statusLine('ended', { ...sleep, glide }).status, 'Session complete');
  for (const state of STATES) {
    for (const s of Object.values(statusLine(state, { ...sleep, glide }))) {
      if (typeof s === 'string') assert.ok(!s.includes('!') && !/\berror\b/i.test(s), `${state}: ${s}`);
    }
  }
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

test('JUST_STOPS: 17 frozen [hz, name] pairs from C3 to G5 over A = 110 Hz, covering the pitch slider', () => {
  assert.equal(JUST_STOPS.length, 17);
  assert.ok(Object.isFrozen(JUST_STOPS) && JUST_STOPS.every(Object.isFrozen));
  assert.deepEqual(JUST_STOPS.map(([, name]) => name), [
    'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'C5', 'D5', 'E5', 'F5', 'G5',
  ]);
  const ratios = { C: 6 / 5, D: 4 / 3, E: 3 / 2, F: 8 / 5, G: 9 / 5, A: 2 };
  for (const [hz, name] of JUST_STOPS) {
    const octave = Number(name.slice(1)) - 3;
    assert.ok(Math.abs(hz - 110 * 2 ** octave * ratios[name[0]]) < 1e-9, `${name} = ${hz}`);
  }
  for (let i = 1; i < JUST_STOPS.length; i++) assert.ok(JUST_STOPS[i][0] > JUST_STOPS[i - 1][0], 'ascending');
  for (const [hz, name] of JUST_STOPS) assert.ok(hz >= UI_CARRIER[0] && hz <= UI_CARRIER[1], `${name} is out of the pitch slider's reach`);
});

test('formatPitch names a just stop within 3 cents, otherwise the nearest equal-tempered note', () => {
  assert.equal(formatPitch(264), '264 Hz · C4');
  assert.equal(formatPitch(440), '440 Hz · A4');
  assert.equal(formatPitch(256), '256 Hz · near C4');
  assert.equal(formatPitch(287), '287 Hz · near D4');
  assert.equal(formatPitch(198), '198 Hz · G3');
  assert.equal(formatPitch(396), '396 Hz · G4', 'a just G4 sits 17.6 cents above the tempered one and is still named');
  assert.equal(formatPitch(880 / 3), '293.3 Hz · D4');
  assert.equal(formatPitch(110), '110 Hz · A2');
  assert.equal(formatPitch(523.25), '523.3 Hz · C5');
  assert.equal(formatPitch(261.63), '261.6 Hz · C4');
  assert.equal(formatPitch(220), '220 Hz · A3');
  assert.equal(formatPitch(466.16), '466.2 Hz · A#4');
  assert.equal(formatPitch(441), '441 Hz · A4');
  assert.equal(formatPitch(450), '450 Hz · near A4');
  assert.equal(formatPitch(120), '120 Hz · near B2');
  assert.equal(formatPitch(0), '—');
});

test('the 0.4 copy is present word for word (spec §5.2 and §0)', () => {
  assert.equal(STRINGS.player.autoplayOverlay, 'Tap anywhere to begin {preset}');
  assert.equal(fill(STRINGS.player.autoplayContinue, { preset: 'Sleep', time: '12:00' }), 'Tap anywhere to continue Sleep · 12:00 left');
  assert.equal(STRINGS.player.restartSound, 'Restart sound');
  assert.equal(STRINGS.settings.autoplay.description, 'Begins your last preset as soon as Brain Tune opens. Some browsers wait for a tap first.');
  assert.equal(STRINGS.settings.nightDim.description, 'In Sleep, Deep sleep and Rest the screen dims after a minute of stillness and settles further after five.');
  assert.deepEqual({ ...STRINGS.settings.more }, { label: 'More settings' });
  assert.equal(STRINGS.settings.addToHome.generic, "Use your browser's Add to Home Screen or Install option");
  assert.equal(STRINGS.settings.addToHome.apple, 'In Safari: Share, then Add to Home Screen.');
  assert.equal(STRINGS.mixer.purrNote, 'A low purr near 26 Hz, there for comfort. It plays no part in the beat.');
  assert.equal(STRINGS.about.purr, undefined, 'About uses mixer.purrNote');
  assert.equal(STRINGS.firstRun.helpQuestion, 'What would help right now?');
  assert.deepEqual({ ...STRINGS.firstRun.help }, { sleep: 'Drift off', calm: 'Settle', focus: 'Focus' });
  assert.equal(STRINGS.firstRun.quietNote, "Sound begins quietly when you tap Let's begin and fades in over a few seconds.");
  assert.deepEqual({ ...STRINGS.fineTuning.timbres }, { sine: 'Sine', velvet: 'Velvet', warm: 'Warm', amber: 'Amber', glass: 'Glass', bell: 'Bell' });
  assert.deepEqual(Object.keys(STRINGS.fineTuning.timbres), [...TIMBRE_ORDER], 'one name per timbre, in display order');
  assert.equal(
    STRINGS.fineTuning.explainer.timbre,
    'Timbre is the colour of the tone. Sine is plain, Velvet and Warm are rounder, Amber is octave-rich, Glass and Bell are sparse and clear.',
  );
  assert.equal(
    STRINGS.fineTuning.explainer.pad,
    'Pad adds a quiet octave and fifth above the tone and a sub below it, all in pure ratios. At low pitches the fifth sits an octave higher, and the voices enter one at a time over the first minute.',
  );
  assert.deepEqual({ ...STRINGS.fineTuning.padStyle }, { label: 'Pad style', auto: 'Auto', drone: 'Drone', canon: 'Canon' });
  assert.equal(
    STRINGS.fineTuning.explainer.padStyle,
    'Drone holds the harmony and lets it breathe. Canon adds two slow voices, one answering the other a few notes later, as in a round. Auto uses Canon in Meditate and Calm.',
  );
  assert.equal(fill(STRINGS.status.glide, { preset: 'Sleep', from: 6, to: formatHz(2) }), 'Sleep · easing 6 → 2 Hz');
  assert.equal(fill(STRINGS.cats.label, { coat: STRINGS.cats.coats.tuxedo, pose: STRINGS.cats.poses.peek }), 'A tuxedo cat peeking in');
  assert.equal(
    STRINGS.about.tuning,
    'Pitch, pad and chime are tuned in simple whole-number ratios, which sound smooth because their overtones line up. No particular key or frequency is special on its own.',
  );
  assert.equal(
    STRINGS.about.canon,
    "In Canon the pad's two slow voices follow simple rules of counterpoint: the second voice imitates the first, sometimes upside down, slower or sooner, and every pair of notes heard together forms a consonant interval.",
  );
  assert.equal(STRINGS.status.playing.speakers, 'Playing out loud.', 'kept as it was');
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
