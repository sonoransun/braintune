// The tone layer (§5 tone.js, §6.1, §6.2, §6.4 of the plan): a carrier ConstantSource and a
// half-beat ConstantSource drive every oscillator (intrinsic frequency 0), so the beat stays
// exact through carrier glides and the attune sweep. Three voice groups share the carrier:
// binaural (sines hard-panned, ±Δ/2), monaural (both sines centred) and isochronic (a timbred
// carrier through a raised-cosine gate at Δ), plus a quiet pad (fifth, octave, sub) with two
// very slow LFOs. Mode changes are 1.2 s equal-power crossfades; timbre changes crossfade to a
// second oscillator; beat changes ramp the half-beat offset and the gate's playbackRate.

import { VOICE_PEAK, PAD_DB, carrierTrim, dbToGain } from '../core/levels.js';
import { timbreCoefficients, timbreGainTrim } from '../core/timbres.js';
import { gateParams, gatePlaybackRate } from '../core/gate.js';
import { holdParam, glideTo, fade, crossfade } from './automation.js';

const MODES = Object.freeze(['binaural', 'monaural', 'isochronic']);
const LEAD = 0.01;
const TRIM_TAU = 0.3;
const GATE_RATE_TAU = 0.3;
const GATE_SWAP_SECONDS = 0.6;
const TIMBRE_SWAP_SECONDS = 0.8;
const PAD_SWITCH_SECONDS = 1.2;
const LP_CARRIER = Object.freeze({ ratio: 4, Q: 0.6 });
const PAD_VOICES = Object.freeze([
  { ratio: 1.5, gain: 0.5, timbred: true },
  { ratio: 2, gain: 0.6, timbred: true },
  { ratio: 0.5, gain: 0.35, timbred: false },
]);
const PAD_LP = Object.freeze({ hz: 1800, Q: 0.7 });
const PAD_LFO_FILTER = Object.freeze({ hz: 0.08, depthHz: 300 });
const PAD_LFO_AMP = Object.freeze({ hz: 0.06, depth: 0.19 });
const ATTUNE = Object.freeze({ from: 180, to: 520, seconds: 60, approachSeconds: 1, legsAhead: 2 });
const ATTUNE_TRIM_TAU = 1;

/**
 * Creates the tone layer into `bus`. `initial` sets the starting carrier, beat, mode, timbre, pad and
 * gate params without any ramp; `setTimer`/`clearTimer` drive the attune sweep's leg extension.
 */
