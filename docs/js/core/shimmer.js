// The 1/f glitter path under the moon or sun (v0.4 §V7): one-shot horizontal glints with raised-cosine envelopes of
// 1.6–3.4 s, at most three born in any second, at a rate paced by a Voss octave sum so they never settle into a rhythm.
// The path widens toward the viewer and with the sea (Cox & Munk 1954 geometry). The scene draws `sparkles`.
import { mixOklab } from './palette.js';
import { logUniform, mulberry32 } from './rng.js';

function deepFreeze(value) {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Glitter tables: slots and rate scale per tier, births/s per band (× pace[0] + pace[1]·pacer), envelopes and sizes. */
export const SHIMMER = deepFreeze({
  slots: { high: 14, medium: 6, low: 0, off: 0 },
  tierRate: { high: 1, medium: 0.7, low: 0, off: 0 },
  birthsPerS: { delta: 0.7, theta: 1.0, alpha: 1.6, beta: 1.6, gamma: 2.0 },
  pace: [0.35, 1.3],
  maxBirthsPerS: 3,
  lifeS: [1.6, 3.4],
  peakAlpha: { dark: [0.12, 0.3], light: [0.1, 0.24] },
  pathWidth: [0.05, 0.22],
  widthBias: 1.3,
  streakLen: [5, 21],
  streakThick: [1.2, 2.6],
  depthBias: 1.4,
  pacer: { baseS: 1.25, octaves: 5 },
});

const SPREAD = [0.7, 0.6];
const REBUILD_S = 10;
const REBUILD_FPS = 30;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

/** Width factor of the glitter path and the pillar for a sea intensity 0–1: 0.7 + 0.6·sea. */
export function spreadScale(sea01) {
  return SPREAD[0] + SPREAD[1] * clamp01(sea01);
}

/** Glint colour: sea-far lifted toward foam, .60 dark … .55 light. */
export function glintColor({ seaFar, foam }, light01 = 0) {
  return mixOklab(seaFar, foam, lerp(0.6, 0.55, clamp01(light01)));
}

/** Births per second for a band and tier at pacer value m ∈ [0, 1): table × tier scale × (0.35 + 1.3·m). */
export function birthRate({ band, tier, m }) {
  return (SHIMMER.birthsPerS[band] ?? 0) * (SHIMMER.tierRate[tier] ?? 0) * (SHIMMER.pace[0] + SHIMMER.pace[1] * m);
}

/** Voss octave-sum pacer → { value(tS) } in [0, 1): octave k holds one draw for baseS·2^k s, at a random phase. */
export function createPinkPacer({ rng, baseS = SHIMMER.pacer.baseS, octaves = SHIMMER.pacer.octaves }) {
  const phase = Array.from({ length: octaves }, () => rng());
  const index = new Array(octaves).fill(NaN);
  const held = new Array(octaves).fill(0);
  return {
    value(tS) {
      let sum = 0;
      for (let k = 0; k < octaves; k += 1) {
        const n = Math.floor(tS / (baseS * 2 ** k) + phase[k]);
        if (n !== index[k]) {
          index[k] = n;
          held[k] = rng();
        }
        sum += held[k];
      }
      return sum / octaves;
    },
  };
}

/** Raised-cosine envelope of a sparkle: 0 at birth and at the end of its life, its peak halfway. */
export function sparkleAlpha({ age, life, peak }) {
  return age > 0 && age < life ? peak * (0.5 - 0.5 * Math.cos((2 * Math.PI * age) / life)) : 0;
}

/** Stage position at depth u (0 horizon … 1 near edge) and lateral s ∈ [−1, 1] → { x, y, halfWidth }. */
export function glitterLayout({ w, h, horizonY, lightX, u, s, spread01 }) {
  const halfWidth = (w * lerp(SHIMMER.pathWidth[0], SHIMMER.pathWidth[1], u ** SHIMMER.widthBias) * spreadScale(spread01)) / 2;
  return { x: lightX + s * halfWidth, y: horizonY + u * (h - horizonY), halfWidth };
}

/**
 * Glitter field for a tier name and band → { reset({ w, h, horizonY, lightX }), step(dtS, tS, { spread01, light01 }),
 * sparkles }. step() ages, births (Bernoulli per step at the paced rate, ≤ slots live, ≤ 3 in any second) and lays out.
 */
export function createSparkleField({ rng, tier, band }) {
  const slots = SHIMMER.slots[tier] ?? 0;
  const pacer = createPinkPacer({ rng });
  const sparkles = [];
  const births = [];
  let layout = { w: 0, h: 0, horizonY: 0, lightX: 0 };
  let clock = 0;

  function birth(light01) {
    const { dark, light } = SHIMMER.peakAlpha;
    sparkles.push({
      u: rng() ** SHIMMER.depthBias,
      s: 2 * rng() - 1,
      life: logUniform(rng, SHIMMER.lifeS[0], SHIMMER.lifeS[1]),
      peak: lerp(lerp(dark[0], light[0], light01), lerp(dark[1], light[1], light01), rng()),
      age: 0, x: 0, y: 0, len: 0, thick: 0, alpha: 0,
    });
    births.push(clock);
  }

  function step(dtS, tS, { spread01 = 0, light01 = 0 } = {}) {
    clock += dtS;
    let keep = 0;
    for (const sparkle of sparkles) {
      sparkle.age += dtS;
      if (sparkle.age < sparkle.life) sparkles[keep++] = sparkle;
    }
    sparkles.length = keep;
    while (births.length && births[0] <= clock - 1) births.shift();
    const due = slots > 0 && rng() < birthRate({ band, tier, m: pacer.value(tS) }) * dtS;
    if (due && sparkles.length < slots && births.length < SHIMMER.maxBirthsPerS) birth(clamp01(light01));
    for (const sparkle of sparkles) {
      Object.assign(sparkle, glitterLayout({ ...layout, u: sparkle.u, s: sparkle.s, spread01 }));
      sparkle.len = lerp(SHIMMER.streakLen[0], SHIMMER.streakLen[1], sparkle.u);
      sparkle.thick = lerp(SHIMMER.streakThick[0], SHIMMER.streakThick[1], sparkle.u);
      sparkle.alpha = sparkleAlpha(sparkle);
    }
  }

  return {
    reset({ w, h, horizonY, lightX }) {
      layout = { w, h, horizonY, lightX };
    },
    step,
    sparkles,
  };
}

/** Deterministic sparkles at scene time tS: a field rebuilt from tS − 10 s in 1/30 s steps, seeded by (seed, ⌊tS − 10⌋). */
export function sparklesAt(seed, { tier, band, layout, tS, spread01 = 0, light01 = 0 }) {
  const from = tS - REBUILD_S;
  const field = createSparkleField({ rng: mulberry32(seed ^ Math.imul(Math.floor(from), 0x9e3779b1)), tier, band });
  field.reset(layout);
  for (let i = 1; i <= REBUILD_S * REBUILD_FPS; i += 1) field.step(1 / REBUILD_FPS, from + i / REBUILD_FPS, { spread01, light01 });
  return field.sparkles;
}
