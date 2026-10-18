import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRESETS, TIMER_OPTIONS, DEFAULT_PRESET_ID, getPreset, validatePreset, resolvePreset, canonFor, suggestPreset,
} from '../docs/js/core/presets.js';
import { gateParams } from '../docs/js/core/gate.js';
import { CARRIER_RANGE } from '../docs/js/core/entrainment.js';
import { JUST_STOPS, formatPitch } from '../docs/js/core/microcopy.js';

const IDS = ['sleep', 'deep', 'rest', 'meditate', 'catnap', 'calm', 'focus', 'energise', 'clarity'];
const DEVICES = ['phone', 'desktop'];
const PAD_STYLES = ['auto', 'drone', 'canon'];
const RESOLVED_KEYS = [
  'beatHz', 'canon', 'carrierHz', 'catMood', 'chime', 'endFadeSeconds', 'gate', 'gentle', 'glide', 'id', 'mix', 'mode', 'mood',
  'oceanIntensity', 'pad', 'rainIntensity', 'timbre', 'timerMinutes',
];
/** A2, the root of the just grid: Deep sleep's headphones carrier sits an octave below the A3 stop. */
const GRID_ROOT_HZ = 110;
const cents = (a, b) => 1200 * Math.log2(a / b);

const rejects = (preset, fragment) => {
  const { ok, errors } = validatePreset(preset);
  assert.equal(ok, false, `expected rejection for ${fragment}`);
  assert.ok(errors.some((e) => e.includes(fragment)), `no error mentions ${fragment}: ${errors.join(' | ')}`);
};

test('nine presets in display order, every one valid, unique ids, names of at most 14 characters', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), IDS);
  assert.deepEqual(PRESETS.map((p) => p.name), ['Sleep', 'Deep sleep', 'Rest', 'Meditate', 'Cat nap', 'Calm', 'Focus', 'Energise', 'Clarity']);
  for (const p of PRESETS) assert.deepEqual(validatePreset(p), { ok: true, errors: [] }, p.id);
  assert.equal(new Set(PRESETS.map((p) => p.id)).size, PRESETS.length);
  for (const p of PRESETS) assert.ok(p.name.length <= 14, p.name);
  assert.ok(Object.isFrozen(PRESETS) && PRESETS.every((p) => Object.isFrozen(p) && Object.isFrozen(p.mix) && Object.isFrozen(p.carrierHz)));
});

test('TIMER_OPTIONS, DEFAULT_PRESET_ID and getPreset', () => {
  assert.deepEqual([...TIMER_OPTIONS], [0, 720, 360, 120, 10, 15, 20, 30, 45, 60, 90], '∞ first, then 12 h, 6 h, 2 h, then the short ones');
  assert.equal(DEFAULT_PRESET_ID, 'sleep');
  assert.equal(getPreset(DEFAULT_PRESET_ID).name, 'Sleep');
  assert.equal(getPreset('nap'), undefined);
  for (const p of PRESETS) assert.ok(TIMER_OPTIONS.includes(p.timerMinutes), `${p.id} timer ${p.timerMinutes}`);
});

