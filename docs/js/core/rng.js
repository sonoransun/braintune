// Seeded random helpers. Pure: no globals, no Math.random.

/**
 * mulberry32 PRNG. Returns a function yielding floats in [0, 1).
 * @param {number} seed any integer
 * @returns {() => number}
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform float in [a, b). */
export function randRange(rng, a, b) {
  return a + (b - a) * rng();
}

/** Log-uniform float in [a, b) (a, b > 0). */
export function logUniform(rng, a, b) {
  return Math.exp(randRange(rng, Math.log(a), Math.log(b)));
}

/** Exponentially distributed inter-arrival time with rate lambda (events per unit time). */
export function expInterval(rng, lambda) {
  return -Math.log(1 - rng()) / lambda;
}

/**
 * Pick a key from {key: weight} using a uniform draw r in [0, 1].
 * Zero or negative weights are skipped; r = 0 yields the first positive key, r -> 1 the last.
 * @param {Record<string, number>} weights
 * @param {number} r
 * @returns {string | undefined}
 */
export function pickWeighted(weights, r) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  if (entries.length === 0) return undefined;
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [key, w] of entries) {
    acc += w;
    if (r < acc / total) return key;
  }
  return entries[entries.length - 1][0];
}
