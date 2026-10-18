import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTERS, PAD_SLOTS, PAD_VOICINGS, PAD_ENTRIES, VOICING_CROSSFADE_SECONDS, PAD_LP_HZ,
  registerOf, padLowpassHz, voicingFor, canonVoicingFor, padGainSum,
} from '../docs/js/core/voicing.js';
import { TIMBRES, TIMBRE_ORDER } from '../docs/js/core/timbres.js';
import { VOICE_PEAK, PAD_DB, carrierTrim, dbToGain } from '../docs/js/core/levels.js';
import { PRESETS, resolvePreset } from '../docs/js/core/presets.js';
import { pairRoughness, spectrumRoughness, harmonicSpectrum, lowpassMagnitude, beatGuardViolations } from './helpers/consonance.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

const SLOT_NAMES = ['sub', 'fifth', 'octave', 'twelfth', 'double'];
/** One carrier inside each register, lowest first. */
const SAMPLE_HZ = { low: 110, lowMid: 198, mid: 264, high: 440 };
const sum = (gains) => Object.values(gains).reduce((a, b) => a + b, 0);

test('tables: four registers, five slots in creation order, a voicing and an entry per slot, all frozen', () => {
  assert.deepEqual(REGISTERS.map((r) => [r.id, r.maxHz]), [['low', 150], ['lowMid', 240], ['mid', 360], ['high', Infinity]]);
  assert.deepEqual(PAD_SLOTS.map((s) => [s.name, s.ratio, s.timbred]), [
    ['sub', 0.5, false], ['fifth', 1.5, true], ['octave', 2, true], ['twelfth', 3, false], ['double', 4, false],
  ]);
  assert.deepEqual(Object.keys(PAD_VOICINGS), REGISTERS.map((r) => r.id));
  for (const gains of Object.values(PAD_VOICINGS)) assert.deepEqual(Object.keys(gains), SLOT_NAMES);
  assert.deepEqual(Object.keys(PAD_ENTRIES), ['octave', 'fifth', 'twelfth', 'sub', 'double']);
  assert.deepEqual([...Object.keys(PAD_ENTRIES)].sort(), [...SLOT_NAMES].sort());
  assert.equal(VOICING_CROSSFADE_SECONDS, 6);
  assert.deepEqual([...PAD_LP_HZ], [1000, 1800]);
  for (const table of [REGISTERS, REGISTERS[0], PAD_SLOTS, PAD_SLOTS[0], PAD_VOICINGS, PAD_VOICINGS.low, PAD_ENTRIES, PAD_ENTRIES.octave, PAD_LP_HZ]) {
    assert.ok(Object.isFrozen(table));
  }
});

test('registerOf: each boundary belongs to the register above it', () => {
  const cases = [[55, 'low'], [149, 'low'], [150, 'lowMid'], [239, 'lowMid'], [240, 'mid'], [359, 'mid'], [360, 'high'], [1200, 'high'], [Infinity, 'high']];
  for (const [hz, id] of cases) assert.equal(registerOf(hz), id, `${hz} Hz`);
});

test('voicings: sums 1.45 / 1.40 / 1.60 / 1.35, every gain in [0, 0.6], no fifth below 240 Hz', () => {
  const expected = { low: 1.45, lowMid: 1.4, mid: 1.6, high: 1.35 };
  for (const [id, gains] of Object.entries(PAD_VOICINGS)) {
    near(sum(gains), expected[id], 1e-12, `${id} sum`);
    for (const [name, gain] of Object.entries(gains)) assert.ok(gain >= 0 && gain <= 0.6, `${id}.${name} = ${gain}`);
  }
  for (let hz = 100; hz < 240; hz += 1) assert.equal(voicingFor(hz).gains.fifth, 0, `fifth sounds at ${hz} Hz`);
  assert.ok(voicingFor(240).gains.fifth > 0, 'the fifth returns at 240 Hz');
});

test('every slot is a harmonic of the sub: ratio x 2 is an integer of the form 2^a * 3^b', () => {
  for (const { name, ratio } of PAD_SLOTS) {
    let k = ratio * 2;
    assert.ok(Number.isInteger(k), `${name} ratio ${ratio}`);
    while (k % 2 === 0) k /= 2;
    while (k % 3 === 0) k /= 3;
    assert.equal(k, 1, `${name} ratio ${ratio} has a prime factor other than 2 and 3`);
  }
});

