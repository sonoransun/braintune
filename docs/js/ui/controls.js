// Bindings for native controls (plan §7.7): radio groups, range sliders, role=switch buttons, disclosures, steppers.
// Each binding returns a small handle with get/set so the UI can mirror the store without re-firing callbacks.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const roundTo = (v, step) => (step > 0 ? Math.round(v / step) * step : v);
const toNumber = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' ? Number(v) : fallback);

/** Binds the radios inside groupEl: onChange(value, event) on user changes; set(value) checks one silently. */
export function bindRadioGroup(groupEl, { onChange } = {}) {
  const inputs = () => [...groupEl.querySelectorAll('input[type="radio"]')];
  const onChangeEvent = (e) => {
    if (e.target.matches('input[type="radio"]') && e.target.checked) onChange?.(e.target.value, e);
  };
  groupEl.addEventListener('change', onChangeEvent);
  return {
    get: () => inputs().find((i) => i.checked)?.value ?? null,
    set(value) {
      for (const input of inputs()) input.checked = input.value === String(value);
    },
    setDisabled(flag) {
      for (const input of inputs()) input.disabled = flag;
    },
    destroy: () => groupEl.removeEventListener('change', onChangeEvent),
  };
}

/** Binds a native range: input → onInput now and onCommit debounced; change → onCommit; Shift+arrows/PageUp/PageDown ±shiftStep; Home/End. */
export function bindSlider(input, {
  output = null, format = String, onInput, onCommit, shiftStep = 10, debounceMs = 250,
  setTimer = (fn, ms) => setTimeout(fn, ms), clearTimer = (id) => clearTimeout(id),
} = {}) {
  let pending = null;
  const value = () => Number(input.value);
  const min = () => toNumber(input.min, 0);
  const max = () => toNumber(input.max, 100);

  function paint() {
    const span = max() - min();
    const pct = span > 0 ? ((value() - min()) / span) * 100 : 0;
    input.style.setProperty('--pct', `${clamp(pct, 0, 100)}%`);
    if (output) {
      const text = format(value());
      output.textContent = text;
      input.setAttribute('aria-valuetext', text); // screen readers hear "steady" / "256 Hz · near C4", not the raw number
    }
  }
  function cancelPending() {
    if (pending === null) return;
    clearTimer(pending);
    pending = null;
  }
  function onInputEvent() {
    paint();
    onInput?.(value());
    cancelPending();
    pending = setTimer(() => {
      pending = null;
      onCommit?.(value());
    }, debounceMs);
  }
  function onChangeEvent() {
    cancelPending();
    onCommit?.(value());
  }
  function onKeyDown(e) {
    const up = e.key === 'PageUp' || (e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowRight'));
    const down = e.key === 'PageDown' || (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowLeft'));
    let next = null;
    if (up) next = value() + shiftStep;
    else if (down) next = value() - shiftStep;
    else if (e.key === 'Home') next = min();
    else if (e.key === 'End') next = max();
    if (next === null) return;
    e.preventDefault();
    input.value = String(clamp(roundTo(next, toNumber(input.step, 1)), min(), max()));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  input.addEventListener('input', onInputEvent);
  input.addEventListener('change', onChangeEvent);
  input.addEventListener('keydown', onKeyDown);
  paint();
  return {
    get: value,
    set(v) {
      input.value = String(v);
      paint();
    },
    setDisabled(flag) {
      input.disabled = flag;
    },
    paint,
    destroy() {
      cancelPending();
      input.removeEventListener('input', onInputEvent);
      input.removeEventListener('change', onChangeEvent);
      input.removeEventListener('keydown', onKeyDown);
    },
  };
}

/** Binds a <button role="switch">: click flips aria-checked and calls onChange(checked, event). */
export function bindSwitch(button, { onChange } = {}) {
  const get = () => button.getAttribute('aria-checked') === 'true';
  const set = (on) => button.setAttribute('aria-checked', on ? 'true' : 'false');
  const onClick = (e) => {
    const next = !get();
    set(next);
    onChange?.(next, e);
  };
  button.addEventListener('click', onClick);
  return {
    get,
    set,
    setDisabled(flag) {
      button.disabled = flag;
    },
    destroy: () => button.removeEventListener('click', onClick),
  };
}

/** Binds a disclosure: the toggle's aria-expanded, the wrapper's data-open (0fr → 1fr in CSS) and inert on the collapsed panel. */
export function bindDisclosure(toggle, panel, { wrapper = toggle.closest('.disclosure') ?? panel.parentElement, open = false, onToggle } = {}) {
  function apply(isOpen) {
    toggle.setAttribute('aria-expanded', String(isOpen));
    wrapper.dataset.open = String(isOpen);
    panel.inert = !isOpen;
    onToggle?.(isOpen);
  }
  const isOpen = () => toggle.getAttribute('aria-expanded') === 'true';
  const onClick = () => apply(!isOpen());
  toggle.addEventListener('click', onClick);
  apply(open);
  return {
    open: () => apply(true),
    close: () => apply(false),
    toggle: onClick,
    isOpen,
    destroy: () => toggle.removeEventListener('click', onClick),
  };
}

/** Binds a stepper (buttons with data-step="±1" around an <output>): values snap to the step grid within [min, max]; onChange(n, event). */
export function bindStepper(root, { min = 1, max = 480, step = 5, value = 20, format = String, output = root.querySelector('output'), onChange } = {}) {
  let current = clamp(Math.round(value), min, max);
  const paint = () => {
    if (output) output.textContent = format(current);
  };
  function set(n) {
    current = clamp(Math.round(n), min, max);
    paint();
  }
  function onClick(e) {
    const button = e.target.closest('[data-step]');
    if (!button || !root.contains(button)) return;
    const dir = Number(button.dataset.step) || 0;
    const snapped = roundTo(current + dir * step, step);
    set(dir > 0 ? Math.max(snapped, current + 1) : Math.min(snapped, current - 1));
    onChange?.(current, e);
  }
  root.addEventListener('click', onClick);
  paint();
  return { get: () => current, set, destroy: () => root.removeEventListener('click', onClick) };
}
