import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS, TIMER_OPTIONS, DEFAULT_PRESET_ID, getPreset, validatePreset, resolvePreset } from '../docs/js/core/presets.js';
import { gateParams } from '../docs/js/core/gate.js';
import { CARRIER_RANGE } from '../docs/js/core/entrainment.js';

const IDS = ['sleep', 'rest', 'meditate', 'catnap', 'calm', 'focus', 'energise', 'clarity'];
const DEVICES = ['phone', 'desktop'];
const RESOLVED_KEYS = [
  'beatHz', 'carrierHz', 'catMood', 'chime', 'endFadeSeconds', 'gate', 'glide', 'id', 'mix', 'mode',
  'oceanIntensity', 'pad', 'rainIntensity', 'timbre', 'timerMinutes',
];

const rejects = (preset, fragment) => {
  const { ok, errors } = validatePreset(preset);
  assert.equal(ok, false, `expected rejection for ${fragment}`);
  assert.ok(errors.some((e) => e.includes(fragment)), `no error mentions ${fragment}: ${errors.join(' | ')}`);
};

test('eight presets in display order, every one valid, unique ids, names of at most 14 characters', () => {
  assert.deepEqual(PRESETS.map((p) => p.id), IDS);
  assert.deepEqual(PRESETS.map((p) => p.name), ['Sleep', 'Rest', 'Meditate', 'Cat nap', 'Calm', 'Focus', 'Energise', 'Clarity']);
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

test('table values match §6.5', () => {
  const [sleep, rest, meditate, catnap, calm, focus, energise, clarity] = PRESETS;
  assert.deepEqual(sleep, {
    id: 'sleep', name: 'Sleep', band: 'delta', beatHz: 2, glide: { fromHz: 6, minutes: 12 },
    carrierHz: { headphones: 200, speakers: 420 }, timbre: 'velvet', pad: true,
    mix: { tone: 0.5, rain: 0.6, ocean: 0.55, purr: 0.55 }, rainIntensity: 0.35, oceanIntensity: 0.35,
    timerMinutes: 0, endFadeSeconds: 90, chime: 'none',
  });
  assert.deepEqual([rest.band, rest.beatHz, rest.carrierHz, rest.mix, rest.rainIntensity, rest.oceanIntensity, rest.timerMinutes, rest.endFadeSeconds, rest.chime],
    ['delta', 3.5, { headphones: 210, speakers: 420 }, { tone: 0.55, rain: 0.65, ocean: 0.6, purr: 0.5 }, 0.35, 0.3, 0, 60, 'none']);
  assert.deepEqual([meditate.band, meditate.beatHz, meditate.carrierHz, meditate.timbre, meditate.pad, meditate.mix, meditate.oceanIntensity, meditate.endFadeSeconds, meditate.chime],
    ['theta', 6, { headphones: 256, speakers: 420 }, 'glass', true, { tone: 0.55, rain: 0.6, ocean: 0.7, purr: 0.45 }, 0.4, 30, 'soft']);
  assert.deepEqual([catnap.band, catnap.beatHz, catnap.carrierHz, catnap.mix, catnap.rainIntensity, catnap.timerMinutes, catnap.endFadeSeconds, catnap.catMood],
    ['theta', 5.5, { headphones: 220, speakers: 420 }, { tone: 0.45, rain: 0.6, ocean: 0, purr: 0.7 }, 0.4, 0, 60, 'sleepy']);
  assert.deepEqual([calm.band, calm.beatHz, calm.carrierHz, calm.timbre, calm.pad, calm.mix, calm.rainIntensity, calm.oceanIntensity, calm.timerMinutes, calm.endFadeSeconds, calm.chime],
    ['alpha', 10, { headphones: 256, speakers: 420 }, 'velvet', true, { tone: 0.55, rain: 0.75, ocean: 0.5, purr: 0.45 }, 0.45, 0.35, 0, 30, 'none']);
  assert.deepEqual([focus.band, focus.beatHz, focus.carrierHz, focus.timbre, focus.pad, focus.mix, focus.rainIntensity, focus.timerMinutes, focus.chime],
    ['beta', 15, { headphones: 320, speakers: 520 }, 'glass', false, { tone: 0.55, rain: 0.75, ocean: 0, purr: 0.4 }, 0.5, 0, 'soft']);
  assert.deepEqual([energise.band, energise.beatHz, energise.carrierHz, energise.timbre, energise.pad, energise.mix, energise.rainIntensity, energise.oceanIntensity, energise.timerMinutes, energise.endFadeSeconds, energise.chime],
    ['beta', 20, { headphones: 400, speakers: 640 }, 'warm', false, { tone: 0.6, rain: 0.6, ocean: 0.65, purr: 0.4 }, 0.55, 0.6, 0, 20, 'soft']);
  assert.deepEqual([clarity.band, clarity.beatHz, clarity.carrierHz, clarity.timbre, clarity.pad, clarity.mix, clarity.rainIntensity, clarity.timerMinutes, clarity.endFadeSeconds, clarity.chime, clarity.forceMode],
    ['gamma', 40, { headphones: 400, speakers: 520 }, 'warm', false, { tone: 0.55, rain: 0.7, ocean: 0, purr: 0.4 }, 0.45, 0, 30, 'soft', 'isochronic']);
  assert.ok(PRESETS.filter((p) => p.pad).map((p) => p.id).join() === 'sleep,rest,meditate,catnap,calm');
  assert.ok(PRESETS.filter((p) => p.chime === 'soft').map((p) => p.id).join() === 'meditate,focus,energise,clarity');
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
  assert.equal(validatePreset(null).ok, false);
  assert.ok(validatePreset({}).errors.length >= 10, 'an empty object fails many rules');
  assert.equal(validatePreset({ ...calm, forceMode: 'monaural', glide: { fromHz: 12, minutes: 5 }, catMood: 'alert' }).ok, true);
  assert.equal(validatePreset({ ...calm, forceMode: null, glide: null, catMood: null }).ok, true, 'null optionals read as absent');
});

test('clarity resolves to isochronic on headphones, on speakers and under any override, carrier by listening (400 / 520 Hz)', () => {
  const clarity = getPreset('clarity');
  for (const listening of ['headphones', 'speakers']) {
    for (const device of DEVICES) {
      for (const override of ['auto', 'binaural', 'monaural', 'isochronic']) {
        const r = resolvePreset(clarity, { listening, device, override });
        assert.equal(r.mode, 'isochronic', `${listening} ${device} ${override}`);
        assert.equal(r.carrierHz, listening === 'headphones' ? 400 : 520, `${listening} carrier`);
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
  for (const p of PRESETS) if (p.id !== 'catnap') assert.equal(resolvePreset(p, { listening: 'speakers', device: 'phone' }).catMood, null, p.id);
});

test('Sleep glides from 6 Hz to 2 Hz over 12 minutes; no other preset glides', () => {
  const sleep = getPreset('sleep');
  assert.equal(sleep.beatHz, 2);
  assert.deepEqual(sleep.glide, { fromHz: 6, minutes: 12 });
  const r = resolvePreset(sleep, { listening: 'headphones', device: 'phone' });
  assert.deepEqual(r.glide, { fromHz: 6, minutes: 12 });
  assert.notEqual(r.glide, sleep.glide, 'resolved glide is a copy');
  for (const p of PRESETS) if (p.id !== 'sleep') assert.equal(resolvePreset(p, { listening: 'headphones', device: 'phone' }).glide, null, p.id);
});

test('speakers on a phone always get a carrier of at least 400 Hz; headphones get binaural at the headphones carrier', () => {
  for (const p of PRESETS) {
    for (const device of DEVICES) {
      const spk = resolvePreset(p, { listening: 'speakers', device });
      assert.equal(spk.mode, 'isochronic', `${p.id} speakers ${device}`);
      assert.ok(spk.carrierHz >= 400, `${p.id} speakers ${device} carrier ${spk.carrierHz}`);
      assert.equal(spk.carrierHz, p.carrierHz.speakers);
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
