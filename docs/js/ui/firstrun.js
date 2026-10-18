// First-run dialog (plan §7.4, v0.4 spec §5.1.10): showModal, Speakers highlighted by default and the suggested
// preset among "What would help right now?"; Esc or the backdrop keep the defaults; "Let's begin" stores
// firstRunDone, listening, and the chosen preset with its mix and intensities. No AudioContext is created here.

import { getPreset } from '../core/presets.js';

const RADIO_NAME = 'firstrun-listening';
const HELP_NAME = 'firstrun-help';
const ACCEPT_VALUE = 'begin';

/** Store fields for a chosen preset: its id, no fine tuning, its layer mix (the volume stays) and intensities. */
function presetFields(preset) {
  if (!preset) return {};
  return { presetId: preset.id, custom: null, mix: { ...preset.mix }, rainIntensity: preset.rainIntensity, oceanIntensity: preset.oceanIntensity };
}

/** Creates the first-run controller; onDone({ accepted, listening }) runs after the dialog closes. */
export function createFirstRun(dialogEl, { onDone } = {}) {
  let store = null;

  const checked = (name) => dialogEl.querySelector(`input[name="${name}"]:checked`)?.value ?? null;
  const check = (name, value) => {
    for (const input of dialogEl.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === value;
  };

  function onClose() {
    if (!store) return;
    const accepted = dialogEl.returnValue === ACCEPT_VALUE;
    const listening = accepted ? checked(RADIO_NAME) ?? 'speakers' : store.get().listening;
    store.patch(accepted ? { firstRunDone: true, listening, ...presetFields(getPreset(checked(HELP_NAME))) } : { firstRunDone: true });
    store = null;
    onDone?.({ accepted, listening });
  }

  function onBackdrop(e) {
    if (e.target === dialogEl) dialogEl.close('');
  }

  dialogEl.addEventListener('close', onClose);
  dialogEl.addEventListener('click', onBackdrop);

  return {
    /** Opens the dialog when the store says the first run is not done, with `suggested` (a preset id) chosen; returns whether it opened. */
    showIfNeeded(targetStore, { suggested = null } = {}) {
      if (targetStore.get().firstRunDone || typeof dialogEl.showModal !== 'function' || dialogEl.open) return false;
      store = targetStore;
      check(RADIO_NAME, 'speakers');
      check(HELP_NAME, suggested ?? targetStore.get().presetId);
      dialogEl.returnValue = '';
      try {
        dialogEl.showModal();
      } catch {
        store = null;
        return false;
      }
      return true;
    },
    close: () => dialogEl.open && dialogEl.close(''),
    destroy() {
      dialogEl.removeEventListener('close', onClose);
      dialogEl.removeEventListener('click', onBackdrop);
    },
  };
}