test('padLowpassHz = clamp(6 hz, 1000, 1800), monotone', () => {
  assert.equal(padLowpassHz(110), 1000);
  assert.equal(padLowpassHz(198), 1188);
  assert.equal(padLowpassHz(264), 1584);
  assert.equal(padLowpassHz(300), 1800);
  assert.equal(padLowpassHz(440), 1800);
  let prev = -Infinity;
  for (let hz = 50; hz <= 1200; hz += 5) {
    const lp = padLowpassHz(hz);
    assert.ok(lp >= prev && lp >= PAD_LP_HZ[0] && lp <= PAD_LP_HZ[1], `${lp} at ${hz} Hz`);
    prev = lp;
  }
});

test('PAD_ENTRIES: swells of at least 1.5 s, entry times non-decreasing, the octave first', () => {
  const entries = Object.values(PAD_ENTRIES);
  for (const { seconds } of entries) assert.ok(seconds >= 1.5, `swell ${seconds} s`);
  for (let i = 1; i < entries.length; i++) assert.ok(entries[i].at >= entries[i - 1].at, `entry ${i} comes earlier`);
  assert.equal(PAD_ENTRIES.octave.at, 0);
});

test('voicingFor: register, low-pass and a fresh copy of the register gains', () => {
  for (const [id, hz] of Object.entries(SAMPLE_HZ)) {
    const v = voicingFor(hz);
    assert.deepEqual(v, { register: id, lpHz: padLowpassHz(hz), gains: { ...PAD_VOICINGS[id] } });
    assert.notEqual(v.gains, PAD_VOICINGS[id]);
    near(padGainSum(hz), sum(PAD_VOICINGS[id]), 1e-12, `${id} padGainSum`);
  }
  const v = voicingFor(198);
  v.gains.sub = 1;
  assert.equal(PAD_VOICINGS.lowMid.sub, 0.45, 'mutating a result leaves the table alone');
});

test('canonVoicingFor keeps sub and octave, silences the upper slots and shares their gain between two voices: same padGainSum', () => {
  for (const [id, hz] of Object.entries(SAMPLE_HZ)) {
    const drone = voicingFor(hz);
    const canon = canonVoicingFor(hz);
    assert.equal(canon.register, id);
    assert.equal(canon.lpHz, drone.lpHz);
    assert.deepEqual(canon.gains, { ...drone.gains, fifth: 0, twelfth: 0, double: 0 });
    near(canon.voiceGain, (drone.gains.fifth + drone.gains.twelfth + drone.gains.double) / 2, 1e-12, `${id} voiceGain`);
    assert.ok(canon.voiceGain > 0, `${id} canon voices are audible`);
    near(sum(canon.gains) + 2 * canon.voiceGain, padGainSum(hz), 1e-12, `${id} level budget`);
  }
});

// --- AUDIO additions: roughness against the 0.3 pad and the beat guard (spec §3.2, §3.10) -----------------------

/** The pad as 0.3 voiced it at every carrier: fifth 0.5 and octave 0.6 in the timbre, sub 0.35, behind an 1800 Hz low-pass. */
const V03 = Object.freeze({
  slots: [{ name: 'fifth', ratio: 1.5, gain: 0.5, timbred: true }, { name: 'octave', ratio: 2, gain: 0.6, timbred: true }, { name: 'sub', ratio: 0.5, gain: 0.35, timbred: false }],
  lpHz: 1800,
});
const PAD_LP_Q = 0.7;
const v04 = (f) => {
  const { gains, lpHz } = voicingFor(f);
  return { slots: PAD_SLOTS.map((slot) => ({ ...slot, gain: gains[slot.name] })), lpHz };
};

/** What one ear hears: a sine beat voice at f (VOICE_PEAK · carrierTrim) and the centred pad at PAD_DB through its low-pass. */
function perEar(f, { slots, lpHz }, timbre = 'velvet') {
  const pad = slots.filter((slot) => slot.gain > 0).flatMap(({ ratio, gain, timbred }) =>
    (timbred ? harmonicSpectrum(f * ratio, TIMBRES[timbre], gain) : [[f * ratio, gain]])
      .map(([hz, a]) => [hz, a * dbToGain(PAD_DB) * lowpassMagnitude(hz, lpHz, PAD_LP_Q)]));
  return [[f, VOICE_PEAK * carrierTrim(f)], ...pad];
}

