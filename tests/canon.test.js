import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SCALE, ALLOWED_INTERVALS, intervalOk, canonOctave, createCanonPlan } from '../docs/js/core/canon.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);
const SEEDS = Array.from({ length: 120 }, (_, i) => 1 + 7919 * i);
/** Preset carriers on headphones and speakers (Deep on phone speakers is lifted to 400 Hz) plus the register edges. */
const CARRIERS = [110, 176, 198, 220, 264, 300, 301, 400, 440, 528, 600, 660, 1200];
const EPISODES_PER_SEED = 8;

/** Scale position of a ratio: 5 per octave, 0 = the carrier; throws when the ratio is not a scale degree times a power of two. */
function positionOf(ratio) {
  const octave = Math.floor(Math.log2(ratio) + 1e-9);
  const degree = SCALE.findIndex((d) => Math.abs(d - ratio / 2 ** octave) < 1e-9);
  if (degree < 0) throw new Error(`ratio ${ratio} is not in the scale`);
  return 5 * octave + degree;
}
const voiceOf = (episode, voice) => episode.notes.filter((n) => n.voice === voice);
const soundingAt = (notes, t) => notes.find((n) => n.startT <= t && t < n.startT + n.durationS);

/** Every episode of every seed at one carrier, chained as the layer chains them: the first after entryS, then rest after rest. */
function* episodesAt(carrierHz, seeds = SEEDS) {
  for (const seed of seeds) {
    const plan = createCanonPlan({ seed });
    let startT = plan.entryS;
    for (let index = 0; index < EPISODES_PER_SEED; index++) {
      const episode = plan.episode(index, startT, carrierHz);
      yield { plan, episode };
      startT = episode.endT + plan.restS(index + 1);
    }
  }
}

test('SCALE and ALLOWED_INTERVALS are the D4 tables', () => {
  assert.deepEqual([...SCALE], [1, 5 / 4, 4 / 3, 3 / 2, 5 / 3]);
  assert.deepEqual([...ALLOWED_INTERVALS], [6 / 5, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 5 / 3, 2]);
  assert.ok(Object.isFrozen(SCALE) && Object.isFrozen(ALLOWED_INTERVALS));
});

test('intervalOk: thirds, fourths, fifths, sixths and octaves pass in any order, register and unit; unisons, seconds, sevenths and the tritone do not', () => {
  for (const interval of ALLOWED_INTERVALS) {
    for (const octaves of [1, 2, 4]) {
      assert.ok(intervalOk(1, interval * octaves), `${interval} × ${octaves}`);
      assert.ok(intervalOk(interval * octaves, 1), `${interval} × ${octaves}, reversed`);
      assert.ok(intervalOk(264, 264 * interval * octaves), `${interval} × ${octaves} in hertz`);
    }
  }
  const rejected = { unison: 1, minorSecond: 16 / 15, majorSecond: 9 / 8, minorTone: 10 / 9, majorNinth: 9 / 4, minorSeventh: 16 / 9, minorSeventhJust: 9 / 5, majorSeventh: 15 / 8, tritone: 45 / 32, tritoneDown: 64 / 45, septimalTritone: 7 / 5 };
  for (const [name, ratio] of Object.entries(rejected)) {
    assert.equal(intervalOk(1, ratio), false, name);
    assert.equal(intervalOk(440 * ratio, 440), false, `${name} reversed in hertz`);
  }
  assert.equal(intervalOk(0, 1), false, 'a zero pitch is no interval');
  assert.equal(intervalOk(1, Infinity), false);
});

test('canonOctave: the dux sings 2f to 4f up to a 300 Hz carrier, f to 2f up to 600 Hz, an octave lower above that', () => {
  for (const [hz, octave] of [[110, 1], [264, 1], [300, 1], [300.5, 0], [440, 0], [528, 0], [600, 0], [601, -1], [1200, -1]]) {
    assert.equal(canonOctave(hz), octave, `${hz} Hz`);
    assert.ok(2 ** (octave + 1) * hz <= 1200, `${hz} Hz: the top of the dux register stays at or below 1200 Hz`);
  }
  for (const bad of [0, -220, Number.NaN, Infinity, undefined]) assert.throws(() => canonOctave(bad), RangeError, String(bad));
});

