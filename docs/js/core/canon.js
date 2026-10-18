// Canon pad music (v0.4 spec §0 D4): two monophonic voices in just ratios to the carrier. Each
// episode the dux sings a 5-8 note Voss 1/f walk over the scale (Voss & Clarke 1978; Gardner 1978)
// and the comes answers k notes later, at pitch or an octave lower; later episodes may invert,
// augment or stretto it. Notes heard together are consonant, and neither voice sounds the carrier
// itself (its beat voices sit ±Δ/2 away and would beat). A subject that breaks a rule is drawn again
// up to 24 times, then the dux sings alone. Pure, deterministic by seed; ratios multiply the carrier.

import { mulberry32, randRange } from './rng.js';
import { registerOf } from './voicing.js';

/** Scale degrees as ratios to the carrier, repeated over octaves: 1, 5/4, 4/3, 3/2, 5/3 (C E F G A over C). */
export const SCALE = Object.freeze([1, 5 / 4, 4 / 3, 3 / 2, 5 / 3]);

/** Intervals the two voices may form, reduced into one octave: minor and major third, fourth, fifth, minor and major sixth, octave. */
export const ALLOWED_INTERVALS = Object.freeze([6 / 5, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 5 / 3, 2]);

const REGISTER_CAP_HZ = 1200;
// Below 240 Hz (voicing registers low and lowMid) a note between f and 2f sits inside the beat voices' critical band
// (5/4 of 110 Hz is 27.5 Hz from the carrier), so there the comes keeps to the dux's own octave.
const CLOSE_REGISTERS = new Set(['low', 'lowMid']);
/** Scale positions per octave; position 0 is the carrier. */
const OCTAVE = SCALE.length;
const NOTE_SECONDS = Object.freeze([7, 12]);
const REST_SECONDS = Object.freeze([10, 30]);
const ENTRY_SECONDS = Object.freeze([20, 40]);
const SUBJECT_NOTES = Object.freeze([5, 8]);
/** Notes the comes waits before it answers; stretto answers after one. */
const LAGS = Object.freeze([2, 3]);
const MAX_TRIES = 24;
const MAX_TRIES_CLOSE = 48; // one octave for both voices leaves fewer valid subjects; a solo statement remains the fallback
/** Chance of each fugal device in every episode after the first. */
const DEVICE_ODDS = Object.freeze({ inversion: 0.3, augmentation: 0.2, stretto: 0.2 });
const DICE = 3;
const FACES = 3;
const EPSILON = 1e-9;
const STREAM = Object.freeze({ entry: 1, rest: 2, episode: 3 });

const pick = (rng, items) => items[Math.floor(rng() * items.length)];
const randInt = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));
const ratioOf = (position) => SCALE[((position % OCTAVE) + OCTAVE) % OCTAVE] * 2 ** Math.floor(position / OCTAVE);
/** The dux's positions: the octave [5j, 5j + 5] above the carrier, trimmed where it would touch position 0. */
const duxRangeOf = (octave) => [OCTAVE * octave || 1, OCTAVE * (octave + 1) || -1];

/** True when two pitches (ratios or hertz) form one of ALLOWED_INTERVALS once reduced into one octave; unisons, seconds, sevenths and the tritone do not. */
export function intervalOk(a, b) {
  let ratio = Math.max(a, b) / Math.min(a, b);
  if (!Number.isFinite(ratio)) return false;
  while (ratio > 2 + EPSILON) ratio /= 2;
  return ALLOWED_INTERVALS.some((allowed) => Math.abs(ratio - allowed) < EPSILON);
}

/** Octave of the dux's register: 1 (2f to 4f) while 4f <= 1200 Hz, 0 (f to 2f) while 2f <= 1200 Hz, lower above that. */
export function canonOctave(carrierHz) {
  if (!(carrierHz > 0 && carrierHz < Infinity)) throw new RangeError(`canon: carrier ${carrierHz} Hz is not a positive frequency`);
  return Math.min(1, Math.floor(Math.log2(REGISTER_CAP_HZ / carrierHz)) - 1);
}

/** The canon of one seed: { seed, entryS (20-40 s from enabling to the first episode), restS(index) (10-30 s of silence before episode index), episode(index, startT, carrierHz) (pure) }. */
export function createCanonPlan({ seed }) {
  const key = seed >>> 0;
  return {
    seed: key,
    entryS: randRange(streamOf(key, STREAM.entry), ...ENTRY_SECONDS),
    restS: (index) => randRange(streamOf(key, STREAM.rest, index), ...REST_SECONDS),
    episode: (index, startT, carrierHz) => planEpisode(streamOf(key, STREAM.episode, index), index, startT, carrierHz),
  };
}

