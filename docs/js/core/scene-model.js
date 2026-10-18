// Canvas scene maths: quality tiers, wave bands, rain particles and stars (§7.6). Plain data; no canvas calls.
import { randRange } from './rng.js';

/** Horizontal drift shared by every wave band, px/s. */
export const DRIFT_PX_PER_S = 8;

/** Rendering tiers: what each one draws and at what cost (glints: live glitter-path slots, core/shimmer.js). */
export const QUALITY_TIERS = Object.freeze({
  high: Object.freeze({ tier: 'high', dprCap: 2, fps: 60, maxDrops: 220, stars: true, ripples: true, blur: true, glints: 14 }),
  medium: Object.freeze({ tier: 'medium', dprCap: 1.5, fps: 30, maxDrops: 160, stars: true, ripples: true, blur: false, glints: 6 }),
  low: Object.freeze({ tier: 'low', dprCap: 1, fps: 24, maxDrops: 80, stars: false, ripples: false, blur: false, glints: 0 }),
  off: Object.freeze({ tier: 'off', dprCap: 1, fps: 10, maxDrops: 0, stars: false, ripples: false, blur: false, glints: 0 }),
});

function atMost(value, limit) {
  return Number.isFinite(value) && value <= limit;
}

/** Pick a tier from device hints and settings → { tier, dprCap, fps, maxDrops, stars, ripples, blur, glints }. */
export function pickQuality({ width, deviceMemory, hardwareConcurrency, coarse, saveData, motion, scene }) {
  if (scene === 'off' || motion === 'still') return { ...QUALITY_TIERS.off };
  if (atMost(deviceMemory, 2) || atMost(hardwareConcurrency, 2) || Boolean(saveData)) return { ...QUALITY_TIERS.low };
  if (!coarse && width >= 1024) return { ...QUALITY_TIERS.high };
  return { ...QUALITY_TIERS.medium };
}

// Four wave bands: baseline (fraction of h), amplitude (px at reference height), components [λ px, ω rad/s, weight].
// Weights fall with spatial frequency; the last term of bands 1–3 is the fine ripple. Every |ω| ≤ 0.3 rad/s.
const WAVE_BAND_SPECS = [
  { base: 0.6, amp: 4, components: [[220, 0.18, 1], [130, -0.11, 0.5]] },
  { base: 0.72, amp: 7, components: [[300, 0.14, 1], [170, -0.09, 0.45], [90, 0.21, 0.2], [46, 0.24, 0.07]] },
  { base: 0.84, amp: 11, components: [[420, 0.11, 1], [230, -0.08, 0.5], [120, 0.17, 0.25], [62, -0.21, 0.09]] },
  { base: 0.95, amp: 16, components: [[560, 0.09, 1], [310, -0.07, 0.5], [150, 0.13, 0.25], [84, 0.23, 0.1]] },
];
const REFERENCE_HEIGHT = 409;
const MAX_AMP_SCALE = 1.6;

/** Amplitude scale for a stage of height h: min(1.6, h / 409). */
export function waveAmpScale(h) {
  return Math.min(MAX_AMP_SCALE, h / REFERENCE_HEIGHT);
}

/** Wave bands for a w×h stage → [{ base, amp, components: [{ lambda, omega, weight }] }]; geometry depends on h only. */
export function makeWaveBands(w, h) {
  const scale = waveAmpScale(h);
  return WAVE_BAND_SPECS.map((spec) => ({
    base: spec.base * h,
    amp: spec.amp * scale,
    components: spec.components.map(([lambda, omega, weight]) => ({ lambda, omega, weight })),
  }));
}

/** Phase (rad) of component i of a band at x px and tS seconds: 2π·x/λ + ω·t + 2π·drift·t/λ. */
export function wavePhase(band, x, tS, i = 0) {
  const { lambda, omega } = band.components[i];
  return (2 * Math.PI * (x + DRIFT_PX_PER_S * tS)) / lambda + omega * tS;
}

/** Vertical offset (px) of a band at x, tS: amp·ampScale·Σ weight·sin(phase) / Σ weight. */
export function waveHeight(band, x, tS, ampScale = 1) {
  let sum = 0;
  let total = 0;
  band.components.forEach((c, i) => {
    sum += c.weight * Math.sin(wavePhase(band, x, tS, i));
    total += c.weight;
  });
  return band.amp * ampScale * (sum / total);
}

