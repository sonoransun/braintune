// Toasts (plan §7.4, §9): rendered from core/toast-queue; action and sticky toasts persist with a close button,
// only the message <p> is live (the buttons sit in an aria-live="off" wrapper), and focus moves to the action
// button when the trigger came from the keyboard, returning on dismiss.

import { createToastQueue } from '../core/toast-queue.js';
import { STRINGS } from '../core/microcopy.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const EXIT_MS = 240;

/** Creates the toaster for a live region; keyboardIntent() says whether the last input came from the keyboard. */
export function createToaster(regionEl, { now, setTimer, clearTimer, max = 3, keyboardIntent = () => false } = {}) {
  const doc = regionEl.ownerDocument;
  const queue = createToastQueue({ now, max });
  const entries = new Map();
  let tickHandle = null;

  function button(className, label, { iconId = null, srLabel = false } = {}) {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = className;
    if (iconId) {
      const svg = doc.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'icon');
      svg.setAttribute('aria-hidden', 'true');
      const use = doc.createElementNS(SVG_NS, 'use');
      use.setAttribute('href', `#${iconId}`);
      svg.append(use);
      el.append(svg);
    }
    const text = doc.createElement('span');
    if (srLabel) text.className = 'sr-only';
    text.textContent = label;
    el.append(text);
    return el;
  }

  function add(toast, options) {
    const el = doc.createElement('div');
    el.className = 'toast';
    el.dataset.id = toast.id;
    const text = doc.createElement('p');
    text.className = 'toast__text';
    text.textContent = toast.text;
    el.append(text);
    const entry = { el, options, returnFocusTo: null, actionButton: null };
    if (toast.action || toast.sticky) {
      const actions = doc.createElement('div');
      actions.className = 'toast__actions';
      actions.setAttribute('aria-live', 'off');
      if (toast.action) {
        entry.actionButton = button('toast__action', toast.action.label);
        entry.actionButton.addEventListener('click', () => finish(toast.id, 'action'));
        actions.append(entry.actionButton);
      }
      const close = button('toast__close', options.dismissLabel ?? STRINGS.player.notNow, { iconId: 'i-close', srLabel: true });
      close.addEventListener('click', () => finish(toast.id, 'close'));
      actions.append(close);
      el.append(actions);
    }
    entries.set(toast.id, entry);
    regionEl.append(el);
    setTimer(() => {
      el.dataset.shown = 'true';
    }, 16);
    if (entry.actionButton && options.focusAction) {
      entry.returnFocusTo = doc.activeElement;
      entry.actionButton.focus();
    }
  }

  function remove(id, reason) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    const hadFocus = entry.el.contains(doc.activeElement);
    entry.el.dataset.shown = 'false';
    setTimer(() => entry.el.remove(), EXIT_MS);
    if (hadFocus && entry.returnFocusTo?.isConnected) entry.returnFocusTo.focus({ preventScroll: true });
    entry.options.onDismiss?.(reason);
  }

  /** A toast leaving through its action or close button: onAction runs after the dismissal is recorded. */
  function finish(id, reason) {
    const entry = entries.get(id);
    const toast = queue.list().find((t) => t.id === id);
    queue.dismiss(id);
    remove(id, reason);
    if (reason === 'action') toast?.action?.onAction?.();
    if (!entry) return;
    render();
  }

  function scheduleTick(visible) {
    if (tickHandle !== null) clearTimer(tickHandle);
    tickHandle = null;
    const next = visible.filter((t) => t.expiresAt !== null).map((t) => t.expiresAt);
    if (next.length === 0) return;
    tickHandle = setTimer(() => {
      tickHandle = null;
      render();
    }, Math.max(0, Math.min(...next) - now()));
  }

  function render() {
    const { visible, expired } = queue.tick();
    for (const id of expired) remove(id, 'expired');
    const alive = new Set(visible.map((t) => t.id));
    for (const id of [...entries.keys()]) if (!alive.has(id)) remove(id, 'dropped');
    scheduleTick(visible);
  }

  return {
    /** Shows a toast; returns false when one with the same id is already visible. */
    show({ id, text, action = null, sticky = false, durationMs = 4000, focusAction = null, dismissLabel = null, onDismiss = null }) {
      const toastId = id ?? text;
      if (!queue.push({ id: toastId, text, action, sticky, durationMs })) return false;
      const toast = queue.list().find((t) => t.id === toastId);
      add(toast, { focusAction: focusAction ?? keyboardIntent(), dismissLabel, onDismiss });
      render();
      return true;
    },
    dismiss(id) {
      const found = queue.dismiss(id);
      remove(id, 'api');
      render();
      return found;
    },
    destroy() {
      if (tickHandle !== null) clearTimer(tickHandle);
      for (const id of [...entries.keys()]) remove(id, 'api');
    },
  };
}
