// Haptics (inside input handlers only) and the two alternating live-region nodes with 1 s dedupe (plan §7.7, §9).

import { createAnnounceQueue } from '../core/toast-queue.js';

/** Vibration patterns in ms per feedback kind. */
export const HAPTIC = Object.freeze({ tap: [8], toggle: [12], preset: [8, 30, 8], play: [12], pause: [8], pet: [6, 40, 6] });

/** Vibrates the pattern for kind when enabled and the Vibration API exists; returns whether a pulse was requested. */
export function haptic(kind, { enabled = true, nav = globalThis.navigator } = {}) {
  const pattern = HAPTIC[kind];
  if (!enabled || !pattern || !nav || typeof nav.vibrate !== 'function') return false;
  try {
    return Boolean(nav.vibrate(pattern));
  } catch {
    return false;
  }
}

/** Creates an announcer over two role=status nodes; announce(text) alternates nodes and drops repeats within dedupeMs. */
export function createAnnouncer(liveA, liveB, { now = () => Date.now(), dedupeMs = 1000 } = {}) {
  const gate = createAnnounceQueue({ now, dedupeMs });
  let useA = true;

  function announce(text) {
    if (!gate.push(text)) return false;
    const target = useA ? liveA : liveB;
    const other = useA ? liveB : liveA;
    useA = !useA;
    other.textContent = '';
    target.textContent = text;
    return true;
  }

  return {
    announce,
    destroy() {
      liveA.textContent = '';
      liveB.textContent = '';
    },
  };
}