test('table values match the 0.4 spec §2.2', () => {
  const [sleep, deep, rest, meditate, catnap, calm, focus, energise, clarity] = PRESETS;
  assert.deepEqual(sleep, {
    id: 'sleep', name: 'Sleep', band: 'delta', beatHz: 2, glide: { fromHz: 6, minutes: 12 },
    carrierHz: { headphones: 198, speakers: 440 }, timbre: 'velvet', pad: true,
    mix: { tone: 0.35, rain: 0.7, ocean: 0.65, purr: 0.5 }, rainIntensity: 0.35, oceanIntensity: 0.25,
    timerMinutes: 0, endFadeSeconds: 90, chime: 'none', mood: 'sleepy', gentle: true,
  });
  assert.deepEqual([deep.band, deep.beatHz, deep.glide, deep.carrierHz, deep.timbre, deep.pad, deep.mix, deep.rainIntensity, deep.oceanIntensity, deep.timerMinutes, deep.catMood],
    ['delta', 1, { fromHz: 3, minutes: 20 }, { headphones: 110, speakers: 176 }, 'amber', true, { tone: 0.35, rain: 0.7, ocean: 0.65, purr: 0.5 }, 0.25, 0.25, 0, 'sleepy']);
  assert.deepEqual([rest.band, rest.beatHz, rest.carrierHz, rest.timbre, rest.mix, rest.rainIntensity, rest.oceanIntensity, rest.timerMinutes, rest.endFadeSeconds, rest.chime],
    ['delta', 3.5, { headphones: 220, speakers: 440 }, 'velvet', { tone: 0.55, rain: 0.65, ocean: 0.6, purr: 0.5 }, 0.35, 0.3, 0, 60, 'none']);
  assert.deepEqual([meditate.band, meditate.beatHz, meditate.carrierHz, meditate.timbre, meditate.pad, meditate.mix, meditate.oceanIntensity, meditate.endFadeSeconds, meditate.chime],
    ['theta', 6, { headphones: 264, speakers: 440 }, 'bell', true, { tone: 0.55, rain: 0.6, ocean: 0.7, purr: 0.45 }, 0.4, 30, 'soft']);
  assert.deepEqual([catnap.band, catnap.beatHz, catnap.carrierHz, catnap.timbre, catnap.mix, catnap.rainIntensity, catnap.timerMinutes, catnap.endFadeSeconds, catnap.catMood],
    ['theta', 5.5, { headphones: 220, speakers: 440 }, 'velvet', { tone: 0.45, rain: 0.6, ocean: 0, purr: 0.7 }, 0.4, 0, 60, 'sleepy']);
  assert.deepEqual([calm.band, calm.beatHz, calm.carrierHz, calm.timbre, calm.pad, calm.mix, calm.rainIntensity, calm.oceanIntensity, calm.timerMinutes, calm.endFadeSeconds, calm.chime],
    ['alpha', 10, { headphones: 264, speakers: 440 }, 'velvet', true, { tone: 0.55, rain: 0.75, ocean: 0.5, purr: 0.45 }, 0.45, 0.35, 0, 30, 'none']);
  assert.deepEqual([focus.band, focus.beatHz, focus.carrierHz, focus.timbre, focus.pad, focus.mix, focus.rainIntensity, focus.timerMinutes, focus.chime],
    ['beta', 15, { headphones: 330, speakers: 528 }, 'glass', false, { tone: 0.55, rain: 0.75, ocean: 0, purr: 0.4 }, 0.5, 0, 'soft']);
  assert.deepEqual([energise.band, energise.beatHz, energise.carrierHz, energise.timbre, energise.pad, energise.mix, energise.rainIntensity, energise.oceanIntensity, energise.timerMinutes, energise.endFadeSeconds, energise.chime],
    ['beta', 20, { headphones: 440, speakers: 660 }, 'amber', false, { tone: 0.6, rain: 0.6, ocean: 0.65, purr: 0.4 }, 0.55, 0.6, 0, 20, 'soft']);
  assert.deepEqual([clarity.band, clarity.beatHz, clarity.carrierHz, clarity.timbre, clarity.pad, clarity.mix, clarity.rainIntensity, clarity.timerMinutes, clarity.endFadeSeconds, clarity.chime, clarity.forceMode],
    ['gamma', 40, { headphones: 440, speakers: 528 }, 'warm', false, { tone: 0.55, rain: 0.7, ocean: 0, purr: 0.4 }, 0.45, 0, 30, 'soft', 'isochronic']);
  assert.ok(PRESETS.filter((p) => p.pad).map((p) => p.id).join() === 'sleep,deep,rest,meditate,catnap,calm');
  assert.ok(PRESETS.filter((p) => p.chime === 'soft').map((p) => p.id).join() === 'meditate,focus,energise,clarity');
});

test('every preset has a mood; the sleepy ones are gentle and no other preset is', () => {
  assert.deepEqual(PRESETS.map((p) => p.mood), ['sleepy', 'sleepy', 'sleepy', 'calm', 'sleepy', 'calm', 'alert', 'alert', 'alert']);
  assert.deepEqual(PRESETS.filter((p) => p.gentle === true).map((p) => p.id), ['sleep', 'deep', 'rest', 'catnap']);
  assert.ok(PRESETS.every((p) => p.gentle === undefined || p.gentle === true), 'gentle is written only where it is true');
  assert.equal(getPreset('catnap').catMood, 'sleepy', 'catMood stays as it was');
});

