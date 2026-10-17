// The fixed part of the audio graph (§6.1 of the plan): context creation, the master chain
// master → limiter → ceiling → analyser → destination with the post-master chime input,
// and the four layer buses that feed the master.

import { LIMITER, ceilingGain } from '../core/levels.js';

/** Analyser window used by meters; small, since nothing visual reads it. */
const ANALYSER_FFT_SIZE = 256;

/** A new AudioContext tuned for playback latency; call inside a user gesture. */
export function createContext() {
  return new AudioContext({ latencyHint: 'playback' });
}

/** Builds master(0) → limiter(LIMITER) → ceiling(ceilingGain()) → analyser(256) → destination, plus chimeIn → limiter so the chime survives the end fade. */
export function buildMaster(ctx) {
  const master = ctx.createGain();
  master.gain.value = 0;
  const limiter = ctx.createDynamicsCompressor();
  for (const [name, value] of Object.entries(LIMITER)) limiter[name].value = value;
  const ceiling = ctx.createGain();
  ceiling.gain.value = ceilingGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = ANALYSER_FFT_SIZE;
  const chimeIn = ctx.createGain();
  chimeIn.gain.value = 1;
  master.connect(limiter);
  limiter.connect(ceiling);
  ceiling.connect(analyser);
  analyser.connect(ctx.destination);
  chimeIn.connect(limiter);
  return { master, limiter, ceiling, analyser, chimeIn };
}

/** Four silent layer buses { tone, rain, ocean, purr } feeding the master; the engine sets each to layerGain(slider) or 0 when muted. */
export function buildBuses(ctx, master) {
  const bus = () => {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(master);
    return gain;
  };
  return { tone: bus(), rain: bus(), ocean: bus(), purr: bus() };
}
