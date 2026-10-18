// Canon pad layer (v0.4 spec §0 D4): sings core/canon.js into the pad. Each voice is an oscillator at
// intrinsic frequency 0 driven by the carrier through its own ratio gain (glides and Attune keep the
// harmony), with partials [1, 0.12] and a level gain at canonVoicingFor's voiceGain into the pad input.
// Phrases swell in over 2.5 s, glide note to note (τ 0.4 s) and release over their last 3 s. One planner
// on the shared scheduler; only this layer's own gains are automated; mono, so centred in both ears.

import { canonVoicingFor } from '../core/voicing.js';
import { canonOctave, createCanonPlan } from '../core/canon.js';
import { holdParam, glideTo, fade } from './automation.js';

const LEAD = 0.01;
/** Seconds of notes planned ahead: the spec's 4 plus room for a hidden tab's slow ticks. */
const HORIZON_S = 6;
const ATTACK_S = 2.5;
const RELEASE_S = 3;
const GLIDE_TAU = 0.4;
const PARTIALS = Object.freeze([1, 0.12]);
/** Relative distance from setCarrierHz's value beyond which the live carrier counts as moving (Attune). */
const SETTLED = 0.005;

/** Canon voices on `carrier` (its offset is read, never automated) into `destination`: { setEnabled(on, t), setCarrierHz(hz), hold(t), dispose() }; the first rng draw seeds the plan. */
export function createCanonLayer(ctx, { carrier, destination, scheduler, rng }) {
  const now = () => ctx.currentTime + LEAD;
  const plan = createCanonPlan({ seed: Math.floor(rng() * 2 ** 32) });
  const imag = Float32Array.from([0, ...PARTIALS]);
  const wave = ctx.createPeriodicWave(new Float32Array(imag.length), imag);
  const voices = { dux: createVoice(), comes: createVoice() };
  let enabled = false;
  let carrierHz = null;
  let octave = null;
  let voiceGain = 0;
  let nextIndex = 0;
  let nextStart = Infinity;
  let episodeEnd = -Infinity;
  let queue = [];

  /** carrier → ratio gain → oscillator frequency; oscillator → level gain → destination; [from, to) is the phrase it sounds. */
  function createVoice() {
    const ratio = ctx.createGain();
    ratio.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 0;
    osc.setPeriodicWave(wave);
    const level = ctx.createGain();
    level.gain.value = 0;
    carrier.connect(ratio);
    ratio.connect(osc.frequency);
    osc.connect(level);
    level.connect(destination);
    osc.start(ctx.currentTime);
    return { ratioNode: ratio, osc, levelNode: level, ratio: ratio.gain, level: level.gain, from: 0, to: 0 };
  }

  /** False while the carrier is away from setCarrierHz's value (an Attune sweep): no episode then starts past the register cap. */
  function carrierSettled() {
    const live = carrier.offset?.value;
    return live === undefined || Math.abs(live - carrierHz) <= SETTLED * carrierHz;
  }

  function queueEpisode(startT) {
    const episode = plan.episode(nextIndex, startT, carrierHz);
    for (const [name, voice] of Object.entries(voices)) {
      const notes = episode.notes.filter((note) => note.voice === name);
      if (notes.length === 0) continue;
      voice.from = notes[0].startT;
      voice.to = notes.at(-1).startT + notes.at(-1).durationS;
    }
    queue = episode.notes;
    episodeEnd = episode.endT;
    nextIndex += 1;
    nextStart = episode.endT + plan.restS(nextIndex);
  }

  function play(note) {
    const voice = voices[note.voice];
    if (note.legatoFromRatio === null) {
      holdParam(voice.ratio, note.startT);
      voice.ratio.setValueAtTime(note.ratio, note.startT);
      fade(voice.level, 0, voiceGain, note.startT, ATTACK_S, 'scurve');
    } else {
      glideTo(voice.ratio, note.ratio, note.startT, GLIDE_TAU, 'target');
    }
    if (note.phraseEnd) fade(voice.level, voiceGain, 0, note.startT + note.durationS - RELEASE_S, RELEASE_S, 'scurve');
  }

  /** Later glides are dropped (one in flight still lands on its note); a sounding voice fades out over 3 s, a swell not yet begun is cancelled. */
  function release(voice, t) {
    voice.ratio.cancelScheduledValues(t);
    if (voice.from <= t && t < voice.to) {
      fade(voice.level, voice.level.value, 0, t, RELEASE_S, 'scurve');
      voice.to = t + RELEASE_S;
    } else {
      holdParam(voice.level, t);
      voice.from = t;
      voice.to = t;
    }
  }

  function releaseAll(t) {
    for (const voice of Object.values(voices)) release(voice, t);
    queue = [];
    episodeEnd = Math.min(episodeEnd, t + RELEASE_S);
  }

  /** Releases at t and leaves a full rest before the next episode, never bringing a planned one forward. */
  function cut(t) {
    const busy = t < episodeEnd;
    releaseAll(t);
    const after = t + RELEASE_S + plan.restS(nextIndex);
    nextStart = busy ? after : Math.max(nextStart, after);
  }

  const planner = {
    plannedUpTo: 0,
    horizon: HORIZON_S,
    plan(from, to) {
      if (!enabled || carrierHz === null) return [];
      if (queue.length > 0 && queue[0].startT < from) cut(from);
      if (queue.length === 0 && nextStart < to && carrierSettled()) queueEpisode(Math.max(nextStart, from));
      const due = [];
      while (queue.length > 0 && queue[0].startT < to) {
        const note = queue.shift();
        due.push({ at: note.startT, note });
      }
      return due;
    },
    apply(item) {
      play(item.note);
    },
  };
  scheduler.add(planner);

  /** On: the first episode comes entryS (20-40 s) after t. Off: the voices release over 3 s and nothing more is planned. */
  function setEnabled(on, t = now()) {
    const next = Boolean(on);
    if (next === enabled) return;
    enabled = next;
    if (enabled) nextStart = t + plan.entryS;
    else releaseAll(t);
  }

  /** Carrier for the register cap and voiceGain (canonVoicingFor); a change of either releases the voices until after a rest. */
  function setCarrierHz(hz) {
    const nextOctave = canonOctave(hz);
    const nextGain = canonVoicingFor(hz).voiceGain;
    const changed = carrierHz !== null && (nextOctave !== octave || nextGain !== voiceGain);
    carrierHz = hz;
    octave = nextOctave;
    voiceGain = nextGain;
    if (changed) hold();
  }

  /** Releases every sounding voice at t (Attune, mode or carrier change); the next episode follows a rest. */
  function hold(t = now()) {
    if (enabled) cut(t);
  }

  /** Stops both voices, leaves the pad and stops planning. */
  function dispose() {
    enabled = false;
    scheduler.remove(planner);
    const t = ctx.currentTime;
    for (const voice of Object.values(voices)) {
      voice.osc.stop(t);
      voice.ratioNode.disconnect();
      voice.levelNode.disconnect();
    }
  }

  return { setEnabled, setCarrierHz, hold, dispose };
}