/**
 * One grid slot slotS (7-12 s) and, after the first episode, the devices; then up to 24 subjects with a
 * fresh lag, transposition and length each until one keeps every rule, else the dux alone.
 * → { index, startT, endT, slotS, alone, k, down, inversion, augmentation, stretto, notes: [{ voice:
 * 'dux' | 'comes', ratio, startT, durationS, legatoFromRatio | null, phraseEnd }] by startT }
 */
function planEpisode(rng, index, startT, carrierHz) {
  const octave = canonOctave(carrierHz);
  const slotS = randRange(rng, ...NOTE_SECONDS);
  const [inversion, augmentation, stretto] = Object.values(DEVICE_ODDS).map((odds) => rng() < odds && index > 0);
  const span = augmentation ? 2 : 1;
  const duxRange = duxRangeOf(octave);
  const close = CLOSE_REGISTERS.has(registerOf(carrierHz));
  const comesRange = [OCTAVE * (close ? octave : octave - 1), OCTAVE * (octave + 1)];
  const episode = { index, startT, slotS, inversion, augmentation, stretto };
  for (let tries = 0; tries < (close ? MAX_TRIES_CLOSE : MAX_TRIES); tries++) {
    const k = stretto ? 1 : randInt(rng, LAGS);
    const down = rng() < 0.5 && !close;
    const answer = (position, first) => (inversion ? 2 * first - position : position) - (down ? OCTAVE : 0);
    const fits = (position, notes) => {
      const comes = answer(position, notes.length > 0 ? notes[0] : position);
      if (comes < comesRange[0] || comes > comesRange[1] || comes === 0) return false;
      if (notes.length < k) return true;
      return intervalOk(ratioOf(position), ratioOf(answer(notes[Math.floor((notes.length - k) / span)], notes[0])));
    };
    const subject = vossWalk(rng, randInt(rng, SUBJECT_NOTES), duxRange, fits);
    if (subject) {
      const comes = phrase('comes', subject.map((p) => answer(p, subject[0])), startT + k * slotS, span * slotS);
      return withNotes({ ...episode, alone: false, k, down }, [...phrase('dux', subject, startT, slotS), ...comes]);
    }
  }
  const subject = vossWalk(rng, randInt(rng, SUBJECT_NOTES), duxRange, () => true);
  return withNotes({ ...episode, alone: true, k: null, down: null }, phrase('dux', subject, startT, slotS));
}

/**
 * Voss 1/f walk of `length` positions in [lo, hi]: three three-faced dice; note n re-rolls die ctz(n)
 * (die 0 at odd notes, die 1 at notes 2 and 6, die 2 at note 4) onto another face, so every step is ±1
 * or ±2, turned round at the register's edge. Takes only positions `fits` accepts; null when none fits.
 */
function vossWalk(rng, length, [lo, hi], fits) {
  const dice = Array.from({ length: DICE }, () => Math.floor(rng() * FACES));
  const firsts = [];
  for (let p = lo; p <= hi; p++) if (fits(p, [])) firsts.push(p);
  if (firsts.length === 0) return null;
  const notes = [pick(rng, firsts)];
  for (let n = 1; n < length; n++) {
    const die = Math.min(DICE - 1, 31 - Math.clz32(n & -n));
    const prev = notes[n - 1];
    const options = [];
    for (let shift = 1; shift < FACES; shift++) {
      const face = (dice[die] + shift) % FACES;
      const step = face - dice[die];
      const position = prev + step >= lo && prev + step <= hi ? prev + step : prev - step;
      if (fits(position, notes)) options.push({ face, position });
    }
    if (options.length === 0) return null;
    const choice = pick(rng, options);
    dice[die] = choice.face;
    notes.push(choice.position);
  }
  return notes;
}

/** One voice's legato phrase: notes of `durationS` from t0, each gliding from the one before, the last ending the phrase. */
function phrase(voice, positions, t0, durationS) {
  return positions.map((position, i) => ({
    voice,
    ratio: ratioOf(position),
    startT: t0 + i * durationS,
    durationS,
    legatoFromRatio: i === 0 ? null : ratioOf(positions[i - 1]),
    phraseEnd: i === positions.length - 1,
  }));
}

function withNotes(episode, notes) {
  notes.sort((a, b) => a.startT - b.startT);
  return { ...episode, endT: Math.max(...notes.map((note) => note.startT + note.durationS)), notes };
}

/** A random stream per (seed, purpose, index), keyed through MurmurHash3's finaliser so neighbouring indices share nothing. */
function streamOf(seed, purpose, index = 0) {
  return mulberry32(scramble(scramble(seed ^ purpose) + index));
}

function scramble(h) {
  let x = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}