test('determinism: a seed gives the same entry, rests and episodes, in any order; another seed differs', () => {
  const a = createCanonPlan({ seed: 2024 });
  const b = createCanonPlan({ seed: 2024 });
  assert.equal(a.seed, 2024);
  assert.equal(a.entryS, b.entryS);
  const late = b.episode(6, 500, 264);
  for (let i = 0; i < 8; i++) {
    assert.equal(a.restS(i), b.restS(i), `rest ${i}`);
    assert.deepEqual(a.episode(i, 100 * i, 264), b.episode(i, 100 * i, 264), `episode ${i}`);
  }
  assert.deepEqual(a.episode(6, 500, 264), late, 'pure: an episode does not depend on what was asked before');
  const shifted = a.episode(3, 1000, 264);
  const base = a.episode(3, 0, 264);
  shifted.notes.forEach((note, i) => near(note.startT - base.notes[i].startT, 1000, 1e-9, 'startT only shifts the episode'));
  const other = createCanonPlan({ seed: 2025 });
  assert.notDeepEqual(other.episode(0, 0, 264).notes, a.episode(0, 0, 264).notes, 'another seed, another subject');
  assert.notEqual(other.entryS, a.entryS);
  assert.equal(createCanonPlan({ seed: -1 }).seed, 2 ** 32 - 1, 'seeds are taken as unsigned 32-bit');
});

test('every note is a scale degree times a power of two, never the carrier itself, at or below 1200 Hz; the dux keeps its octave', () => {
  for (const carrierHz of CARRIERS) {
    const octave = canonOctave(carrierHz);
    for (const { episode } of episodesAt(carrierHz, SEEDS.slice(0, 40))) {
      for (const note of episode.notes) {
        assert.ok(Number.isInteger(positionOf(note.ratio)), `${note.ratio} is a scale degree times a power of two`);
        assert.notEqual(note.ratio, 1, `${carrierHz} Hz: no voice sounds the carrier`);
        assert.ok(note.ratio * carrierHz <= 1200 + 1e-9, `${carrierHz} Hz: ${note.ratio * carrierHz} Hz is above the cap`);
        if (note.voice === 'dux') {
          assert.ok(note.ratio >= 2 ** octave - 1e-12 && note.ratio <= 2 ** (octave + 1) + 1e-12, `${carrierHz} Hz: dux ${note.ratio} outside its octave`);
        } else {
          assert.ok(note.ratio >= 2 ** (octave - 1) - 1e-12, `${carrierHz} Hz: comes ${note.ratio} more than an octave below the dux register`);
        }
      }
    }
  }
});

test('the grid: one note length per episode in [7, 12] s, augmented comes notes twice as long, and onsets of a voice at least 7 s apart', () => {
  for (const carrierHz of [198, 264, 440]) {
    const onsets = new Map();
    for (const { plan, episode } of episodesAt(carrierHz)) {
      assert.ok(episode.slotS >= 7 && episode.slotS <= 12, `slot ${episode.slotS}`);
      for (const note of episode.notes) {
        const expected = note.voice === 'comes' && episode.augmentation ? 2 * episode.slotS : episode.slotS;
        near(note.durationS, expected, 1e-12, `${note.voice} duration`);
        const key = `${plan.seed}:${note.voice}`;
        if (onsets.has(key)) assert.ok(note.startT - onsets.get(key) >= 7 - 1e-9, `${key}: onsets ${note.startT - onsets.get(key)} s apart`);
        onsets.set(key, note.startT);
      }
      near(episode.endT, Math.max(...episode.notes.map((n) => n.startT + n.durationS)), 1e-9, 'endT is the last note end');
    }
  }
});

test('every slot both voices sound in forms an allowed interval', () => {
  let checked = 0;
  for (const carrierHz of CARRIERS) {
    for (const { episode } of episodesAt(carrierHz)) {
      const dux = voiceOf(episode, 'dux');
      const comes = voiceOf(episode, 'comes');
      const slots = Math.round((episode.endT - episode.startT) / episode.slotS);
      for (let g = 0; g < slots; g++) {
        const t = episode.startT + (g + 0.5) * episode.slotS;
        const [a, b] = [soundingAt(dux, t), soundingAt(comes, t)];
        if (!a || !b) continue;
        checked += 1;
        assert.ok(intervalOk(a.ratio, b.ratio), `${carrierHz} Hz slot ${g}: ${a.ratio} against ${b.ratio}`);
      }
    }
  }
  assert.ok(checked > 10000, `only ${checked} simultaneous slots checked`);
});

