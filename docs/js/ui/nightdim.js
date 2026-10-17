// Night dim (plan §7.7): during Sleep or Rest, while playing and enabled, html[data-dim=night] after 60 s without
// activity; never while a panel control has focus or a dialog is open; any activity restores within 300 ms (CSS).

const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'focusin', 'touchstart', 'selectionchange'];
const ELIGIBLE_PRESETS = new Set(['sleep', 'rest']);

/** Creates the night-dim controller for the <html> element. */
export function createNightDim({
  root, isPlaying, getPresetId, isEnabled, doc = root.ownerDocument, panelEl = doc.getElementById('panel'),
  idleMs = 60000, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let running = false;
  let dimmed = false;
  let timer = null;
  let lastActivity = now();

  const couldDim = () => Boolean(isEnabled() && isPlaying() && ELIGIBLE_PRESETS.has(getPresetId()));
  const panelControlFocused = () => {
    const active = doc.activeElement;
    return Boolean(active && active !== doc.body && panelEl && panelEl.contains(active));
  };
  const eligible = () => couldDim() && !doc.querySelector('dialog[open]') && !panelControlFocused();

  function setDim(on) {
    if (dimmed === on) return;
    dimmed = on;
    root.dataset.dim = on ? 'night' : 'none';
  }

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms) {
    clear();
    timer = setTimer(check, ms);
  }

  function check() {
    timer = null;
    const idleFor = now() - lastActivity;
    if (idleFor < idleMs) {
      schedule(idleMs - idleFor);
      return;
    }
    if (eligible()) setDim(true);
    else if (couldDim()) schedule(idleMs);
  }

  function onActivity() {
    lastActivity = now();
    if (dimmed) setDim(false);
    if (running && timer === null && couldDim()) schedule(idleMs);
  }

  /** Re-checks eligibility after a state, preset or setting change. */
  function refresh() {
    if (!running) return;
    if (!couldDim()) {
      clear();
      setDim(false);
      return;
    }
    if (timer === null) schedule(idleMs);
  }

  return {
    start() {
      if (running) return;
      running = true;
      lastActivity = now();
      for (const type of ACTIVITY_EVENTS) doc.addEventListener(type, onActivity, { passive: true });
      refresh();
    },
    stop() {
      if (!running) return;
      running = false;
      for (const type of ACTIVITY_EVENTS) doc.removeEventListener(type, onActivity);
      clear();
      setDim(false);
    },
    refresh,
    isDimmed: () => dimmed,
  };
}
