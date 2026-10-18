// Night dim (plan §7.7, v0.4 spec §5.1.8): during Sleep, Deep sleep or Rest, while playing and enabled, html[data-dim]
// goes to 'night' after a minute without activity and to 'deep' after five (core/dim-model.js); never while a panel
// control has focus or a dialog is open; any activity returns it to 'none' (CSS restores within 300 ms).

import { DIM_STAGES, dimStage, nextDimInMs } from '../core/dim-model.js';

// wheel: a desk user scrolling the panel with a trackpad or mouse wheel is active even if the pointer never moves.
const ACTIVITY_EVENTS = ['pointermove', 'pointerdown', 'keydown', 'focusin', 'touchstart', 'wheel', 'selectionchange'];
const ELIGIBLE_PRESETS = new Set(['sleep', 'deep', 'rest']);

/** Creates the night-dim controller for the <html> element; onChange(stage) runs on every stage change. */
export function createNightDim({
  root, isPlaying, getPresetId, isEnabled, onChange, doc = root.ownerDocument, panelEl = doc.getElementById('panel'),
  stages = DIM_STAGES, now = () => Date.now(), setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
}) {
  let running = false;
  let stage = 'none';
  let timer = null;
  let lastActivity = now();

  const couldDim = () => Boolean(isEnabled() && isPlaying() && ELIGIBLE_PRESETS.has(getPresetId()));
  const panelControlFocused = () => {
    const active = doc.activeElement;
    return Boolean(active && active !== doc.body && panelEl && panelEl.contains(active));
  };
  const eligible = () => couldDim() && !doc.querySelector('dialog[open]') && !panelControlFocused();

  function setStage(next) {
    if (stage === next) return;
    stage = next;
    root.dataset.dim = next;
    onChange?.(next);
  }

  function clear() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(ms) {
    clear();
    timer = setTimer(check, ms);
  }

  /** Moves to the stage the stillness has earned and waits for the next one; while dimming is held off, looks again a minute later. */
  function check() {
    timer = null;
    if (!couldDim()) return;
    const idleFor = now() - lastActivity;
    const due = dimStage(idleFor, stages);
    if (due !== 'none' && !eligible()) {
      schedule(stages.night);
      return;
    }
    setStage(due);
    const wait = nextDimInMs(idleFor, stages);
    if (wait !== null) schedule(wait);
  }

  /** Restores the screen; a pending check stays only while it is due before the next minute of stillness ends. */
  function onActivity() {
    const wasDimmed = stage !== 'none';
    lastActivity = now();
    setStage('none');
    if (running && couldDim() && (timer === null || wasDimmed)) schedule(stages.night);
  }

  /** Re-checks eligibility after a state, preset or setting change. */
  function refresh() {
    if (!running) return;
    if (!couldDim()) {
      clear();
      setStage('none');
      return;
    }
    if (timer === null && stage !== 'deep') schedule(stages.night);
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
      setStage('none');
    },
    refresh,
    /** 'none' | 'night' | 'deep'. */
    stage: () => stage,
  };
}