export function createToneLayer(ctx, bus, cache, initial = {}) {
  const {
    carrierHz = 256, beatHz = 10, mode = 'isochronic', timbre = 'velvet', pad = true, gate = gateParams(beatHz),
    setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (handle) => clearTimeout(handle),
  } = initial;
  if (!MODES.includes(mode)) throw new RangeError(`tone: unknown mode "${mode}"`);
  const state = { carrierHz, beatHz, mode, timbre, pad, attune: null, started: false };
  const waves = new Map();
  const sources = [];
  const now = () => ctx.currentTime + LEAD;

  const waveFor = (name) => {
    if (!waves.has(name)) {
      const { real, imag } = timbreCoefficients(name);
      waves.set(name, ctx.createPeriodicWave(real, imag));
    }
    return waves.get(name);
  };
  const gain = (value) => {
    const node = ctx.createGain();
    node.gain.value = value;
    return node;
  };
  const sine = () => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 0;
    sources.push(osc);
    return osc;
  };
  const panner = (pan) => {
    const node = ctx.createStereoPanner();
    node.pan.value = pan;
    return node;
  };
  const lowpass = (hz, Q) => {
    const node = ctx.createBiquadFilter();
    node.type = 'lowpass';
    node.frequency.value = hz;
    node.Q.value = Q;
    return node;
  };

  // Control sources: carrier f and half-beat Δ/2 (inverted for the left ear).
  const carrier = ctx.createConstantSource();
  carrier.offset.value = carrierHz;
  const halfBeat = ctx.createConstantSource();
  halfBeat.offset.value = beatHz / 2;
  const invert = gain(-1);
  halfBeat.connect(invert);
  sources.push(carrier, halfBeat);

  // Mode gains into the bus.
  const modeGains = { binaural: gain(0), monaural: gain(0), isochronic: gain(0) };
  modeGains[mode].gain.value = 1;
  for (const node of Object.values(modeGains)) node.connect(bus);

  // Binaural and monaural voices: two sines at f ∓ Δ/2.
  const oscL = sine();
  const oscR = sine();
  carrier.connect(oscL.frequency);
  invert.connect(oscL.frequency);
  carrier.connect(oscR.frequency);
  halfBeat.connect(oscR.frequency);
  const trim0 = carrierTrim(carrierHz);
  const vL = gain(VOICE_PEAK * trim0);
  const vR = gain(VOICE_PEAK * trim0);
  const vM = gain((VOICE_PEAK / 2) * trim0);
  const panL = panner(-1);
  const panR = panner(1);
  oscL.connect(vL);
  vL.connect(panL);
  panL.connect(modeGains.binaural);
  oscR.connect(vR);
  vR.connect(panR);
  panR.connect(modeGains.binaural);
  oscL.connect(vM);
  oscR.connect(vM);
  vM.connect(modeGains.monaural);

  // Isochronic voice: timbred carrier → lpC (4·f) → gate (Gain 0 driven by the looped gate period).
  const carrierVoice = createTimbrePair(ctx, carrier, 1, waveFor(timbre), sources);
  const vIso = gain(VOICE_PEAK * trim0 * timbreGainTrim(timbre));
  const lpC = lowpass(0, LP_CARRIER.Q);
  const lpDrive = gain(LP_CARRIER.ratio);
  carrier.connect(lpDrive);
  lpDrive.connect(lpC.frequency);
  const gateNode = gain(0);
  carrierVoice.output.connect(vIso);
  vIso.connect(lpC);
  lpC.connect(gateNode);
  gateNode.connect(modeGains.isochronic);
  const gateDrive = createGateDrive(ctx, cache, gateNode.gain);

  // Pad: fifth and octave in the timbre, sub as a sine, through a slowly moving low-pass at −14 dB.
  const padGain = dbToGain(PAD_DB);
  const lpPad = lowpass(PAD_LP.hz, PAD_LP.Q);
  const vPad = gain(padGain);
  const padOn = gain(pad ? 1 : 0);
  lpPad.connect(vPad);
  vPad.connect(padOn);
  padOn.connect(bus);
  const padPairs = [];
  for (const voice of PAD_VOICES) {
    const level = gain(voice.gain);
    level.connect(lpPad);
    if (voice.timbred) {
      const pair = createTimbrePair(ctx, carrier, voice.ratio, waveFor(timbre), sources);
      pair.output.connect(level);
      padPairs.push(pair);
    } else {
      const osc = sine();
      const ratio = gain(voice.ratio);
      carrier.connect(ratio);
      ratio.connect(osc.frequency);
      osc.connect(level);
    }
  }
  const lfoFilter = sine();
  lfoFilter.frequency.value = PAD_LFO_FILTER.hz;
  const lfoFilterDepth = gain(PAD_LFO_FILTER.depthHz);
  lfoFilter.connect(lfoFilterDepth);
  lfoFilterDepth.connect(lpPad.frequency);
  const lfoAmp = sine();
  lfoAmp.frequency.value = PAD_LFO_AMP.hz;
  const lfoAmpDepth = gain(PAD_LFO_AMP.depth * padGain);
  lfoAmp.connect(lfoAmpDepth);
  lfoAmpDepth.connect(vPad.gain);

  function retargetTrims(hz, t, tau = TRIM_TAU) {
    const trim = carrierTrim(hz);
    glideTo(vL.gain, VOICE_PEAK * trim, t, tau, 'target');
    glideTo(vR.gain, VOICE_PEAK * trim, t, tau, 'target');
    glideTo(vM.gain, (VOICE_PEAK / 2) * trim, t, tau, 'target');
    glideTo(vIso.gain, VOICE_PEAK * trim * timbreGainTrim(state.timbre), t, tau, 'target');
  }

  /** Crossfades to another mode over `seconds` (equal power). */
  function setMode(next, { seconds = 1.2 } = {}) {
    if (!MODES.includes(next)) throw new RangeError(`tone: unknown mode "${next}"`);
    if (next === state.mode) return;
    crossfade(modeGains[state.mode].gain, modeGains[next].gain, now(), seconds);
    state.mode = next;
  }

  /** Glides the carrier exponentially over `seconds` and retargets the loudness trims. */
  function setCarrier(hz, { seconds = 1.5 } = {}) {
    const t = now();
    glideTo(carrier.offset, hz, t, seconds, 'exp');
    retargetTrims(hz, t);
    state.carrierHz = hz;
  }

  /** Ramps the beat linearly over `seconds` and retargets the gate's playback rate (τ 0.3 s). */
  function setBeat(hz, { seconds = 1.5 } = {}) {
    const t = now();
    glideTo(halfBeat.offset, hz / 2, t, seconds, 'lin');
    gateDrive.setBeat(hz, t);
    state.beatHz = hz;
  }

  /** One long linear beat glide fromHz → toHz over `seconds`, after an optional `after` seconds approach to fromHz (Sleep: 6 → 2 Hz over 12 minutes). */
  function scheduleBeatGlide(fromHz, toHz, seconds, { after = 0 } = {}) {
    const t = now();
    holdParam(halfBeat.offset, t);
    halfBeat.offset.setValueAtTime(halfBeat.offset.value, t);
    if (after > 0) halfBeat.offset.linearRampToValueAtTime(fromHz / 2, t + after);
    else halfBeat.offset.setValueAtTime(fromHz / 2, t);
    halfBeat.offset.linearRampToValueAtTime(toHz / 2, t + after + seconds);
    gateDrive.glide(fromHz, toHz, t, after, seconds);
    state.beatHz = toHz;
  }

  /** Swaps the timbre on the isochronic carrier and the pad with 0.8 s oscillator crossfades. */
  function setTimbre(name) {
    if (name === state.timbre) return;
    const wave = waveFor(name);
    const t = now();
    state.timbre = name;
    carrierVoice.setWave(wave, t, TIMBRE_SWAP_SECONDS);
    for (const pair of padPairs) pair.setWave(wave, t, TIMBRE_SWAP_SECONDS);
    retargetTrims(state.carrierHz, t);
  }

  /** Fades the pad in or out over 1.2 s. */
  function setPad(on) {
    const next = Boolean(on);
    if (next === state.pad) return;
    state.pad = next;
    fade(padOn.gain, padOn.gain.value, next ? 1 : 0, now(), PAD_SWITCH_SECONDS, next ? 'equalPowerIn' : 'equalPowerOut');
  }

  /** Loads a gate period rendered at `hz` with `params` and blends over to it (0.6 s). */
  function setGate(params, hz = state.beatHz) {
    gateDrive.swap(hz, params, now());
  }

  /** Attune: glide to `from` over 1 s, then exponential legs from ↔ to of `seconds` each until commit or cancel. */
  function startAttune({ from = ATTUNE.from, to = ATTUNE.to, seconds = ATTUNE.seconds } = {}) {
    if (state.attune) return;
    const t = now();
    const legStart = t + ATTUNE.approachSeconds;
    holdParam(carrier.offset, t);
    carrier.offset.setValueAtTime(carrier.offset.value, t);
    carrier.offset.exponentialRampToValueAtTime(from, legStart);
    retargetTrims(Math.sqrt(from * to), t, ATTUNE_TRIM_TAU);
    const attune = { previous: state.carrierHz, legs: 0, timer: null };
    state.attune = attune;
    const extend = () => {
      if (state.attune !== attune) return;
      while (legStart + attune.legs * seconds < ctx.currentTime + seconds * ATTUNE.legsAhead) {
        const target = attune.legs % 2 === 0 ? to : from;
        carrier.offset.exponentialRampToValueAtTime(target, legStart + (attune.legs + 1) * seconds);
        attune.legs += 1;
      }
      attune.timer = setTimer(extend, seconds * 1000);
    };
    extend();
  }

  /** Stops the sweep where it is and returns that carrier in Hz. */
  function commitAttune() {
    const attune = state.attune;
    if (!attune) return state.carrierHz;
    clearTimer(attune.timer);
    state.attune = null;
    const value = carrier.offset.value;
    const t = now();
    holdParam(carrier.offset, t);
    carrier.offset.setValueAtTime(value, t);
    retargetTrims(value, t);
    state.carrierHz = value;
    return value;
  }

  /** Abandons the sweep and glides back to the carrier from before it over 1.5 s. */
  function cancelAttune() {
    const attune = state.attune;
    if (!attune) return;
    clearTimer(attune.timer);
    state.attune = null;
    setCarrier(attune.previous, { seconds: 1.5 });
  }

  /** Starts every source; call once, when the context exists. */
  function start() {
    if (state.started) return;
    state.started = true;
    const t = ctx.currentTime;
    for (const source of sources) source.start(t);
    gateDrive.start(beatHz, gate, t);
  }

  /** Stops every source and leaves the bus. */
  function stop() {
    if (state.attune) clearTimer(state.attune.timer);
    state.attune = null;
    if (state.started) {
      const t = ctx.currentTime;
      for (const source of sources) source.stop(t);
      gateDrive.stop(t);
    }
    state.started = false;
    for (const node of Object.values(modeGains)) node.disconnect();
    padOn.disconnect();
  }

  return {
    setMode, setCarrier, setBeat, scheduleBeatGlide, setTimbre, setPad, setGate,
    startAttune, commitAttune, cancelAttune, start, stop,
    params: { carrierHz: carrier.offset, halfBeat: halfBeat.offset },
    /** { mode, carrierHz, beatHz, timbre, pad, attuning }. */
    getState: () => ({ mode: state.mode, carrierHz: state.carrierHz, beatHz: state.beatHz, timbre: state.timbre, pad: state.pad, attuning: state.attune !== null }),
  };
}

