// Toast and live-announcement queues. Pure: the clock is injected as now() in ms.

function requireClock(now, name) {
  if (typeof now !== 'function') throw new TypeError(`${name} needs a now() function`);
}

/** Creates a toast queue: push/dismiss/tick/list; action or sticky toasts never expire or get dropped. */
export function createToastQueue({ now, max = 3 } = {}) {
  requireClock(now, 'createToastQueue');
  const toasts = [];
  const isPinned = (toast) => toast.sticky || toast.action !== null;
  const list = () => toasts.map((toast) => ({ ...toast }));

  function dropOverflow() {
    while (toasts.length > max) {
      const index = toasts.findIndex((toast) => !isPinned(toast));
      if (index === -1) return;
      toasts.splice(index, 1);
    }
  }

  function push({ text, id = text, action = null, sticky = false, durationMs = 4000 }) {
    if (toasts.some((toast) => toast.id === id)) return false;
    const createdAt = now();
    const pinned = sticky || action !== null;
    toasts.push({ id, text, action, sticky, durationMs, createdAt, expiresAt: pinned ? null : createdAt + durationMs });
    dropOverflow();
    return true;
  }

  function dismiss(id) {
    const index = toasts.findIndex((toast) => toast.id === id);
    if (index === -1) return false;
    toasts.splice(index, 1);
    return true;
  }

  function tick() {
    const t = now();
    const expired = toasts.filter((toast) => toast.expiresAt !== null && toast.expiresAt <= t).map((toast) => toast.id);
    for (const id of expired) dismiss(id);
    return { visible: list(), expired };
  }

  return { push, dismiss, tick, list };
}

/** Whether a toast waits for the next touch or key press: a sticky one during a sleepy session or while the screen is dimmed (v0.4 spec §5.1.9). */
export function shouldDeferToast({ sticky = false, mood = null, dimmed = false } = {}) {
  return sticky === true && (mood === 'sleepy' || dimmed === true);
}

/** Creates a live-region announcement gate: push(text) is false for identical text within dedupeMs. */
export function createAnnounceQueue({ now, dedupeMs = 1000 } = {}) {
  requireClock(now, 'createAnnounceQueue');
  let lastText = null;
  let lastAt = -Infinity;

  function push(text) {
    if (typeof text !== 'string' || text.length === 0) return false;
    const t = now();
    if (text === lastText && t - lastAt < dedupeMs) return false;
    lastText = text;
    lastAt = t;
    return true;
  }

  return { push };
}
