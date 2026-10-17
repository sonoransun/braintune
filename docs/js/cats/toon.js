// Background layer of cell-shaded cats that frolic while a purr is audible (v2). Two cats sit in the stage, one on
// each side of the orb, at low opacity behind the controls. Motion is transform-only (head tilt, tail swish, paw
// bat, yarn roll, a slow drift) so the visual-rate contract holds; Still mode stops it; fades are one-shot.
import { TOON_VARIANTS, toonCatSvg, toonAspect } from '../core/toon-art.js';
import { COATS } from '../core/cat-art.js';

const HEIGHT_OF_STAGE = 0.34;
const MIN_HEIGHT_PX = 110;
const MAX_HEIGHT_PX = 280;
const MAX_WIDTH_OF_STAGE = 0.36;
const FADE_MS = 2500; // matches --t-scene; a fully faded layer is rebuilt with new cats for the next purr

/** createToonLayer(layerEl, { rng }) → { setActive, setStageRect, setVisible, destroy }. */
export function createToonLayer(layerEl, { rng = Math.random } = {}) {
  let active = false;
  let visible = true;
  let stage = null;
  let cats = [];
  let rebuildTimer = null;
  let serial = 0;

  const pick = (list, not = []) => {
    const pool = list.filter((item) => !not.includes(item));
    return pool[Math.floor(rng() * pool.length) % pool.length];
  };

  function build() {
    layerEl.replaceChildren();
    const first = pick(TOON_VARIANTS);
    const second = pick(TOON_VARIANTS, [first]);
    const coatA = pick(Object.keys(COATS));
    const coatB = pick(Object.keys(COATS), [coatA]);
    cats = [
      { side: 'left', variant: first, coat: coatA },
      { side: 'right', variant: second, coat: coatB },
    ].map((cat) => ({ ...cat, el: buildCat(cat) }));
    for (const cat of cats) layerEl.append(cat.el);
    place();
  }

  function buildCat({ side, variant, coat }) {
    const el = document.createElement('div');
    el.className = `toon__cat toon__cat--${side} toon--${variant}`;
    serial += 1;
    el.innerHTML = toonCatSvg({ variant, coat, id: `toon${serial}` });
    // Rotation pivots live in the art (data-origin, view-box units); CSSOM writes are fine under the CSP.
    for (const part of el.querySelectorAll('[data-origin]')) {
      const [x, y] = part.dataset.origin.split(' ');
      part.style.transformOrigin = `${x}px ${y}px`;
    }
    if (side === 'right') el.dataset.flip = 'true';
    return el;
  }

  /** Sits both cats on the stage floor, either side of the centre, sized to the stage height. */
  function place() {
    if (!stage || cats.length === 0) return;
    const tallest = Math.min(MAX_HEIGHT_PX, Math.max(MIN_HEIGHT_PX, stage.h * HEIGHT_OF_STAGE));
    const floor = stage.y + stage.h * 0.97;
    for (const cat of cats) {
      const aspect = toonAspect(cat.variant);
      const w = Math.round(Math.min(tallest * aspect, stage.w * MAX_WIDTH_OF_STAGE)); // keep clear of the orb and status
      const h = Math.round(w / aspect);
      const x = cat.side === 'left' ? stage.x + stage.w * 0.04 : stage.x + stage.w * 0.96 - w;
      cat.el.style.setProperty('--w', `${w}px`);
      cat.el.style.setProperty('--h', `${h}px`);
      cat.el.style.setProperty('--x', `${Math.round(x)}px`);
      cat.el.style.setProperty('--y', `${Math.round(floor - h)}px`);
    }
  }

  function render() {
    const on = active && visible;
    layerEl.classList.toggle('is-active', on);
    clearTimeout(rebuildTimer);
    // Once fully faded out, choose new cats so each purr brings different company.
    if (!on && cats.length) rebuildTimer = setTimeout(() => !active && build(), FADE_MS + 100);
  }

  return {
    /** True while a purr is audible; the layer fades in over 2.5 s and out again. */
    setActive(flag) {
      if (Boolean(flag) === active) return;
      active = Boolean(flag);
      if (active && cats.length === 0) build();
      render();
    },
    /** The visible stage in viewport px (same rect the scene composes into). */
    setStageRect(rect) {
      stage = rect;
      place();
    },
    /** False while the phone sheet covers the stage. */
    setVisible(flag) {
      visible = Boolean(flag);
      render();
    },
    destroy() {
      clearTimeout(rebuildTimer);
      layerEl.replaceChildren();
      cats = [];
    },
  };
}
