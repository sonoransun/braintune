// Scroll-sheet state (plan §7.2): peek ↔ expanded from IntersectionObservers on the orb and a sentinel at the peek
// line, scroll helpers, and the geometry the scene and the cats ask for (stage rect, ledge, avoid rects).

const EXPANDED_BELOW_ORB_RATIO = 0.5;
const AVOID_SELECTOR = '[data-cat-avoid]';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Creates the sheet controller; onChange(expanded) listeners fire on every transition. */
export function createSheet({ root = document.documentElement, stageEl, panelEl, miniControlsEl = null, orbEl, sentinelEl, handleEl = null, win = window } = {}) {
  const listeners = new Set();
  let expanded = false;
  let orbRatio = 1;
  let sentinelAbove = false;
  const observers = [];

  const isPhone = () => root.dataset.layout === 'phone';
  const scrollBehavior = () => (root.dataset.motion === 'still' ? 'auto' : 'smooth');

  function apply(next) {
    if (next === expanded) return;
    expanded = next;
    root.dataset.sheet = expanded ? 'expanded' : 'peek';
    if (miniControlsEl) miniControlsEl.inert = !expanded;
    for (const fn of [...listeners]) fn(expanded);
  }

  const evaluate = () => apply(isPhone() && (orbRatio < EXPANDED_BELOW_ORB_RATIO || sentinelAbove));

  function observe(target, options, onEntry) {
    if (!target || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver((entries) => {
      onEntry(entries[entries.length - 1]);
      evaluate();
    }, options);
    observer.observe(target);
    observers.push(observer);
  }

  observe(orbEl, { threshold: [0, 0.25, 0.5, 0.75, 1] }, (entry) => {
    orbRatio = entry.isIntersecting ? entry.intersectionRatio : 0;
  });
  observe(sentinelEl, { threshold: 0 }, (entry) => {
    sentinelAbove = !entry.isIntersecting && entry.boundingClientRect.top < 0;
  });

  function expand() {
    const top = panelEl.getBoundingClientRect().top + win.scrollY;
    win.scrollTo({ top, behavior: scrollBehavior() });
  }

  function collapse() {
    win.scrollTo({ top: 0, behavior: scrollBehavior() });
  }

  /** Viewport-clipped rect of the stage area the scene composes waves and rain into. */
  function stageRect() {
    const r = stageEl.getBoundingClientRect();
    const top = clamp(r.top, 0, win.innerHeight);
    const bottom = clamp(r.bottom, 0, win.innerHeight);
    return { x: Math.max(0, r.left), y: top, w: Math.min(r.width, win.innerWidth), h: Math.max(0, bottom - top) };
  }

  /** Where cats stand: the sheet's top rim on phones, the bottom of the scene area elsewhere (viewport px). */
  function ledge() {
    if (isPhone()) {
      const top = clamp(panelEl.getBoundingClientRect().top, 0, win.innerHeight);
      return { y: top, x0: 0, x1: win.innerWidth };
    }
    const s = stageRect();
    return { y: s.y + s.h, x0: s.x, x1: s.x + s.w };
  }

  /** Viewport rects of every visible [data-cat-avoid] element. */
  function avoidRects() {
    const doc = root.ownerDocument;
    return [...doc.querySelectorAll(AVOID_SELECTOR)]
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < win.innerHeight)
      .map((r) => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  }

  const onHandle = () => expand();
  handleEl?.addEventListener('click', onHandle);
  if (miniControlsEl) miniControlsEl.inert = true;
  root.dataset.sheet = 'peek';

  return {
    expand,
    collapse,
    isExpanded: () => expanded,
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** Re-evaluates after a layout change (the orb observer alone cannot see data-layout flips). */
    refresh: evaluate,
    stageRect,
    ledge,
    avoidRects,
    destroy() {
      for (const observer of observers) observer.disconnect();
      observers.length = 0;
      handleEl?.removeEventListener('click', onHandle);
      listeners.clear();
    },
  };
}