test('a plain canon: the comes repeats the whole subject k = 2 or 3 notes later, at pitch or an octave lower', () => {
  const lags = new Set();
  const transpositions = new Set();
  for (const carrierHz of [198, 264, 440]) {
    for (const { episode } of episodesAt(carrierHz)) {
      if (episode.alone || episode.inversion || episode.augmentation || episode.stretto) continue;
      const dux = voiceOf(episode, 'dux');
      const comes = voiceOf(episode, 'comes');
      assert.ok(episode.k === 2 || episode.k === 3, `k ${episode.k}`);
      assert.ok(dux.length >= 5 && dux.length <= 8, `subject of ${dux.length} notes`);
      assert.equal(comes.length, dux.length);
      const factor = episode.down ? 0.5 : 1;
      comes.forEach((note, i) => {
        near(note.ratio, dux[i].ratio * factor, 1e-12, `comes note ${i}`);
        near(note.startT, dux[i].startT + episode.k * episode.slotS, 1e-9, `comes onset ${i}`);
      });
      lags.add(episode.k);
      transpositions.add(episode.down);
    }
  }
  assert.deepEqual([...lags].sort(), [2, 3]);
  assert.equal(transpositions.size, 2, 'both at pitch and an octave lower occur');
});

test('fugal devices: inversion mirrors the subject about its first degree in the scale, augmentation doubles the comes notes, stretto answers after one note', () => {
  const seen = { inversion: 0, augmentation: 0, stretto: 0 };
  for (const carrierHz of [198, 264, 440]) {
    for (const { episode } of episodesAt(carrierHz)) {
      if (episode.alone) continue;
      const dux = voiceOf(episode, 'dux');
      const comes = voiceOf(episode, 'comes');
      const span = episode.augmentation ? 2 : 1;
      const first = positionOf(dux[0].ratio);
      comes.forEach((note, i) => {
        const p = positionOf(dux[i].ratio);
        const expected = (episode.inversion ? 2 * first - p : p) - (episode.down ? 5 : 0);
        assert.equal(positionOf(note.ratio), expected, `comes note ${i}`);
        near(note.startT, episode.startT + (episode.k + span * i) * episode.slotS, 1e-9, `comes onset ${i}`);
      });
      if (episode.stretto) assert.equal(episode.k, 1);
      else assert.ok(episode.k === 2 || episode.k === 3);
      for (const device of Object.keys(seen)) if (episode[device]) seen[device] += 1;
    }
  }
  for (const [device, count] of Object.entries(seen)) assert.ok(count > 50, `${device} seen ${count} times`);
});

test('phrases are legato: each note glides from the one before, the first starts fresh, only the last ends the phrase', () => {
  for (const { episode } of episodesAt(264, SEEDS.slice(0, 30))) {
    for (const voice of ['dux', 'comes']) {
      const notes = voiceOf(episode, voice);
      notes.forEach((note, i) => {
        assert.equal(note.legatoFromRatio, i === 0 ? null : notes[i - 1].ratio, `${voice} note ${i}`);
        assert.equal(note.phraseEnd, i === notes.length - 1, `${voice} note ${i}`);
        if (i > 0) near(note.startT, notes[i - 1].startT + notes[i - 1].durationS, 1e-9, `${voice} note ${i} follows on`);
      });
    }
    for (let i = 1; i < episode.notes.length; i++) assert.ok(episode.notes[i].startT >= episode.notes[i - 1].startT, 'notes sorted by startT');
  }
});

test('the first episode has no device; later ones bring each with bounded odds; the dux rarely sings alone', () => {
  const counts = { later: 0, inversion: 0, augmentation: 0, stretto: 0 };
  for (let seed = 1; seed <= 1500; seed++) {
    const plan = createCanonPlan({ seed });
    const first = plan.episode(0, 0, 264);
    assert.ok(!first.inversion && !first.augmentation && !first.stretto, `seed ${seed}: the first episode has no device`);
    for (let index = 1; index < 8; index++) {
      const episode = plan.episode(index, 0, 264);
      counts.later += 1;
      for (const device of ['inversion', 'augmentation', 'stretto']) if (episode[device]) counts[device] += 1;
    }
  }
  near(counts.inversion / counts.later, 0.3, 0.03, 'inversion share');
  near(counts.augmentation / counts.later, 0.2, 0.03, 'augmentation share');
  near(counts.stretto / counts.later, 0.2, 0.03, 'stretto share');
  // Below 240 Hz both voices share one octave (no note between f and 2f), so a solo statement is the fallback more often.
  const tally = { open: { episodes: 0, alone: 0 }, close: { episodes: 0, alone: 0 } };
  for (const carrierHz of CARRIERS) {
    const bucket = tally[carrierHz < 240 ? 'close' : 'open'];
    for (const { episode } of episodesAt(carrierHz)) {
      bucket.episodes += 1;
      if (!episode.alone) continue;
      bucket.alone += 1;
      assert.equal(voiceOf(episode, 'comes').length, 0, 'alone means no comes');
      assert.equal(episode.k, null);
    }
  }
  assert.ok(tally.open.alone / tally.open.episodes < 0.01, `from 240 Hz the dux sang alone in ${tally.open.alone} of ${tally.open.episodes} episodes`);
  assert.ok(tally.close.alone / tally.close.episodes < 0.06, `below 240 Hz the dux sang alone in ${tally.close.alone} of ${tally.close.episodes} episodes`);
});

