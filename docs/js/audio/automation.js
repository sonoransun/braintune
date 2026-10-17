// AudioParam automation helpers and the lookahead scheduler (§5, §6.7 of the plan).
// Every helper that changes a parameter holds it first (holdParam) and schedules from
// the time the caller passes, which is ctx.currentTime + 0.01 throughout the engine.
// Event format: { param, at, kind: 'set'|'linear'|'exp'|'target', value, timeConstant? }.

import { fadeBreakpoints } from '../core/levels.js';
import { horizonWindow, pruneStale } from '../core/scheduler-core.js';

/** Smallest value an exponential ramp may aim at (the Web Audio API rejects 0). */
export const EXP_FLOOR = 1e-4;

/** Breakpoints per shaped fade. */
const FADE_STEPS = 32;

const expSafe = (value) => Math.max(EXP_FLOOR, value);
const defaultSetTimer = (fn, ms) => setTimeout(fn, ms);
const defaultClearTimer = (handle) => clearTimeout(handle);

/** Freezes a parameter at time t: cancelAndHoldAtTime when the browser has it, else cancel from t and pin the current value there. */
export function holdParam(param, t) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(t);
    return;
  }
  const value = param.value;
  param.cancelScheduledValues(t);
  param.setValueAtTime(value, t);
}

/** Holds, then moves a parameter to `value` from t: 'lin' or 'exp' ramp over `seconds`, or 'target' with `seconds` as the time constant. */
export function glideTo(param, value, t, seconds, kind = 'lin') {
  holdParam(param, t);
  if (kind === 'target') {
    param.setTargetAtTime(value, t, seconds);
    return;
  }
  if (kind !== 'lin' && kind !== 'exp') throw new RangeError(`glideTo: unknown kind "${kind}"`);
  const exponential = kind === 'exp';
  const target = exponential ? expSafe(value) : value;
  param.setValueAtTime(exponential ? expSafe(param.value) : param.value, t);
  if (!(seconds > 0)) param.setValueAtTime(target, t);
  else if (exponential) param.exponentialRampToValueAtTime(target, t + seconds);
  else param.linearRampToValueAtTime(target, t + seconds);
}

/** Holds, pins `from` at t, then ramps to `to` over `seconds` through linear breakpoints of the named shape ('scurve', 'equalPowerIn', 'equalPowerOut' or a single 'linear' ramp); never setValueCurveAtTime. */
export function fade(param, from, to, t, seconds, shape = 'scurve') {
  holdParam(param, t);
  param.setValueAtTime(from, t);
  if (!(seconds > 0)) {
    param.setValueAtTime(to, t);
    return;
  }
  if (shape === 'linear') {
    param.linearRampToValueAtTime(to, t + seconds);
    return;
  }
  const points = fadeBreakpoints(from, to, FADE_STEPS, shape);
  for (let i = 1; i < FADE_STEPS; i++) param.linearRampToValueAtTime(points[i], t + (seconds * i) / FADE_STEPS);
  param.linearRampToValueAtTime(to, t + seconds);
}

const APPLY = {
  set: (param, e) => param.setValueAtTime(e.value, e.at),
  linear: (param, e) => param.linearRampToValueAtTime(e.value, e.at),
  exp: (param, e) => param.exponentialRampToValueAtTime(expSafe(e.value), e.at),
  target: (param, e) => param.setTargetAtTime(e.value, e.at, e.timeConstant),
};

/** Schedules planner events on their parameters; `params` maps names to AudioParams (a Map or a plain object). Unknown params or kinds throw, since they are programming errors. */
export function applyEvents(params, events) {
  const lookup = params instanceof Map ? (name) => params.get(name) : (name) => params[name];
  for (const e of events) {
    const param = lookup(e.param);
    if (!param) throw new RangeError(`applyEvents: unknown param "${e.param}"`);
    const apply = APPLY[e.kind];
    if (!apply) throw new RangeError(`applyEvents: unknown kind "${e.kind}"`);
    apply(param, e);
  }
}

/** Equal-power crossfade from t: gainOut's current value → 0 along cos, gainIn's current value → 1 along sin, over `seconds`. */
export function crossfade(gainOut, gainIn, t, seconds = 1.2) {
  fade(gainOut, gainOut.value, 0, t, seconds, 'equalPowerOut');
  fade(gainIn, gainIn.value, 1, t, seconds, 'equalPowerIn');
}

/**
 * Lookahead scheduler: every tick each planner is asked to plan the window horizonWindow(now,
 * plannedUpTo, horizon) and every planned item that is not already in the past is applied.
 * Planner shape: { plannedUpTo, horizon?, plan(from, to) → items with `at`, apply(item), reset?() }.
 * A planner may raise its own plannedUpTo beyond `to` (bundles such as waves do). Hidden tabs get
 * slower ticks with a longer lookahead; flush() re-plans from now after a resume or rebuild.
 */
export function createScheduler(ctx, options = {}) {
  const {
    tickMs = 200, lookaheadSec = 1, hiddenTickMs = 1000, hiddenLookaheadSec = 3,
    setTimer = defaultSetTimer, clearTimer = defaultClearTimer,
  } = options;
  const planners = new Set();
  let hidden = false;
  let running = false;
  let handle = null;

  const lookahead = () => (hidden ? hiddenLookaheadSec : lookaheadSec);
  const interval = () => (hidden ? hiddenTickMs : tickMs);

  function planOne(planner, now) {
    const window = horizonWindow(now, planner.plannedUpTo ?? 0, planner.horizon ?? lookahead());
    if (!window) return;
    const [from, to] = window;
    for (const item of pruneStale(planner.plan(from, to), now)) planner.apply(item);
    planner.plannedUpTo = Math.max(to, planner.plannedUpTo ?? 0);
  }

  function tick() {
    const now = ctx.currentTime;
    for (const planner of planners) planOne(planner, now);
  }

  function arm() {
    handle = setTimer(() => {
      handle = null;
      if (!running) return;
      tick();
      arm();
    }, interval());
  }

  function start() {
    if (running) return;
    running = true;
    tick();
    arm();
  }

  function stop() {
    running = false;
    if (handle !== null) clearTimer(handle);
    handle = null;
  }

  function flush() {
    for (const planner of planners) {
      planner.plannedUpTo = 0;
      planner.reset?.();
    }
    if (running) tick();
  }

  function setHidden(flag) {
    const next = Boolean(flag);
    if (next === hidden) return;
    hidden = next;
    if (!running) return;
    stop();
    start();
  }

  function add(planner) {
    planners.add(planner);
    if (running) planOne(planner, ctx.currentTime);
  }

  function remove(planner) {
    planners.delete(planner);
  }

  return {
    add,
    remove,
    start,
    stop,
    flush,
    setHidden,
    get running() {
      return running;
    },
    get hidden() {
      return hidden;
    },
  };
}
