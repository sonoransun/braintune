// The session texture (v0.4 spec §3.4): one seed per audio graph gives each slow control its 1/f
// curve (pad breath and filter, rain gusts, surf sway, wave sets, purr drift), read on jittered
// knots 3.9–8.1 s apart. Every map is ceiling-anchored: nominal is the loudest. Pure.

import { subSeed, createVoss, fbm, golden, mapDb, mapRange } from './fractal.js';

/** Params the tone-side texture planner drives. */
export const TEXTURE_PARAMS = Object.freeze(['padBus', 'padFilter']);

/** Knot spacing (s), depths (dB), fBm octaves and periods (s), time constants (s) and wave-set scales. */
export const TEXTURE_RECIPE = deepFreeze({
  ticks: { interval: 6, jitter: 0.35 },
  padBus: { dice: 10, depthDb: 3, tau: 2 },
  padFilter: { octaves: 3, period: 96, gain: 0.6, span: 1 / 6, tau: 1.5 },
  gust: { octaves: 4, period: 64, gain: 0.6, extreme: 0.77, rateSpan: 0.4, tau: 2 },
  surf: { octaves: 3, period: 90, gain: 0.6, depthDb: 3, tau: 2 },
  set: {
    period: 70, fbm: { octaves: 3, period: 240, gain: 0.6 }, weights: [0.7, 0.3],
    amp: [0.55, 1], periodScale: [1.15, 0.85], swellScale: [0.9, 1.1], washScale: [0.85, 1.15],
  },
  purr: { tempo: { octaves: 3, period: 150, gain: 0.6, range: [0.9, 1.2] }, amplitude: { octaves: 3, period: 90, gain: 0.6, depthDb: 2 } },
  snapshotEvery: 1,
});

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = ([a, b], t) => a + (b - a) * t;
const knotsOnly = (ticks) => ticks.map(({ n, t }) => ({ n, t }));

/** The texture of a seed: { seed, recipe, ticks(from, to) (tone knots), padBus, padFilter, gust, gustTicks, surf, surfTicks, set: { at(t) → E in [0, 1] }, purr: { at(t) → { tempo, amplitude } } }; generator i uses subSeed(seed, i). */
export function createTexture(seed, recipe = TEXTURE_RECIPE) {
  const seeds = Array.from({ length: 10 }, (_, i) => subSeed(seed, i));
  const curve = (i, options) => ({ at: (t) => fbm(seeds[i], t, options) });
  const knots = (i) => {
    const voss = createVoss({ seed: seeds[i], ...recipe.ticks });
    return (from, to) => knotsOnly(voss.ticks(from, to));
  };
  const padBus = createVoss({ seed: seeds[0], dice: recipe.padBus.dice, ...recipe.ticks });
  const { set, purr } = recipe;
  return {
    seed,
    recipe,
    ticks: (from, to) => knotsOnly(padBus.ticks(from, to)),
    padBus,
    padFilter: curve(1, recipe.padFilter),
    gust: curve(3, recipe.gust),
    gustTicks: knots(2),
    surf: curve(5, recipe.surf),
    surfTicks: knots(4),
    set: { at: (t) => clamp(0.5 + 0.5 * (set.weights[0] * golden(seeds[6], t, set.period) + set.weights[1] * fbm(seeds[7], t, set.fbm)), 0, 1) },
    purr: {
      at: (t) => ({
        tempo: mapRange(fbm(seeds[8], t, purr.tempo), ...purr.tempo.range),
        amplitude: mapDb(fbm(seeds[9], t, purr.amplitude), purr.amplitude.depthDb),
      }),
    },
  };
}

/** Tone-side events for the knots in [from, to): a padBus target nominal·mapDb(voss, 3 dB) (τ 2 s) and a padFilter target lpHz·(1 + fBm/6) (τ 1.5 s); `nominal` is { padBus, padFilterHz }. */
export function planTextureEvents(texture, nominal, from, to) {
  const { padBus, padFilter } = texture.recipe;
  return texture.ticks(from, to).flatMap(({ n, t }) => [
    { param: 'padBus', at: t, kind: 'target', value: nominal.padBus * mapDb(texture.padBus.tick(n).value, padBus.depthDb), timeConstant: padBus.tau },
    { param: 'padFilter', at: t, kind: 'target', value: nominal.padFilterHz * (1 + texture.padFilter.at(t) * padFilter.span), timeConstant: padFilter.tau },
  ]);
}

/** What the picture follows at t: { pad, gust, set }, each in [-1, 1]. */
export function textureSnapshot(texture, t) {
  return { pad: texture.padBus.at(t), gust: texture.gust.at(t), set: 2 * texture.set.at(t) - 1 };
}

/** Rain gust for a gust value x: k = clamp(x / 0.77, -1, 1) → { gainDb: spanDb·k, rateScale: 1 + 0.4·k }. */
export function gustAt(x, spanDb, recipe = TEXTURE_RECIPE.gust) {
  const k = clamp(x / recipe.extreme, -1, 1);
  return { gainDb: spanDb * k, rateScale: 1 + recipe.rateSpan * k };
}

/** Wave-set scales at set energy E in [0, 1]: { ampDb −5.19…0, period 1.15…0.85, swell 0.9…1.1, wash 0.85…1.15 }. */
export function setScales(E, recipe = TEXTURE_RECIPE.set) {
  const e = clamp(E, 0, 1);
  return { ampDb: 20 * Math.log10(lerp(recipe.amp, e)), period: lerp(recipe.periodScale, e), swell: lerp(recipe.swellScale, e), wash: lerp(recipe.washScale, e) };
}

/** Fastest raw update rate of each knot stream, 1 / (interval·(1 − jitter)) Hz: 0.256. */
export function textureBandwidthHz(recipe = TEXTURE_RECIPE) {
  const hz = 1 / (recipe.ticks.interval * (1 - recipe.ticks.jitter));
  return { padBus: hz, padFilter: hz, gust: hz, surf: hz };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const inner of Object.values(value)) deepFreeze(inner);
  }
  return value;
}
