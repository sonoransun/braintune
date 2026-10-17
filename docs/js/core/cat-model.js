// Cat scheduling and placement (§7.8): arrival delays, mood, plans and ledge placement. Pure; RNG injected.
import { pickWeighted, randRange } from './rng.js';

function deepFreeze(value) {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

/** Timing, pose and coat tables for the cat scheduler (§5). */
export const CAT_CONFIG = deepFreeze({
  maxConcurrent: { narrow: 2, default: 3 },
  minTogether: 2, // a lone arrival brings a companion so two or more cats frolic at a time
  companionDelayMs: [1200, 3500],
  firstDelayMs: { playing: [4e3, 9e3], idle: [10e3, 20e3] },
  gapMs: { playing: [20e3, 60e3], idle: [40e3, 100e3] },
  dwellMs: { sit: [25e3, 60e3], loaf: [30e3, 70e3], sleep: [60e3, 180e3] },
  walkSpeedPxPerS: [28, 40],
  poseWeights: {
    sleepy: { sleep: 0.3, loaf: 0.2, sit: 0.1, walk: 0.4 },
    calm: { sit: 0.3, loaf: 0.25, walk: 0.45 },
    alert: { walk: 0.6, sit: 0.25, loaf: 0.15 },
    idle: { walk: 0.5, sit: 0.3, loaf: 0.2 },
    still: { sit: 0.5, loaf: 0.5 },
  },
  coatWeights: { black: 1, orangeTabby: 1, grey: 1, calico: 1 },
  afterPetExtraMs: 10e3,
  callCooldownMs: 20e3,
  blinkEveryMs: [4e3, 9e3],
  blinkEveryStillMs: [8e3, 14e3],
  catnapGapScale: 0.6,
});

const NARROW_BELOW_PX = 400;
const WALK_CROSSING_EXTRA_PX = 112; // off-screen start to off-screen end adds one cat width
const ENTER_MS = 600;
const EXIT_MS = 500;
const SLEEPY_PRESETS = new Set(['sleep', 'rest', 'catnap']);
const ALERT_PRESETS = new Set(['focus', 'energise', 'clarity']);

/** Scheduler → { nextArrivalDelay, mood, plan, companion(leader, ctx), companionDelay(activeCount) }. */
export function createCatScheduler({ rng, config = CAT_CONFIG }) {
  let nextId = 1;
  const draw = ([lo, hi]) => randRange(rng, lo, hi);

  /** Milliseconds until the next cat; the first-ever visit uses firstDelayMs, Cat nap scales everything by catnapGapScale. */
  function nextArrivalDelay({ playing, firstEver, presetId }) {
    const table = firstEver ? config.firstDelayMs : config.gapMs;
    const ms = draw(table[playing ? 'playing' : 'idle']);
    return presetId === 'catnap' ? ms * config.catnapGapScale : ms;
  }

  /** 'still' | 'idle' | 'sleepy' | 'alert' | 'calm' (meditate, calm and anything unknown fall through to calm). */
  function mood({ playing, purr, still, presetId }) {
    if (still) return 'still';
    if (!playing) return 'idle';
    if (SLEEPY_PRESETS.has(presetId)) return 'sleepy'; // purr plays everywhere in v2, so it no longer sends cats to sleep
    if (ALERT_PRESETS.has(presetId)) return 'alert';
    return 'calm';
  }

  /** A CatPlan for the current context, or null when the width class is already at maxConcurrent. */
  function plan(ctx) {
    const { viewport, activeCount = 0 } = ctx;
    const limit = viewport.w < NARROW_BELOW_PX ? config.maxConcurrent.narrow : config.maxConcurrent.default;
    if (activeCount >= limit) return null;
    const currentMood = mood(ctx);
    const pose = pickWeighted(config.poseWeights[currentMood], rng());
    const coat = pickWeighted(config.coatWeights, rng());
    const flip = rng() < 0.5;
    const speedPxPerS = pose === 'walk' ? draw(config.walkSpeedPxPerS) : null;
    const dwellMs = pose === 'walk'
      ? Math.round((1000 * (viewport.w + WALK_CROSSING_EXTRA_PX)) / speedPxPerS)
      : Math.round(draw(config.dwellMs[pose]));
    const blinkEveryMs = Math.round(draw(currentMood === 'still' ? config.blinkEveryStillMs : config.blinkEveryMs));
    return { id: nextId++, pose, coat, flip, dwellMs, enterMs: ENTER_MS, exitMs: EXIT_MS, speedPxPerS, blinkEveryMs };
  }

  /** A companion for `leader`: walkers get a chaser (same direction, a touch faster, another coat); sitters a neighbour. */
  function companion(leader, ctx) {
    const next = plan(ctx);
    if (!next) return null;
    const coats = Object.fromEntries(Object.entries(config.coatWeights).filter(([coat]) => coat !== leader.coat));
    next.coat = pickWeighted(coats, rng()) ?? next.coat;
    if (leader.pose === 'walk' && ctx.still !== true) {
      const speedPxPerS = leader.speedPxPerS * randRange(rng, 1.04, 1.12);
      Object.assign(next, { pose: 'walk', flip: leader.flip, speedPxPerS, frolic: true, dwellMs: Math.round((1000 * (ctx.viewport.w + WALK_CROSSING_EXTRA_PX)) / speedPxPerS) });
      leader.frolic = true;
    }
    return next;
  }

  /** Delay before a companion follows; null when enough cats are already about. */
  function companionDelay(activeCount) {
    return activeCount < config.minTogether ? Math.round(draw(config.companionDelayMs)) : null;
  }

  return { nextArrivalDelay, mood, plan, companion, companionDelay };
}

/** True when rects a and b overlap once a is grown by margin on every side (touching edges do not count). */
export function rectsIntersect(a, b, margin = 0) {
  return a.x - margin < b.x + b.w && a.x + a.w + margin > b.x && a.y - margin < b.y + b.h && a.y + a.h + margin > b.y;
}

/** Top-left { x, y } for a cat of `size` on the ledge, clear of `avoid` rects; walkers start off-screen; null when blocked. */
export function placeCat({ plan, viewport, ledge, avoid = [], size, rng, tries = 8, margin = 8 }) {
  const y = ledge.y - size.h;
  if (plan.pose === 'walk') return { x: plan.flip ? viewport.w : -size.w, y };
  const xMax = ledge.x1 - size.w;
  if (xMax < ledge.x0) return null;
  for (let i = 0; i < tries; i++) {
    const x = randRange(rng, ledge.x0, xMax);
    const rect = { x, y, w: size.w, h: size.h };
    if (!avoid.some((other) => rectsIntersect(rect, other, margin))) return { x, y };
  }
  return null;
}
