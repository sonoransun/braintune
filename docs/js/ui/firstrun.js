// First-run dialog (plan §7.4): showModal, Speakers highlighted by default, Esc or the backdrop keep the default,
// "Let's begin" stores firstRunDone + listening. No AudioContext is created here.

const RADIO_NAME = 'firstrun-listening';
const ACCEPT_VALUE = 'begin';

/** Creates the first-run controller; onDone({ accepted, listening }) runs after the dialog closes. */
export function createFirstRun(dialogEl, { onDone } = {}) {
  let store = null;

  const chosen = () => dialogEl.querySelector(`input[name="${RADIO_NAME}"]:checked`)?.value ?? 'speakers';

  function onClose() {
    if (!store) return;
    const accepted = dialogEl.returnValue === ACCEPT_VALUE;
    const listening = accepted ? chosen() : store.get().listening;
    store.patch(accepted ? { firstRunDone: true, listening } : { firstRunDone: true });
    store = null;
    onDone?.({ accepted, listening });
  }

  function onBackdrop(e) {
    if (e.target === dialogEl) dialogEl.close('');
  }

  dialogEl.addEventListener('close', onClose);
  dialogEl.addEventListener('click', onBackdrop);

  return {
    /** Opens the dialog when the store says the first run is not done; returns whether it opened. */
    showIfNeeded(targetStore) {
      if (targetStore.get().firstRunDone || typeof dialogEl.showModal !== 'function' || dialogEl.open) return false;
      store = targetStore;
      for (const input of dialogEl.querySelectorAll(`input[name="${RADIO_NAME}"]`)) input.checked = input.value === 'speakers';
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