test('consonance helpers: Sethares pair roughness, PeriodicWave-normalised spectra, a second-order low-pass', () => {
  assert.equal(pairRoughness(200, 1, 200, 1), 0, 'unison is smooth');
  const curve = Array.from({ length: 120 }, (_, i) => pairRoughness(200, 1, 200 + i, 1));
  const peakAt = curve.indexOf(Math.max(...curve));
  assert.ok(peakAt >= 15 && peakAt <= 35, `roughest about a quarter critical band above 200 Hz (${peakAt} Hz)`);
  near(pairRoughness(300, 0.5, 260, 0.2), pairRoughness(260, 0.2, 300, 0.5), 1e-15, 'symmetric');
  near(pairRoughness(200, 0.5, 225, 0.2, { weighting: 'min' }) / pairRoughness(200, 0.5, 225, 0.2), 0.2 / 0.1, 1e-12, 'min(a1, a2) against a1·a2');
  assert.deepEqual(harmonicSpectrum(100, TIMBRES.sine, 0.5), [[100, 0.5]]);
  const velvet = harmonicSpectrum(100, TIMBRES.velvet);
  assert.ok(velvet[0][1] < 1 && velvet[0][1] > 0.7, 'normalised to a waveform peak of 1, as Web Audio does');
  assert.equal(lowpassMagnitude(0, 1000, 0.7), 1);
  near(lowpassMagnitude(1000, 1000, 0.7), 0.7, 1e-12, 'Q at the cutoff');
  assert.ok(lowpassMagnitude(4000, 1000, 0.7) < 0.07, 'two octaves above: about −24 dB');
});

test('AUDIO: per-ear roughness of the register voicing is at most 0.6× of 0.3 below 240 Hz and never above it higher up (both weightings)', () => {
  // Sethares roughness of the 0.4 voicing per ear [a1·a2, min(a1, a2)], documented here and held within ±10 %;
  // against 0.3: about 0.40–0.49× (product) and 0.21–0.37× (min) below 240 Hz, 0.84–0.99× from 264 Hz up.
  const documented = {
    110: [7.01e-3, 1.028e-2], 150: [3.62e-3, 4.71e-3], 176: [2.25e-3, 2.89e-3], 198: [1.49e-3, 1.94e-3], 220: [9.78e-4, 1.32e-3],
    264: [1.118e-3, 3.15e-3], 330: [4.41e-4, 1.645e-3], 440: [1.326e-4, 8.01e-4], 528: [5.53e-5, 4.49e-4], 660: [1.83e-5, 2.2e-4],
  };
  for (const [hz, values] of Object.entries(documented)) {
    const f = Number(hz);
    const limit = f < 240 ? 0.6 : 1;
    ['product', 'min'].forEach((weighting, i) => {
      const now = spectrumRoughness(perEar(f, v04(f)), { weighting });
      const before = spectrumRoughness(perEar(f, V03), { weighting });
      assert.ok(now <= limit * before, `${f} Hz (${weighting}): ${now} is ${(now / before).toFixed(3)}× of 0.3, limit ${limit}`);
      near(now, values[i], 0.1 * values[i], `${f} Hz (${weighting}) absolute roughness`);
    });
  }
});

test('AUDIO: the beat guard passes for every preset carrier, listening, device and timbre, in drone and canon voicing, and trips a 5/4 slot', () => {
  for (const p of PRESETS) {
    for (const listening of ['headphones', 'speakers']) {
      for (const device of ['desktop', 'phone']) {
        const f = resolvePreset(p, { listening, device }).carrierHz;
        for (const voicing of [voicingFor(f), canonVoicingFor(f)]) {
          const sounding = PAD_SLOTS.filter((slot) => voicing.gains[slot.name] > 0);
          for (const timbre of TIMBRE_ORDER) {
            assert.deepEqual(beatGuardViolations(f, sounding, TIMBRES[timbre]), [], `${p.id} on ${listening} (${device}) at ${f} Hz in ${timbre}`);
          }
        }
      }
    }
  }
  assert.deepEqual(beatGuardViolations(110, [{ name: 'third', ratio: 1.25, timbred: false }], TIMBRES.sine), [{ name: 'third', hz: 137.5 }], 'a 5/4 slot 7.5 Hz from the beat voices is caught');
  assert.deepEqual(beatGuardViolations(440, [{ name: 'third', ratio: 1.25, timbred: false }], TIMBRES.sine), [], 'far from every voice and carrier partial it passes');
});
