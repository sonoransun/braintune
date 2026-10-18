// Session timer (§5 session-timer.js, §6.7 of the plan). The wall clock is the truth (timer-core):
// remaining = endsAt − now(). The end fade is planned from the LIVE target of the faded parameter
// (master, or the tone bus when the session continues as ambience) and re-armed on arm, resume,
// visibility return and after every write to that parameter; a 1 Hz tick re-checks that a fade
// is scheduled once the end is near and finishes the session when nothing remains.
//
// hooks: { now() → ms, setTimer, clearTimer, ctxTime() → seconds | null,
//          fadeTarget(after) → { param, value, floorT } | null   (floorT: when the engine's own in-flight fade on that param ends),
//          chimeIn() → AudioNode | null, onEnding(), finish(after), emit(payload), presetId(),
//          carrierHz?() → Hz and chimePeak?() → linear peak, which tune the chime to the session (timer-core chimeEvents) }

import { createTimerCore, endFadePlan, chimeEvents } from '../core/timer-core.js';
import { holdParam, applyEvents } from './automation.js';

const LEAD = 0.01;
const TICK_MS = 1000;
/** The tick schedules a missing end fade this many seconds before it is due. */
const ENSURE_MARGIN_S = 3;
/** Cancelling from just after the fade start keeps an engine fade that ends exactly there. */
const CANCEL_EPSILON = 0.001;
const CHIME_STEPS = 16;
const CHIME_TAIL = 0.05;
const DEFAULT_OPTIONS = Object.freeze({ endFadeSeconds: 30, chime: 'none', after: 'stop' });