const DROP_LEN_PX = [10, 24];
const DROP_SPEED_PX_S = [380, 620];
const DROP_ALPHA = [0.12, 0.3];
const SLANT_RAD = (6 * Math.PI) / 180;
const RESPAWN_ABOVE = 0.5; // recycled drops start up to this fraction of h above the top edge
const RIPPLE_LIFE_S = 0.6;
const RIPPLES_PER_S = 4;
const RIPPLES_MAX_LIVE = 12;

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

/** Rain streak pool: step(dtS, density, waterline) moves round(density·maxDrops) drops and spawns capped ripples. */
export function createRainParticles({ rng, w, h, maxDrops }) {
  const slantPad = h * Math.tan(SLANT_RAD);
  const pool = [];
  const drops = [];
  const ripples = [];
  const spawnTimes = [];
  let clock = 0;

  const respawn = (d) => {
    d.len = randRange(rng, DROP_LEN_PX[0], DROP_LEN_PX[1]);
    d.speed = randRange(rng, DROP_SPEED_PX_S[0], DROP_SPEED_PX_S[1]);
    d.alpha = randRange(rng, DROP_ALPHA[0], DROP_ALPHA[1]);
    d.vx = d.speed * Math.sin(SLANT_RAD);
    d.vy = d.speed * Math.cos(SLANT_RAD);
    d.x = randRange(rng, -slantPad, w);
    d.y = -d.len - rng() * RESPAWN_ABOVE * h;
    return d;
  };
  const freshDrop = () => {
    const d = respawn({});
    d.y = randRange(rng, -RESPAWN_ABOVE * h, h); // first frame: already spread over the stage
    return d;
  };
  const setActive = (count) => {
    while (drops.length > count) pool.push(drops.pop());
    while (drops.length < count) drops.push(pool.length ? respawn(pool.pop()) : freshDrop());
  };
  const ageRipples = (dtS) => {
    let keep = 0;
    for (const r of ripples) {
      r.age += dtS;
      if (r.age < r.life) ripples[keep++] = r;
    }
    ripples.length = keep;
  };
  const maybeSpawnRipple = (x, y) => {
    if (ripples.length >= RIPPLES_MAX_LIVE) return;
    while (spawnTimes.length && spawnTimes[0] <= clock - 1) spawnTimes.shift();
    if (spawnTimes.length >= RIPPLES_PER_S) return;
    spawnTimes.push(clock);
    ripples.push({ x, y, age: 0, life: RIPPLE_LIFE_S });
  };

  function step(dtS, density, waterline) {
    clock += dtS;
    setActive(Math.round(clamp01(density) * maxDrops));
    ageRipples(dtS);
    for (const d of drops) {
      d.x += d.vx * dtS;
      d.y += d.vy * dtS;
      const yWater = waterline(d.x);
      if (d.y >= yWater) {
        maybeSpawnRipple(d.x, yWater);
        respawn(d);
      }
    }
  }

  return { step, drops, ripples };
}

const STAR_SKY_FRACTION = 0.45;
const STAR_RADIUS_PX = [0.6, 1.6];
const STAR_PERIOD_S = [10, 18];
const STAR_BASE_ALPHA = [0.25, 0.85];

/** Stars in the upper sky → [{ x, y, r, period (10–18 s), phase, base (0.25–0.85) }]. */
export function makeStars(rng, w, h, count) {
  return Array.from({ length: count }, () => ({
    x: randRange(rng, 0, w),
    y: randRange(rng, 0, STAR_SKY_FRACTION * h),
    r: randRange(rng, STAR_RADIUS_PX[0], STAR_RADIUS_PX[1]),
    period: randRange(rng, STAR_PERIOD_S[0], STAR_PERIOD_S[1]),
    phase: randRange(rng, 0, 2 * Math.PI),
    base: randRange(rng, STAR_BASE_ALPHA[0], STAR_BASE_ALPHA[1]),
  }));
}

/** Twinkle alpha at tS: base·(0.55 + 0.45·sin(2π·t/period + phase)), clamped to [0.25·base, base]. */
export function starAlpha(star, tS) {
  const raw = star.base * (0.55 + 0.45 * Math.sin((2 * Math.PI * tS) / star.period + star.phase));
  return Math.min(star.base, Math.max(0.25 * star.base, raw));
}