test('both carriers of every preset sit on the just grid over A = 110 Hz and read as a named note', () => {
  for (const p of PRESETS) {
    for (const hz of [p.carrierHz.headphones, p.carrierHz.speakers]) {
      const onStop = JUST_STOPS.some(([stopHz]) => Math.abs(cents(hz, stopHz)) < 0.01);
      assert.ok(onStop || hz === GRID_ROOT_HZ, `${p.id} carrier ${hz} Hz is off the just grid`);
      assert.ok(!formatPitch(hz).includes('near'), `${p.id}: ${formatPitch(hz)}`);
    }
  }
  assert.equal(formatPitch(GRID_ROOT_HZ), '110 Hz · A2');
});

test('validatePreset rejects an out-of-band beat, carriers outside their ranges, a bad mix, long names and other schema breaks', () => {
  const calm = getPreset('calm');
  rejects({ ...calm, beatHz: 20 }, 'beatHz');
  rejects({ ...calm, beatHz: 13 }, 'beatHz');
  rejects({ ...calm, beatHz: Number.NaN }, 'beatHz');
  rejects({ ...calm, carrierHz: { headphones: 50, speakers: 420 } }, 'carrierHz.headphones');
  rejects({ ...calm, carrierHz: { headphones: 1001, speakers: 420 } }, 'carrierHz.headphones');
  rejects({ ...calm, carrierHz: { headphones: 256, speakers: 1300 } }, 'carrierHz.speakers');
  rejects({ ...calm, carrierHz: { headphones: 256, speakers: 100 } }, 'carrierHz.speakers');
  rejects({ ...calm, mix: { ...calm.mix, rain: 1.2 } }, 'mix.rain');
  rejects({ ...calm, mix: { ...calm.mix, tone: -0.1 } }, 'mix.tone');
  rejects({ ...calm, mix: { tone: 0.5, rain: 0.5, ocean: 0.5 } }, 'mix.purr');
  rejects({ ...calm, name: 'A very long name' }, 'name');
  rejects({ ...calm, name: '' }, 'name');
  rejects({ ...calm, id: '' }, 'id');
  rejects({ ...calm, band: 'omega' }, 'band');
  rejects({ ...calm, timbre: 'brass' }, 'timbre');
  rejects({ ...calm, pad: 'yes' }, 'pad');
  rejects({ ...calm, rainIntensity: 2 }, 'rainIntensity');
  rejects({ ...calm, oceanIntensity: -1 }, 'oceanIntensity');
  rejects({ ...calm, timerMinutes: 25 }, 'timerMinutes');
  rejects({ ...calm, endFadeSeconds: 5 }, 'endFadeSeconds');
  rejects({ ...calm, chime: 'loud' }, 'chime');
  rejects({ ...calm, forceMode: 'stereo' }, 'forceMode');
  rejects({ ...calm, glide: { fromHz: 0, minutes: 12 } }, 'glide');
  rejects({ ...calm, catMood: 'grumpy' }, 'catMood');
  for (const mood of [undefined, 'grumpy']) {
    assert.deepEqual(validatePreset({ ...calm, mood }).errors, ['mood must be one of sleepy, calm, alert'], `mood ${mood}`);
  }
  assert.deepEqual(validatePreset({ ...calm, gentle: 'yes' }).errors, ['gentle must be a boolean']);
  assert.equal(validatePreset({ ...calm, gentle: true }).ok, true);
  assert.equal(validatePreset({ ...calm, gentle: null }).ok, true, 'gentle is optional');
  assert.equal(validatePreset(null).ok, false);
  assert.ok(validatePreset({}).errors.length >= 10, 'an empty object fails many rules');
  assert.equal(validatePreset({ ...calm, forceMode: 'monaural', glide: { fromHz: 12, minutes: 5 }, catMood: 'alert' }).ok, true);
  assert.equal(validatePreset({ ...calm, forceMode: null, glide: null, catMood: null }).ok, true, 'null optionals read as absent');
});