/** Creates the session timer around the engine hooks: { arm, pause, resume, cancel, remainingMs, isArmed, rearmEndFade, onVisible, forgetFade, phase, snapshot, restore }. */
export function createSessionTimer(hooks) {
  const core = createTimerCore({ now: hooks.now });
  let options = { ...DEFAULT_OPTIONS };
  let fadeParam = null;
  let fadeStartT = null;
  let tickHandle = null;
  let phase = 'done';

  const ctxNow = () => {
    const t = hooks.ctxTime();
    return Number.isFinite(t) ? t + LEAD : null;
  };

  function emitPhase(next, remainingMs = core.remainingMs()) {
    const entering = next === 'ending' && phase !== 'ending';
    phase = next;
    if (entering) hooks.onEnding();
    hooks.emit({ remainingMs, phase: next });
  }

  function currentPhase(remainingMs) {
    return remainingMs <= options.endFadeSeconds * 1000 ? 'ending' : 'running';
  }

  /** Removes a scheduled end fade from its parameter: from its start when that is still ahead, else by holding now. */
  function clearFade() {
    if (fadeParam) {
      const nowT = ctxNow();
      if (nowT !== null) {
        if (fadeStartT > nowT) fadeParam.cancelScheduledValues(fadeStartT + CANCEL_EPSILON);
        else holdParam(fadeParam, nowT);
      }
    }
    forgetFade();
  }

  /** Drops the references to a scheduled fade without touching the parameter (the engine rebuilt its graph). */
  function forgetFade() {
    fadeParam = null;
    fadeStartT = null;
  }

  /** Plans the end fade from the faded parameter's live target: a slider move before the fade keeps the fade; one during it restarts it from the new level. */
  function rearmEndFade() {
    if (!core.isRunning()) return;
    const target = hooks.fadeTarget(options.after);
    const nowT = ctxNow();
    if (!target || nowT === null) return;
    if (fadeParam && fadeParam !== target.param) clearFade();
    const endT = nowT + core.remainingMs() / 1000;
    const floorT = Math.max(nowT, target.floorT ?? 0);
    const startT = Math.max(floorT, endT - options.endFadeSeconds);
    if (!(endT - startT > 0)) {
      clearFade();
      return;
    }
    const inProgress = startT <= nowT + 1e-9;
    if (inProgress) holdParam(target.param, nowT);
    else target.param.cancelScheduledValues(startT + CANCEL_EPSILON);
    const plan = endFadePlan({
      remainingMs: (endT - startT) * 1000,
      endFadeSeconds: endT - startT,
      nowT: startT,
      masterValue: inProgress ? target.param.value : target.value,
    });
    applyEvents({ master: target.param }, plan.events);
    fadeParam = target.param;
    fadeStartT = plan.startT;
  }

  function stopTick() {
    if (tickHandle !== null) hooks.clearTimer(tickHandle);
    tickHandle = null;
  }

  function startTick() {
    stopTick();
    tickHandle = hooks.setTimer(tick, TICK_MS);
  }

  function tick() {
    tickHandle = null;
    if (!core.isRunning()) return;
    const remainingMs = core.remainingMs();
    if (remainingMs <= 0) {
      finish();
      return;
    }
    if (fadeParam === null && remainingMs <= (options.endFadeSeconds + ENSURE_MARGIN_S) * 1000) rearmEndFade();
    emitPhase(currentPhase(remainingMs), remainingMs);
    startTick();
  }

  function finish() {
    const after = options.after;
    core.cancel();
    stopTick();
    forgetFade();
    if (options.chime === 'soft') playChime();
    emitPhase('done', 0);
    hooks.finish(after);
  }

  function playChime() {
    const node = hooks.chimeIn();
    const nowT = ctxNow();
    if (!node || nowT === null) return;
    const ctx = node.context;
    for (const { freq, startT, duration, peak } of chimeEvents(nowT + CHIME_TAIL, { carrierHz: hooks.carrierHz?.(), peak: hooks.chimePeak?.() })) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0, startT);
      for (let i = 1; i <= CHIME_STEPS; i++) {
        const x = i / CHIME_STEPS;
        env.gain.linearRampToValueAtTime(peak * (0.5 - 0.5 * Math.cos(2 * Math.PI * x)), startT + duration * x);
      }
      osc.connect(env);
      env.connect(node);
      osc.onended = () => {
        osc.disconnect();
        env.disconnect();
      };
      osc.start(startT);
      osc.stop(startT + duration + CHIME_TAIL);
    }
  }

  /** Starts a session of `ms` with { endFadeSeconds, chime, after }; a non-positive length cancels. */
  function arm(ms, opts = {}) {
    options = { ...DEFAULT_OPTIONS, ...opts };
    clearFade();
    core.arm(ms);
    if (!core.isRunning()) {
      stopTick();
      return;
    }
    rearmEndFade();
    startTick();
    emitPhase(currentPhase(core.remainingMs()));
  }

  /** Freezes the remainder and removes the scheduled fade. */
  function pause() {
    if (!core.isRunning()) return;
    core.pause();
    clearFade();
    stopTick();
    emitPhase('paused');
  }

  /** Re-anchors the remainder to the wall clock and re-arms the fade. */
  function resume() {
    if (!core.isPaused()) return;
    core.resume();
    rearmEndFade();
    startTick();
    emitPhase(currentPhase(core.remainingMs()));
  }

  /** Forgets the session; silent, since the caller knows. */
  function cancel() {
    core.cancel();
    clearFade();
    stopTick();
    phase = 'done';
  }

  /** On visibility return: re-check the fade against the wall clock. */
  function onVisible() {
    if (!core.isRunning()) return;
    rearmEndFade();
    emitPhase(currentPhase(core.remainingMs()));
  }

  /** The store's session shape plus the options needed to restore. */
  function snapshot() {
    const { endsAt, pausedRemainingMs } = core.snapshot();
    return { presetId: hooks.presetId(), endsAt, pausedRemainingMs, ...options };
  }

  /** Restores a snapshot (store session shape); a running session re-arms, a paused one waits for resume(). */
  function restore(session, opts = {}) {
    options = { ...DEFAULT_OPTIONS, ...opts };
    clearFade();
    stopTick();
    core.restore(session);
    if (core.isRunning()) {
      rearmEndFade();
      startTick();
      emitPhase(currentPhase(core.remainingMs()));
    } else if (core.isPaused()) {
      emitPhase('paused');
    }
  }

  return {
    arm,
    pause,
    resume,
    cancel,
    remainingMs: () => core.remainingMs(),
    isArmed: () => core.isRunning() || core.isPaused(),
    isPaused: () => core.isPaused(),
    rearmEndFade,
    onVisible,
    forgetFade,
    phase: () => (core.isRunning() || core.isPaused() ? phase : 'done'),
    options: () => ({ ...options }),
    snapshot,
    restore,
  };
}