/** Two oscillators at carrier × ratio sharing one output; setWave swaps the PeriodicWave on the idle one and crossfades. */
function createTimbrePair(ctx, carrier, ratio, wave, sources) {
  const drive = ctx.createGain();
  drive.gain.value = ratio;
  carrier.connect(drive);
  const output = ctx.createGain();
  output.gain.value = 1;
  const oscs = [ctx.createOscillator(), ctx.createOscillator()];
  const gains = oscs.map((osc, i) => {
    const node = ctx.createGain();
    node.gain.value = i === 0 ? 1 : 0;
    osc.frequency.value = 0;
    osc.setPeriodicWave(wave);
    drive.connect(osc.frequency);
    osc.connect(node);
    node.connect(output);
    sources.push(osc);
    return node;
  });
  let active = 0;
  return {
    output,
    setWave(nextWave, t, seconds) {
      const next = 1 - active;
      oscs[next].setPeriodicWave(nextWave);
      crossfade(gains[active].gain, gains[next].gain, t, seconds);
      active = next;
    },
  };
}

/**
 * Drives a gate's gain from a looped one-period buffer. Two slots blend linearly when the period is
 * re-rendered (setGate), so the gate never pops; beat changes ramp playbackRate on whatever is loaded.
 */
function createGateDrive(ctx, cache, target) {
  const slots = [makeSlot(), makeSlot()];
  let active = 0;

  function makeSlot() {
    const mix = ctx.createGain();
    mix.gain.value = 0;
    mix.connect(target);
    return { mix, source: null, length: 0 };
  }

  function load(slot, hz, params, t) {
    if (slot.source) {
      slot.source.stop(t);
      slot.source.disconnect();
    }
    const buffer = cache.gateBuffer(hz, params);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.playbackRate.value = gatePlaybackRate(buffer.length, hz, ctx.sampleRate);
    source.connect(slot.mix);
    source.start(t);
    slot.source = source;
    slot.length = buffer.length;
  }

  const live = () => slots.filter((slot) => slot.source !== null);
  const rateFor = (slot, hz) => gatePlaybackRate(slot.length, hz, ctx.sampleRate);

  return {
    start(hz, params, t) {
      load(slots[active], hz, params, t);
      slots[active].mix.gain.value = 1;
    },
    setBeat(hz, t) {
      for (const slot of live()) glideTo(slot.source.playbackRate, rateFor(slot, hz), t, GATE_RATE_TAU, 'target');
    },
    glide(fromHz, toHz, t, after, seconds) {
      for (const slot of live()) {
        const rate = slot.source.playbackRate;
        holdParam(rate, t);
        rate.setValueAtTime(rate.value, t);
        if (after > 0) rate.linearRampToValueAtTime(rateFor(slot, fromHz), t + after);
        else rate.setValueAtTime(rateFor(slot, fromHz), t);
        rate.linearRampToValueAtTime(rateFor(slot, toHz), t + after + seconds);
      }
    },
    swap(hz, params, t) {
      const next = 1 - active;
      load(slots[next], hz, params, t);
      fade(slots[active].mix.gain, slots[active].mix.gain.value, 0, t, GATE_SWAP_SECONDS, 'linear');
      fade(slots[next].mix.gain, 0, 1, t, GATE_SWAP_SECONDS, 'linear');
      slots[active].source.stop(t + GATE_SWAP_SECONDS + LEAD);
      active = next;
    },
    stop(t) {
      for (const slot of live()) {
        slot.source.stop(t);
        slot.source.disconnect();
        slot.source = null;
      }
    },
  };
}
