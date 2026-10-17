// Buffer cache: seeded noise loops, the drop kit and gate periods, generated lazily per sample
// rate and shared by the layers (§5, §6.4 of the plan). Pink and brown filters keep their state
// only within one noiseLoop call, so every loop is generated whole (≈ 10 ms at 48 kHz) and the
// cache yields to the event loop between loops, never inside one. Each bed's `trim` brings its
// RMS to BED_RMS_DB so the level budget holds whatever the generator's own RMS turned out to be.

import { noiseLoop, rms } from '../core/noise.js';
import { dbToGain, gainToDb } from '../core/levels.js';
import { renderDropKit, KIT_VARIANTS } from '../core/rain-model.js';
import { renderGatePeriod } from '../core/gate.js';

/** Length of every noise loop, seconds. */
export const LOOP_SECONDS = 6;

/** RMS every bed is trimmed to at 0 dB layer gain, dBFS (the level budget's assumption). */
export const BED_RMS_DB = -11;

/** Bed recipes by name: loop kind, one seed per channel and an optional prefilter. 'brownMono' serves the rain rumble and the purr. */
export const BEDS = Object.freeze({
  rainBed: Object.freeze({ kind: 'pink', seeds: Object.freeze([1101, 1102]), prefilter: Object.freeze({ type: 'bandpass', fc: 2200, Q: 0.45 }) }),
  brownMono: Object.freeze({ kind: 'brown', seeds: Object.freeze([1201]) }),
  oceanSurf: Object.freeze({ kind: 'brown', seeds: Object.freeze([1301, 1302]) }),
  oceanSwell: Object.freeze({ kind: 'pink', seeds: Object.freeze([1401]) }),
  oceanWhite: Object.freeze({ kind: 'white', seeds: Object.freeze([1501]) }),
});

/** Beds (and, for rain, the drop kit) each ambience layer needs. */
const LAYER_BEDS = Object.freeze({
  rain: ['rainBed', 'brownMono'],
  ocean: ['oceanSurf', 'oceanSwell', 'oceanWhite'],
  purr: ['brownMono'],
});

/**
 * Creates the cache for one context: { noiseLoop(kind, seed, prefilter?) → Promise<{ buffer, trim }>,
 * bed(name), dropKit() → Promise<AudioBuffer[]>, gateBuffer(hz, params) → AudioBuffer, warm(layers), dispose() }.
 * `seed` may be one number (mono) or an array of seeds (one per channel); keys include the sample rate.
 */
export function createBufferCache(ctx, { rng, setTimer = (fn, ms) => setTimeout(fn, ms) } = {}) {
  const loops = new Map();
  const gates = new Map();
  let kit = null;
  let queue = Promise.resolve();

  const yieldToEventLoop = () => new Promise((resolve) => setTimer(resolve, 0));

  /** Runs `job` after the jobs before it, each in its own macrotask. */
  function enqueue(job) {
    const run = queue.then(yieldToEventLoop).then(job);
    queue = run.catch(() => {});
    return run;
  }

  async function generateLoop(kind, seeds, prefilter) {
    const sampleRate = ctx.sampleRate;
    const buffer = ctx.createBuffer(seeds.length, Math.round(LOOP_SECONDS * sampleRate), sampleRate);
    let sumSquares = 0;
    for (let channel = 0; channel < seeds.length; channel++) {
      if (channel > 0) await yieldToEventLoop();
      const data = noiseLoop(kind, LOOP_SECONDS, sampleRate, seeds[channel], prefilter ? { prefilter } : {});
      const level = rms(data);
      sumSquares += level * level;
      buffer.copyToChannel(data, channel);
    }
    const loopRms = Math.sqrt(sumSquares / seeds.length);
    return { buffer, trim: loopRms > 0 ? dbToGain(BED_RMS_DB - gainToDb(loopRms)) : 1 };
  }

  function loop(kind, seed, prefilter) {
    const seeds = Array.isArray(seed) ? seed : [seed];
    const key = `${ctx.sampleRate}|${kind}|${seeds.join(',')}|${prefilter ? `${prefilter.type}:${prefilter.fc}:${prefilter.Q}` : ''}`;
    if (!loops.has(key)) loops.set(key, enqueue(() => generateLoop(kind, seeds, prefilter)));
    return loops.get(key);
  }

  function bed(name) {
    const recipe = BEDS[name];
    if (!recipe) throw new RangeError(`buffers: unknown bed "${name}"`);
    return loop(recipe.kind, recipe.seeds, recipe.prefilter);
  }

  function dropKit() {
    if (!kit) {
      kit = enqueue(() =>
        renderDropKit(ctx.sampleRate, rng, { variants: KIT_VARIANTS }).map(({ channels }) => {
          const buffer = ctx.createBuffer(channels.length, channels[0].length, ctx.sampleRate);
          channels.forEach((data, i) => buffer.copyToChannel(data, i));
          return buffer;
        }),
      );
    }
    return kit;
  }

  function gateBuffer(hz, params) {
    const key = `${ctx.sampleRate}|${hz}|${params.duty}|${params.ramp}|${params.depth}`;
    if (!gates.has(key)) {
      const data = renderGatePeriod(ctx.sampleRate, hz, params);
      const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
      buffer.copyToChannel(data, 0);
      gates.set(key, buffer);
    }
    return gates.get(key);
  }

  /** Starts generating everything the named layers ('rain' | 'ocean' | 'purr') need; resolves when all of it is ready. */
  function warm(layers) {
    const jobs = [];
    for (const layer of layers) {
      for (const name of LAYER_BEDS[layer] ?? []) jobs.push(bed(name));
      if (layer === 'rain') jobs.push(dropKit());
    }
    return Promise.all(jobs);
  }

  function dispose() {
    loops.clear();
    gates.clear();
    kit = null;
  }

  return { noiseLoop: loop, bed, dropKit, gateBuffer, warm, dispose };
}