test('clarity resolves to isochronic on headphones, on speakers and under any override, carrier by listening (440 / 528 Hz)', () => {
  const clarity = getPreset('clarity');
  for (const listening of ['headphones', 'speakers']) {
    for (const device of DEVICES) {
      for (const override of ['auto', 'binaural', 'monaural', 'isochronic']) {
        const r = resolvePreset(clarity, { listening, device, override });
        assert.equal(r.mode, 'isochronic', `${listening} ${device} ${override}`);
        assert.equal(r.carrierHz, listening === 'headphones' ? 440 : 528, `${listening} carrier`);
        assert.equal(r.beatHz, 40);
      }
    }
  }
});

test('every preset purrs and plays until stopped; Cat nap purrs most and is the sleepy preset', () => {
  for (const p of PRESETS) {
    assert.ok(p.mix.purr >= 0.4, `${p.id} purr ${p.mix.purr}`);
    assert.equal(p.timerMinutes, 0, `${p.id} defaults to ∞`);
  }
  assert.equal(Math.max(...PRESETS.map((p) => p.mix.purr)), getPreset('catnap').mix.purr);
  assert.equal(getPreset('catnap').catMood, 'sleepy');
  assert.equal(resolvePreset(getPreset('catnap'), { listening: 'speakers', device: 'phone' }).catMood, 'sleepy');
  for (const p of PRESETS) if (!['catnap', 'deep'].includes(p.id)) assert.equal(resolvePreset(p, { listening: 'speakers', device: 'phone' }).catMood, null, p.id);
});

test('Sleep glides from 6 Hz to 2 Hz over 12 minutes, Deep sleep from 3 Hz to 1 Hz over 20; no other preset glides', () => {
  assert.deepEqual(getPreset('deep').glide, { fromHz: 3, minutes: 20 });
  const sleep = getPreset('sleep');
  assert.equal(sleep.beatHz, 2);
  assert.deepEqual(sleep.glide, { fromHz: 6, minutes: 12 });
  const r = resolvePreset(sleep, { listening: 'headphones', device: 'phone' });
  assert.deepEqual(r.glide, { fromHz: 6, minutes: 12 });
  assert.notEqual(r.glide, sleep.glide, 'resolved glide is a copy');
  for (const p of PRESETS) if (!['sleep', 'deep'].includes(p.id)) assert.equal(resolvePreset(p, { listening: 'headphones', device: 'phone' }).glide, null, p.id);
});

test('speakers on a phone always get a carrier of at least 400 Hz; headphones get binaural at the headphones carrier', () => {
  for (const p of PRESETS) {
    for (const device of DEVICES) {
      const spk = resolvePreset(p, { listening: 'speakers', device });
      assert.equal(spk.mode, 'isochronic', `${p.id} speakers ${device}`);
      // Phones lift every speaker carrier to 400 Hz; desktop speakers keep Deep sleep's low 176 Hz.
      assert.equal(spk.carrierHz, device === 'phone' ? Math.max(400, p.carrierHz.speakers) : p.carrierHz.speakers, `${p.id} speakers ${device}`);
      const hp = resolvePreset(p, { listening: 'headphones', device });
      if (p.id === 'clarity') continue;
      assert.equal(hp.mode, 'binaural', `${p.id} headphones ${device}`);
      assert.equal(hp.carrierHz, p.carrierHz.headphones);
      assert.ok(hp.carrierHz >= CARRIER_RANGE.binaural[0] && hp.carrierHz <= CARRIER_RANGE.binaural[1]);
    }
  }
  const low = { ...getPreset('calm'), carrierHz: { headphones: 256, speakers: 300 } };
  assert.equal(resolvePreset(low, { listening: 'speakers', device: 'phone' }).carrierHz, 400);
  assert.equal(resolvePreset(low, { listening: 'speakers', device: 'desktop' }).carrierHz, 300);
});