test('timing: the first entry 20-40 s after enabling, rests of 10-30 s between episodes', () => {
  const entries = [];
  for (const seed of SEEDS) {
    const plan = createCanonPlan({ seed });
    entries.push(plan.entryS);
    for (let i = 0; i < 20; i++) {
      const rest = plan.restS(i);
      assert.ok(rest >= 10 && rest <= 30, `rest ${rest}`);
    }
  }
  assert.ok(entries.every((s) => s >= 20 && s <= 40), 'entry window');
  assert.ok(Math.max(...entries) - Math.min(...entries) > 15, 'entries spread over the window');
  for (const { plan, episode } of episodesAt(264, SEEDS.slice(0, 10))) {
    if (episode.index === 0) near(episode.startT, plan.entryS, 1e-12, 'first episode at entryS');
    assert.equal(episode.notes[0].startT, episode.startT, 'the dux opens the episode');
  }
});

test('subjects are Voss 1/f walks: steps of ±1, mostly, or ±2, and a positive lag-1 autocorrelation', () => {
  for (const carrierHz of [198, 264, 440]) {
    const contours = [];
    for (const { episode } of episodesAt(carrierHz)) contours.push(voiceOf(episode, 'dux').map((n) => positionOf(n.ratio)));
    const steps = { 1: 0, 2: 0 };
    for (const contour of contours) {
      for (let n = 1; n < contour.length; n++) {
        const size = Math.abs(contour[n] - contour[n - 1]);
        assert.ok(size === 1 || size === 2, `${carrierHz} Hz: a step of ${size}`);
        steps[size] += 1;
      }
    }
    const share = steps[1] / (steps[1] + steps[2]);
    assert.ok(share > 0.5 && share < 0.8, `${carrierHz} Hz: ±1 share ${share}`);
    // Lag-1 autocorrelation of positions about their pooled mean: about 0 for notes drawn independently, positive for a walk.
    const all = contours.flat();
    const mean = all.reduce((sum, p) => sum + p, 0) / all.length;
    let lagged = 0;
    let variance = 0;
    for (const contour of contours) {
      contour.forEach((p, n) => {
        variance += (p - mean) ** 2;
        if (n > 0) lagged += (p - mean) * (contour[n - 1] - mean);
      });
    }
    assert.ok(lagged / variance > 0.1, `${carrierHz} Hz: lag-1 autocorrelation ${lagged / variance}`);
  }
});

test('episodes reject a carrier that is not a positive frequency', () => {
  const plan = createCanonPlan({ seed: 1 });
  assert.throws(() => plan.episode(0, 0, 0), RangeError);
  assert.throws(() => plan.episode(0, 0, Number.NaN), RangeError);
});

test('below 240 Hz no canon note falls between f and 2f: the comes keeps the dux octave, clear of the beat voices', () => {
  for (const carrierHz of [110, 150, 176, 198, 220, 239]) {
    for (const { episode } of episodesAt(carrierHz, SEEDS.slice(0, 40))) {
      for (const note of episode.notes) {
        assert.ok(note.ratio >= 2 - 1e-9, `${carrierHz} Hz: ${note.voice} at ratio ${note.ratio}`);
        // every note at least 60 Hz above the binaural/monaural voices (f + 15 Hz at the largest beat)
        assert.ok(note.ratio * carrierHz - (carrierHz + 15) >= 60, `${carrierHz} Hz: ${note.ratio * carrierHz} Hz is too close`);
      }
    }
  }
});
