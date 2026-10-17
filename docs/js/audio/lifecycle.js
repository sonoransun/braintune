// Lifecycle (§5 lifecycle.js, §6.8 of the plan), documented behaviour only: feature detection,
// the audio session type set before the context exists, visibility and statechange recovery
// through engine.recover(), the opt-in screen wake lock and the platform notes. No UA sniffing,
// no automatic suspend/resume cycles, no analyser watchdogs, no media-element tricks.

import { limitationsCopy } from '../core/microcopy.js';

const lock = { wanted: false, sentinel: null };

function mediaMatches(matchMedia, query) {
  try {
    return typeof matchMedia === 'function' && Boolean(matchMedia.call(globalThis, query).matches);
  } catch {
    return false;
  }
}

/** Feature detection only: { coarse, hasAudioSession, hasWakeLock, hasVibrate, standalone }; `nav` and `matchMedia` are injectable for tests. */
export function detectPlatform({ nav = globalThis.navigator, matchMedia = globalThis.matchMedia } = {}) {
  const has = (name) => Boolean(nav) && name in nav;
  return {
    coarse: mediaMatches(matchMedia, '(pointer: coarse)'),
    hasAudioSession: has('audioSession'),
    hasWakeLock: has('wakeLock'),
    hasVibrate: has('vibrate'),
    standalone: mediaMatches(matchMedia, '(display-mode: standalone)'),
  };
}

/** Inside the Play gesture, before new AudioContext(): asks for a 'playback' audio session where the API exists; returns whether it was set. */
export function prepareSession(nav = globalThis.navigator) {
  try {
    if (!nav || !nav.audioSession) return false;
    nav.audioSession.type = 'playback';
    return true;
  } catch {
    return false;
  }
}

/** Wires visibilitychange and every context's statechange to engine.recover() (and the scheduler's hidden mode); returns dispose(). */
export function installLifecycle(engine, { doc = globalThis.document, nav = globalThis.navigator } = {}) {
  const contexts = new Set();
  const onStateChange = () => {
    engine.recover();
  };
  const attach = (ctx) => {
    if (!ctx || contexts.has(ctx)) return;
    contexts.add(ctx);
    ctx.addEventListener('statechange', onStateChange);
  };
  const onVisibility = () => {
    const hidden = doc.visibilityState === 'hidden';
    engine.setHidden(hidden);
    if (hidden) return;
    engine.recover();
    if (lock.wanted && !lock.sentinel) requestKeepAwake(nav);
  };
  const offContext = engine.on('context', ({ ctx }) => attach(ctx));
  attach(engine.getContext());
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    offContext();
    for (const ctx of contexts) ctx.removeEventListener('statechange', onStateChange);
    contexts.clear();
  };
}

/** Opt-in screen wake lock: resolves true while held; false when unsupported or refused. Re-requested on visibility return while wanted. */
export async function requestKeepAwake(nav = globalThis.navigator) {
  lock.wanted = true;
  if (!nav || !nav.wakeLock) return false;
  if (lock.sentinel) return true;
  try {
    const sentinel = await nav.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      if (lock.sentinel === sentinel) lock.sentinel = null;
    });
    if (!lock.wanted) {
      await sentinel.release();
      return false;
    }
    lock.sentinel = sentinel;
    return true;
  } catch {
    return false;
  }
}

/** Releases the wake lock and stops re-requesting it. */
export function releaseKeepAwake() {
  lock.wanted = false;
  const sentinel = lock.sentinel;
  lock.sentinel = null;
  if (sentinel) Promise.resolve(sentinel.release()).catch(() => {});
}

/** Whether a wake lock is currently wanted and held: { wanted, held }. */
export function keepAwakeState() {
  return { wanted: lock.wanted, held: lock.sentinel !== null };
}

/**
 * Platform notes for About: { platform: 'apple' | 'android' | 'desktop', lines }. The platform is a
 * copy-selection heuristic only (an audio session API on a coarse-pointer device reads as 'apple',
 * any other coarse-pointer device as 'android'); no behaviour depends on it.
 */
export function describeLimitations(platform) {
  const key = platform.hasAudioSession && platform.coarse ? 'apple' : platform.coarse ? 'android' : 'desktop';
  return { platform: key, lines: limitationsCopy(key) };
}