test('resolvePreset: shape, gate from the beat, copies that leave PRESETS untouched, overrides honoured', () => {
  const calm = getPreset('calm');
  const r = resolvePreset(calm, { listening: 'headphones', device: 'desktop' });
  assert.deepEqual(Object.keys(r).sort(), RESOLVED_KEYS);
  assert.equal(r.id, 'calm');
  assert.deepEqual(r.gate, gateParams(10));
  assert.deepEqual(r.mix, calm.mix);
  assert.notEqual(r.mix, calm.mix);
  r.mix.tone = 1;
  assert.equal(getPreset('calm').mix.tone, 0.55);
  assert.deepEqual(
    [r.timbre, r.pad, r.rainIntensity, r.oceanIntensity, r.timerMinutes, r.endFadeSeconds, r.chime],
    ['velvet', true, 0.45, 0.35, 0, 30, 'none'],
  );
  const mono = resolvePreset(calm, { listening: 'headphones', device: 'desktop', override: 'monaural' });
  assert.equal(mono.mode, 'monaural');
  assert.equal(mono.carrierHz, calm.carrierHz.headphones, 'the carrier follows the listening choice, not the mode');
  const forcedBinaural = resolvePreset(calm, { listening: 'speakers', device: 'phone', override: 'binaural' });
  assert.equal(forcedBinaural.mode, 'binaural');
  assert.equal(forcedBinaural.carrierHz, calm.carrierHz.speakers, 'speakers carrier (already above the 400 Hz phone floor)');
  assert.equal(resolvePreset(calm).mode, 'isochronic', 'no options reads as speakers');
  assert.deepEqual(resolvePreset(getPreset('energise'), { listening: 'headphones', device: 'phone' }).gate, gateParams(20));
});

test('resolvePreset passes mood and gentle through, and a gentle preset resolves to the gentle gate', () => {
  for (const p of PRESETS) {
    const r = resolvePreset(p, { listening: 'speakers', device: 'phone' });
    assert.equal(r.mood, p.mood, p.id);
    assert.equal(r.gentle, p.gentle === true, p.id);
    assert.deepEqual(r.gate, gateParams(p.beatHz, { gentle: p.gentle === true }), p.id);
  }
  const sleep = resolvePreset(getPreset('sleep'), { listening: 'speakers', device: 'phone' });
  assert.deepEqual(sleep.gate, { duty: 0.5, ramp: 0.3, depth: 0.6 });
  assert.deepEqual(resolvePreset(getPreset('calm'), { listening: 'speakers', device: 'phone' }).gate, gateParams(10));
});

test('canonFor: Canon everywhere but Clarity, Auto only in the calm-mood presets, Drone never', () => {
  const table = Object.fromEntries(PAD_STYLES.map((style) => [style, PRESETS.filter((p) => canonFor(style, p)).map((p) => p.id)]));
  assert.deepEqual(table, {
    auto: ['meditate', 'calm'],
    drone: [],
    canon: ['sleep', 'deep', 'rest', 'meditate', 'catnap', 'calm', 'focus', 'energise'],
  });
  assert.equal(canonFor('fugue', getPreset('calm')), false, 'an unknown style reads as drone');
});

test('resolvePreset adds canon: the pad style decides, Auto by default, never without a pad', () => {
  const resolved = (style) => PRESETS.filter((p) => resolvePreset(p, { listening: 'headphones', device: 'desktop', padStyle: style }).canon).map((p) => p.id);
  assert.deepEqual(resolved('auto'), ['meditate', 'calm']);
  assert.deepEqual(resolved('drone'), []);
  assert.deepEqual(resolved('canon'), ['sleep', 'deep', 'rest', 'meditate', 'catnap', 'calm'], 'Focus and Energise have no pad');
  assert.deepEqual(PRESETS.filter((p) => resolvePreset(p, { listening: 'speakers', device: 'phone' }).canon).map((p) => p.id), ['meditate', 'calm']);
  assert.equal(resolvePreset({ ...getPreset('calm'), pad: false }, { padStyle: 'canon' }).canon, false);
  for (const p of PRESETS) for (const padStyle of PAD_STYLES) assert.equal(typeof resolvePreset(p, { padStyle }).canon, 'boolean');
});

test('suggestPreset: Sleep from 20:00 to 05:59, Calm in the day; both are real presets', () => {
  const sleepy = [20, 21, 22, 23, 0, 1, 2, 3, 4, 5];
  for (let hour = 0; hour < 24; hour++) {
    const id = suggestPreset(hour);
    assert.equal(id, sleepy.includes(hour) ? 'sleep' : 'calm', `${hour}:00`);
    assert.ok(getPreset(id), id);
  }
  assert.equal(suggestPreset(21), 'sleep');
  assert.equal(suggestPreset(5), 'sleep');
  assert.equal(suggestPreset(6), 'calm');
  assert.equal(suggestPreset(14), 'calm');
});
