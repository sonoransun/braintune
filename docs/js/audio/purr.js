// Purr layer (§6.4 of the plan): a brown loop through a low-pass and a 26 Hz raised-cosine gate,
// plus a pulse-spectrum oscillator at −10 dB, shaped by the breath planner (inhale / exhale /
// pause). The pet cue taps the voice before the breath envelope through a dedicated gain that
// goes to `cueBus` (the master), so it bypasses the purr slider but not the volume.
// Loop sources start once and keep running silently behind `out` between start/stop.

import { dbToGain, gainToDb } from '../core/levels.js';
import { rms } from '../core/noise.js';
import { pulseCoefficients } from '../core/timbres.js';
import { renderGatePeriod, gatePlaybackRate } from '../core/gate.js';
import { purrParams, planBreath, cueEnvelope, PURR_HZ } from '../core/purr-model.js';
import { holdParam, fade, applyEvents } from './automation.js';
import { BED_RMS_DB } from './buffers.js';

const LEAD = 0.01;
const FADE_IN_SECONDS = 1.5;
const FADE_OUT_SECONDS = 0.5;
const LP_Q = 1;
/** Energy a 300 Hz low-pass (Q 1) takes from the brown loop, dB; a documented estimate used only for the level calibration. */
const LP_LOSS_DB = -1.5;
const WAVE_SAMPLES = 2048;

/** Creates the purr layer into `bus` with the cue tap into `cueBus`: { start() → Promise<boolean>, stop({ seconds }), cue({ seconds }) → Promise<boolean>, dispose(), ready }. */
export function createPurrLayer(ctx, bus, scheduler, cache, { rng, cueBus } = {}) {
  const now = () => ctx.currentTime + LEAD;
  const params = purrParams();
  const gateData = renderGatePeriod(ctx.sampleRate, params.hz, params);
  const gateBuffer = cache.gateBuffer(params.hz, params);
  const baseRate = gatePlaybackRate(gateBuffer.length, params.hz, ctx.sampleRate);
  let bed = null;
  let sources = null;
  let running = false;
  let nextStart = 0;

  const gain = (value, destination) => {
    const g = ctx.createGain();
    g.gain.value = value;
    if (destination) g.connect(destination);
    return g;
  };

  const out = gain(0, bus);
  const breathGain = gain(0, out);
  const sum = gain(1, breathGain);
  const cueGain = gain(0, cueBus);
  sum.connect(cueGain);
  const voice = gain(0, sum);
  const gate = gain(0, voice);
  const purrLP = ctx.createBiquadFilter();
  purrLP.type = 'lowpass';
  purrLP.frequency.value = params.lpHz;
  purrLP.Q.value = LP_Q;
  purrLP.connect(gate);
  const oscGain = gain(dbToGain(params.busDb + params.oscDb) / periodicWaveRms(pulseCoefficients().imag), sum);
  const osc = ctx.createOscillator();
  osc.frequency.value = PURR_HZ;
  const { real, imag } = pulseCoefficients();
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
  osc.connect(oscGain);

  const ready = cache.bed('brownMono').then((loop) => {
    bed = loop;
    voice.gain.value = loop.trim * dbToGain(params.busDb - (BED_RMS_DB + LP_LOSS_DB + gainToDb(rms(gateData))));
  });

  function ensureSources() {
    if (sources) return;
    const t = ctx.currentTime;
    const noise = ctx.createBufferSource();
    noise.buffer = bed.buffer;
    noise.loop = true;
    noise.connect(purrLP);
    const gateSource = ctx.createBufferSource();
    gateSource.buffer = gateBuffer;
    gateSource.loop = true;
    gateSource.playbackRate.value = baseRate;
    gateSource.connect(gate.gain);
    noise.start(t);
    gateSource.start(t);
    osc.start(t);
    sources = { noise, gateSource };
  }

  const paramMap = () => ({
    breath: breathGain.gain,
    gateRate: sources.gateSource.playbackRate,
    oscHz: osc.frequency,
    lp: purrLP.frequency,
  });

  /** Expands the model's 'rate' events (× PURR_HZ) onto the gate's playbackRate and the oscillator's frequency. */
  function expand(events) {
    return events.flatMap((e) =>
      e.param === 'rate'
        ? [{ ...e, param: 'gateRate', value: e.value * baseRate }, { ...e, param: 'oscHz', value: e.value * PURR_HZ }]
        : [e],
    );
  }

  const planner = {
    plannedUpTo: 0,
    plan(from, to) {
      const items = [];
      let t0 = Math.max(nextStart, from);
      while (t0 < to) {
        const breath = planBreath(rng, t0, params);
        items.push({ at: t0, events: breath.events });
        t0 = breath.nextStart;
      }
      nextStart = t0;
      planner.plannedUpTo = t0;
      return items;
    },
    apply(item) {
      applyEvents(paramMap(), expand(item.events));
    },
    reset() {
      nextStart = 0;
    },
  };

  /** Starts (once the loop exists) with breathing and fades in over 1.5 s; resolves true when this call started it. */
  function start() {
    if (running) return ready.then(() => false);
    running = true;
    return ready.then(() => {
      if (!running) return false;
      ensureSources();
      nextStart = 0;
      planner.plannedUpTo = 0;
      scheduler.add(planner);
      fade(out.gain, out.gain.value, 1, now(), FADE_IN_SECONDS, 'scurve');
      return true;
    });
  }

  /** Fades out over `seconds` and stops breathing; the sources keep running silently for the cue. */
  function stop({ seconds = FADE_OUT_SECONDS } = {}) {
    running = false;
    scheduler.remove(planner);
    fade(out.gain, out.gain.value, 0, now(), seconds, 'equalPowerOut');
  }

  /** The pet cue: 0 → 0.25 → 0 over `seconds` on the cue tap; only while the context runs. Resolves true when it played. */
  function cue({ seconds = 2.2 } = {}) {
    return ready.then(() => {
      if (ctx.state !== 'running') return false;
      ensureSources();
      const t = now();
      const { events } = cueEnvelope(t, seconds);
      holdParam(cueGain.gain, t);
      applyEvents({ cue: cueGain.gain }, [{ ...events[0], value: cueGain.gain.value }, ...events.slice(1)]);
      return true;
    });
  }

  /** Stops every source and leaves the buses. */
  function dispose() {
    running = false;
    scheduler.remove(planner);
    if (sources) {
      const t = ctx.currentTime;
      sources.noise.stop(t);
      sources.gateSource.stop(t);
      osc.stop(t);
      sources = null;
    }
    out.disconnect();
    cueGain.disconnect();
  }

  return { start, stop, cue, dispose, ready, get running() { return running; } };
}

/** RMS of one period of sum(imag[k]·sin(2πkx)) after scaling its peak to 1, as Web Audio normalises a PeriodicWave. */
function periodicWaveRms(imag) {
  let peak = 0;
  let sumSquares = 0;
  for (let i = 0; i < WAVE_SAMPLES; i++) {
    let v = 0;
    for (let k = 1; k < imag.length; k++) v += imag[k] * Math.sin((2 * Math.PI * k * i) / WAVE_SAMPLES);
    peak = Math.max(peak, Math.abs(v));
    sumSquares += v * v;
  }
  return Math.sqrt(sumSquares / WAVE_SAMPLES) / peak;
}
