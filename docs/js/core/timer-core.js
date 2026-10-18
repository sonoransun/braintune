// Session timer maths. Pure: the wall clock is injected as now() in ms; audio times are context seconds.

/** Highest chime pitch, Hz: the chime sits an octave and a twelfth above the carrier, folded down below this. */
const CHIME_MAX_HZ = 1000;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function smoothstep(x) {
  return x * x * (3 - 2 * x);
}

/** Creates a wall-clock session timer; remaining time is always endsAt - now(), never decremented. */
export function createTimerCore({ now } = {}) {
  if (typeof now !== 'function') throw new TypeError('createTimerCore needs a now() function');
  let durationMs = 0;
  let endsAt = null;
  let pausedRemainingMs = null;

  function cancel() {
    durationMs = 0;
    endsAt = null;
    pausedRemainingMs = null;
  }

  function arm(ms) {
    if (!(isFiniteNumber(ms) && ms > 0)) {
      cancel();
      return;
    }
    durationMs = ms;
    endsAt = now() + ms;
    pausedRemainingMs = null;
  }

  function isRunning() {
    return endsAt !== null;
  }

  function isPaused() {
    return pausedRemainingMs !== null;
  }

  function remainingMs() {
    if (endsAt !== null) return Math.max(0, endsAt - now());
    if (pausedRemainingMs !== null) return pausedRemainingMs;
    return 0;
  }

  function pause() {
    if (!isRunning()) return;
    pausedRemainingMs = remainingMs();
    endsAt = null;
  }

  function resume() {
    if (!isPaused()) return;
    endsAt = now() + pausedRemainingMs;
    pausedRemainingMs = null;
  }

  function snapshot() {
    return { durationMs, endsAt, pausedRemainingMs };
  }

  function restore(obj) {
    const source = obj ?? {};
    const paused = isFiniteNumber(source.pausedRemainingMs) && source.pausedRemainingMs >= 0 ? source.pausedRemainingMs : null;
    const ends = paused === null && isFiniteNumber(source.endsAt) ? source.endsAt : null;
    if (paused === null && ends === null) {
      cancel();
      return;
    }
    endsAt = ends;
    pausedRemainingMs = paused;
    durationMs = isFiniteNumber(source.durationMs) && source.durationMs > 0 ? source.durationMs : remainingMs();
  }

  return { arm, pause, resume, cancel, remainingMs, isRunning, isPaused, snapshot, restore };
}

/** Plans the end-of-session master fade: a 'set' at startT then n linear S-curve breakpoints down to 0; null when nothing remains. */
export function endFadePlan({ remainingMs, endFadeSeconds, nowT, masterValue, n = 32 }) {
  if (!(remainingMs > 0)) return null;
  const endT = nowT + remainingMs / 1000;
  const startT = Math.max(nowT, endT - Math.max(0, endFadeSeconds));
  const duration = endT - startT;
  const steps = duration > 0 ? Math.max(1, Math.floor(n)) : 1;
  const events = [{ param: 'master', kind: 'set', value: masterValue, at: startT }];
  for (let i = 1; i <= steps; i += 1) {
    const x = i / steps;
    events.push({ param: 'master', kind: 'linear', value: masterValue * (1 - smoothstep(x)), at: startT + duration * x });
  }
  return { startT, duration, events };
}

/** Chime pitches for a session carrier f: its octave and twelfth [2f, 3f], halved while 3f is above 1 kHz (264 → 528/792, 440 → 440/660). */
export function chimeFrequencies(carrierHz = 264) {
  const folds = Math.max(0, Math.ceil(Math.log2((3 * carrierHz) / CHIME_MAX_HZ)));
  return [(2 * carrierHz) / 2 ** folds, (3 * carrierHz) / 2 ** folds];
}

/** Two soft chime notes on the session's harmonic series (chimeFrequencies), 1.2 s each with a 0.4 s overlap, at `peak`. */
export function chimeEvents(t0, { carrierHz = 264, peak = 0.15 } = {}) {
  const [first, second] = chimeFrequencies(carrierHz);
  return [
    { freq: first, startT: t0, duration: 1.2, peak },
    { freq: second, startT: t0 + 0.8, duration: 1.2, peak },
  ];
}
