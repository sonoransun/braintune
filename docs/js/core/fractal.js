// Random-access 1/f generators (v0.4 spec §3.3): every value is a pure function of (seed, t), so a
// delayed copy, a resume or a re-plan costs nothing and nothing is stored. Voss–McCartney dice give
// 1/f steps (Voss & Clarke 1975), value-noise octaves give fBm, three golden-ratio sines never
// repeat. Pure: no browser globals.

const PHI = (1 + Math.sqrt(5)) / 2;
const TWO_32 = 2 ** 32;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smoothstep = (x) => x * x * (3 - 2 * x);
const bipolar = (u) => 2 * u - 1;

/** MurmurHash3's fmix32 finaliser. */
function fmix32(h) {
  const a = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  const b = Math.imul(a ^ (a >>> 13), 0xc2b2ae35);
  return (b ^ (b >>> 16)) >>> 0;
}

/** Uniform in [0, 1) from a seed and up to three integer coordinates. */
export function hash01(seed, a = 0, b = 0, c = 0) {
  let h = fmix32((seed ^ 0x9e3779b9) >>> 0);
  h = fmix32((h + Math.imul(a | 0, 0x85ebca6b)) >>> 0);
  h = fmix32((h ^ Math.imul(b | 0, 0xc2b2ae35)) >>> 0);
  h = fmix32((h + Math.imul(c | 0, 0x27d4eb2f)) >>> 0);
  return h / TWO_32;
}

/** A 32-bit seed for generator `index` of `seed`. */
export function subSeed(seed, index) {
  return Math.floor(hash01(seed, 0x5eed, index) * TWO_32) >>> 0;
}

/** Voss–McCartney 1/f value at step n in [-1, 1]: die k is redrawn at steps 2^k mod 2^(k+1), one die per step (|Δ| ≤ 2/√(3·dice)); ±1 is ±3σ, clamped. */
export function vossStep(seed, n, dice = 10) {
  let sum = 0;
  for (let k = 0; k < dice; k++) sum += bipolar(hash01(seed, k, Math.floor((n + 2 ** k) / 2 ** (k + 1))));
  return clamp(sum / Math.sqrt(3 * dice), -1, 1);
}

/** Time of knot n: interval·(n + jitter·(u − 0.5)), increasing while jitter < 1. */
export function vossTickTime(seed, n, interval, jitter) {
  return interval * (n + jitter * (hash01(seed, 0x7e5, n) - 0.5));
}

/** A 1/f curve on jittered knots: { at(t) (smoothstep between knots), step(t) (last knot at or before t), tick(n) → { n, t, value }, ticks(from, to), slowestPeriod, fastestInterval }. */
export function createVoss({ seed, dice = 10, interval = 6, jitter = 0.35 }) {
  const timeOf = (n) => vossTickTime(seed, n, interval, jitter);
  const tick = (n) => ({ n, t: timeOf(n), value: vossStep(seed, n, dice) });

  function step(t) {
    const n = Math.floor(t / interval);
    if (timeOf(n) > t) return n - 1;
    return timeOf(n + 1) <= t ? n + 1 : n;
  }

  function at(t) {
    const n = step(t);
    const t0 = timeOf(n);
    const v0 = vossStep(seed, n, dice);
    return v0 + (vossStep(seed, n + 1, dice) - v0) * smoothstep((t - t0) / (timeOf(n + 1) - t0));
  }

  function ticks(from, to) {
    const out = [];
    let n = step(from);
    if (timeOf(n) < from) n += 1;
    for (; timeOf(n) < to; n++) out.push(tick(n));
    return out;
  }

  return { at, step, tick, ticks, slowestPeriod: interval * 2 ** dice, fastestInterval: interval * (1 - jitter) };
}

/** One value-noise octave at s: hashed lattice values in [-1, 1] joined by smoothstep. */
export function valueNoise(seed, octave, s) {
  const i = Math.floor(s);
  const a = bipolar(hash01(seed, octave, i));
  return a + (bipolar(hash01(seed, octave, i + 1)) - a) * smoothstep(s - i);
}

/** fBm in [-1, 1]: Σ gain^o · noise_o(t·lacunarity^o / period) / Σ gain^o, lattices offset by o·φ so their knots never align. */
export function fbm(seed, t, { octaves = 3, period = 96, lacunarity = 2, gain = 0.6 } = {}) {
  let sum = 0;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += gain ** o * valueNoise(seed, o, (t * lacunarity ** o) / period + o * PHI);
    norm += gain ** o;
  }
  return sum / norm;
}

/** Three sines of periods T, Tφ and Tφ² weighted 1, 1/φ and 1/φ², phases from the seed, in [-1, 1]; never repeats. */
export function golden(seed, t, period = 70) {
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < 3; i++) {
    sum += PHI ** -i * Math.sin((2 * Math.PI * t) / (period * PHI ** i) + 2 * Math.PI * hash01(seed, 0x901d, i));
    norm += PHI ** -i;
  }
  return sum / norm;
}

/** Ceiling-anchored gain 10^(depthDb·(x − 1)/40): 1 at x = 1, 10^(−depthDb/20) at x = −1. */
export function mapDb(x, depthDb) {
  return 10 ** ((depthDb * (clamp(x, -1, 1) - 1)) / 40);
}

/** x in [-1, 1] mapped onto [lo, hi]. */
export function mapRange(x, lo, hi) {
  return lo + ((hi - lo) * (x + 1)) / 2;
}
