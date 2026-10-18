// Buffer cache (§5, §6.4 of the plan; v0.4 spec §0 D3): noise loops and the drop kit are generated as
// Float32Arrays at a fixed PREWARM_RATE into a store shared by every cache, so prewarmLoops() can fill
// it before any AudioContext exists and a rebuilt graph never generates them twice; a cache builds
// AudioBuffers at that rate (the context resamples on playback). Gate periods stay per context, at its
// rate. Generation yields to the event loop between channels (the prewarm also between kit variants),
// never inside one: the pink and brown filters keep state only within one noiseLoop call. Each bed's
// `trim` brings its RMS to BED_RMS_DB, the level budget's assumption.

import { noiseLoop, rms } from '../core/noise.js';
import { dbToGain, gainToDb } from '../core/levels.js';
import { renderDropKit, renderDropVariant, kitVariantKind, KIT_VARIANTS } from '../core/rain-model.js';
import { renderGatePeriod } from '../core/gate.js';
import { mulberry32 } from '../core/rng.js';

/** Length of every noise loop, seconds. */
export const LOOP_SECONDS = 6;

/** RMS every bed is trimmed to at 0 dB layer gain, dBFS (the level budget's assumption). */
export const BED_RMS_DB = -11;

/** Sample rate every noise loop and drop is generated at, whatever the context runs at. */
export const PREWARM_RATE = 48000;

/** Seed of the drop kit; the beds carry theirs in BEDS. */
const KIT_SEED = 2401;

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

/** Shared by every cache, by loop key and 'kit': a promise of finished data, or of the prewarm's job in flight. */
const shared = new Map();
let prewarming = null;

const loopKey = (kind, seeds, prefilter) => `${kind}|${seeds.join(',')}|${prefilter ? `${prefilter.type}:${prefilter.fc}:${prefilter.Q}` : ''}`;
const pauseWith = (setTimer) => () => new Promise((resolve) => setTimer(resolve, 0));
const defaultSetTimer = (fn, ms) => setTimeout(fn, ms);
const keep = (key) => (data) => {
  shared.set(key, Promise.resolve(data));
  return data;
};

async function generateLoop(kind, seeds, prefilter, pause) {
  const channels = [];
  let sumSquares = 0;
  for (const seed of seeds) {
    if (channels.length > 0) await pause();
    const data = noiseLoop(kind, LOOP_SECONDS, PREWARM_RATE, seed, prefilter ? { prefilter } : {});
    const level = rms(data);
    sumSquares += level * level;
    channels.push(data);
  }
  const loopRms = Math.sqrt(sumSquares / seeds.length);
  return { channels, trim: loopRms > 0 ? dbToGain(BED_RMS_DB - gainToDb(loopRms)) : 1 };
}

/** The kit one variant per macrotask: the variants renderDropKit makes in one go. */
async function generateKitSlowly(pause) {
  const rng = mulberry32(KIT_SEED);
  const kit = [];
  for (let i = 0; i < KIT_VARIANTS; i++) {
    await pause();
    kit.push(renderDropVariant(PREWARM_RATE, rng, kitVariantKind(i)).channels);
  }
  return kit;
}

async function prewarm(pause) {
  const jobs = Object.values(BEDS).map(({ kind, seeds, prefilter }) => [loopKey(kind, seeds, prefilter), () => generateLoop(kind, seeds, prefilter, pause)]);
  for (const [key, generate] of [...jobs, ['kit', () => generateKitSlowly(pause)]]) {
    if (shared.has(key)) continue;
    await pause();
    const job = generate();
    shared.set(key, job);
    await job;
  }
}

/** Generates every bed and the drop kit without an AudioContext, one channel or kit variant per macrotask; idempotent, resolves once all are stored. */
export function prewarmLoops({ setTimer = defaultSetTimer } = {}) {
  if (!prewarming) prewarming = prewarm(pauseWith(setTimer));
  return prewarming;
}

/**
 * Creates the cache for one context: { noiseLoop(kind, seed, prefilter?) → Promise<{ buffer, trim }>, bed(name),
 * dropKit() → Promise<AudioBuffer[]>, gateBuffer(hz, params) → AudioBuffer, warm(layers), dispose() }.
 * `seed` may be one number (mono) or an array of seeds (one per channel).
 */
export function createBufferCache(ctx, { setTimer = defaultSetTimer } = {}) {
  const loops = new Map();
  const gates = new Map();
  const pause = pauseWith(setTimer);
  let kit = null;
  let queue = Promise.resolve();

  /** Runs `job` after the jobs before it, each in its own macrotask. */
  function enqueue(job) {
    const run = queue.then(pause).then(job);
    queue = run.catch(() => {});
    return run;
  }

  function toBuffer(channels) {
    const buffer = ctx.createBuffer(channels.length, channels[0].length, PREWARM_RATE);
    channels.forEach((data, i) => buffer.copyToChannel(data, i));
    return buffer;
  }

  function loop(kind, seed, prefilter) {
    const seeds = Array.isArray(seed) ? seed : [seed];
    const key = loopKey(kind, seeds, prefilter);
    if (!loops.has(key)) {
      const data = () => shared.get(key) ?? generateLoop(kind, seeds, prefilter, pause).then(keep(key));
      loops.set(key, enqueue(data).then(({ channels, trim }) => ({ buffer: toBuffer(channels), trim })));
    }
    return loops.get(key);
  }

  function bed(name) {
    const recipe = BEDS[name];
    if (!recipe) throw new RangeError(`buffers: unknown bed "${name}"`);
    return loop(recipe.kind, recipe.seeds, recipe.prefilter);
  }

  function dropKit() {
    if (kit) return kit;
    const data = () => shared.get('kit') ?? Promise.resolve(renderDropKit(PREWARM_RATE, mulberry32(KIT_SEED)).map((v) => v.channels)).then(keep('kit'));
    kit = enqueue(data).then((variants) => variants.map(toBuffer));
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

  /** Starts getting everything the named layers ('rain' | 'ocean' | 'purr') need; resolves when all of it is ready. */
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
