// The orb (plan §7.5, §7.9, v0.4 §V9): state-driven halos, a progress ring, breathing at 10.9 s (Web Animations), a 3 s
// bloom and a tap ripple capped at three per second. Nothing here derives from the sound; inputs are state, labels, the
// timer fraction and flags, and the length of a session's entrance.

const BREATH_MS = 10900;
const BREATH_EASING = 'cubic-bezier(0.37, 0, 0.63, 1)';
const BREATH_SWELL = 1.035;
const BLOOM_MS = 3000;
const RIPPLE_MS = 900;
const RIPPLE_MIN_GAP_MS = 334;
const HALO_SCALE = { outer: 1.75, inner: 1.3 };

const clamp01 = (x) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 0));

/** Creates the orb controller for a .orb button; onToggle(event) runs synchronously inside the click. */
export function createOrb(el, { onToggle, still = false, now = () => performance.now() } = {}) {
  const halos = [...el.querySelectorAll('.orb__halo')];
  const rippleEl = el.querySelector('.orb__ripple');
  const labelEl = el.querySelector('.orb__label');
  const canAnimate = typeof el.animate === 'function';
  let breathing = [];
  let isStill = still;
  let lastRippleAt = -Infinity;

  const scaleOf = (halo) => (halo.classList.contains('orb__halo--outer') ? HALO_SCALE.outer : HALO_SCALE.inner);

  function startBreathing() {
    if (!canAnimate || isStill || breathing.length > 0) return;
    breathing = halos.map((halo) => {
      const base = scaleOf(halo);
      return halo.animate(
        [{ transform: `scale(${base})` }, { transform: `scale(${(base * BREATH_SWELL).toFixed(3)})` }, { transform: `scale(${base})` }],
        { duration: BREATH_MS, iterations: Infinity, easing: BREATH_EASING },
      );
    });
  }

  function stopBreathing() {
    for (const animation of breathing) animation.cancel();
    breathing = [];
  }

  function onClick(event) {
    ripple();
    onToggle?.(event);
  }

  /** Thin ring expanding from the rim; ignored when the last one started under 334 ms ago. */
  function ripple() {
    if (!canAnimate || !rippleEl || now() - lastRippleAt < RIPPLE_MIN_GAP_MS) return;
    lastRippleAt = now();
    rippleEl.animate(
      [{ transform: 'scale(1)', opacity: 0.55 }, { transform: 'scale(1.6)', opacity: 0 }],
      { duration: RIPPLE_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  /** One soft swell of the outer halo over 3 s (session complete). */
  function bloom() {
    const outer = halos.find((halo) => halo.classList.contains('orb__halo--outer'));
    if (!canAnimate || !outer) return;
    const base = HALO_SCALE.outer;
    outer.animate(
      [{ transform: `scale(${base})`, opacity: 0.4 }, { transform: `scale(${base * 1.4})`, opacity: 0 }],
      { duration: BLOOM_MS, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }

  /** Stretches a halo rise already under way (the state flips before the entrance length is known). */
  function stretchHaloRise(ms) {
    for (const halo of halos) {
      for (const animation of halo.getAnimations?.() ?? []) {
        if (animation.transitionProperty === 'opacity') animation.effect?.updateTiming({ duration: ms });
      }
    }
  }

  el.addEventListener('click', onClick);
  startBreathing();

  return {
    /** Engine state name → data-state (halo opacities and core tint from CSS); any state but idle or starting ends an entrance. */
    setState(state) {
      el.dataset.state = state;
      if (state !== 'starting' && state !== 'idle') el.style.removeProperty('--t-entrance');
    },
    /** A timer is armed → data-timer (a brighter ring track). */
    setTimerArmed(on) {
      el.dataset.timer = String(Boolean(on));
    },
    /** Waiting for the tap that starts an autoplay session → data-waiting (halos at the playing values). */
    setWaiting(on) {
      el.dataset.waiting = String(Boolean(on));
    },
    /** One-shot: the halos rise over ms while a session enters (--t-entrance, cleared once it has played). */
    setEntrance(ms) {
      if (!(Number.isFinite(ms) && ms > 0)) {
        el.style.removeProperty('--t-entrance');
        return;
      }
      el.style.setProperty('--t-entrance', `${Math.round(ms)}ms`);
      if (el.dataset.state === 'starting') stretchHaloRise(Math.round(ms));
    },
    /** Timer progress 0–1 → the ring fill. */
    setProgress(fraction) {
      el.style.setProperty('--progress', String(clamp01(fraction)));
    },
    /** Visible label and accessible name (the next action), plus an optional attune flag for the smaller label. */
    setLabels({ label, name = label, attune = false }) {
      if (labelEl) labelEl.textContent = label;
      el.setAttribute('aria-label', name);
      el.dataset.attune = String(Boolean(attune));
    },
    bloom,
    ripple,
    /** Still mode stops the breathing (opacity and transform hold at the CSS values). */
    setStill(flag) {
      isStill = Boolean(flag);
      if (isStill) stopBreathing();
      else startBreathing();
    },
    focus: () => el.focus({ preventScroll: true }),
    destroy() {
      stopBreathing();
      el.removeEventListener('click', onClick);
    },
  };
}
