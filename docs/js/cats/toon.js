// Background layer of cell-shaded cats that frolic while a purr is audible (v2). Two cats sit in the stage, one on
// each side of the orb, at low opacity behind the controls. Motion is transform-only (head tilt, tail swish, paw
// bat, yarn roll, a slow drift) so the visual-rate contract holds; Still mode stops it; fades are one-shot. At night
// (setMood) the pair lies or sits, acts less often and never pounces.
import { TOON_VARIANTS, toonCatSvg, toonAspect } from '../core/toon-art.js';
import { COATS } from '../core/cat-art.js';

const HEIGHT_OF_STAGE = 0.3;
const MIN_HEIGHT_PX = 110;
const MAX_HEIGHT_PX = 240;
const MAX_WIDTH_OF_STAGE = 0.36;
const SIDE_MARGIN_OF_STAGE = 0.02; // share of the stage width between each cat and its edge
// Every few seconds one background cat hops, stretches or pounces (one-shot; never in Still mode); at night less often.
const ACTION_EVERY_MS = { day: [3500, 7500], night: [6000, 12000] };
const PLAY_MOVES = ['pounce', 'pounce', 'hop', 'stretch'];
const CALM_MOVES = ['hop', 'stretch', 'stretch'];
const NIGHT_VARIANTS = ['lie', 'sit'];
const ACTION_MS = 1600;
const FADE_MS = 2500; // matches --t-scene; a fully faded layer is rebuilt with new cats for the next purr

/** createToonLayer(layerEl, { rng }) → { setActive, setStageRect, setVisible, setMood, destroy }. */
export function createToonLayer(layerEl, { rng = Math.random } = {}) {
  let active = false;
  let visible = true;
  let mood = 'day';
  let builtFor = null; // the mood the current pair was chosen for
  let stage = null;
  let cats = [];
  let rebuildTimer = null;
  let serial = 0;
  let actionTimer = null;

  const pick = (list, not = []) => {
    const pool = list.filter((item) => !not.includes(item));
    return pool[Math.floor(rng() * pool.length) % pool.length];
  };

  function build() {
    layerEl.replaceChildren();
    const variants = mood === 'night' ? NIGHT_VARIANTS : TOON_VARIANTS;
    const first = pick(variants);
    const second = pick(variants, [first]);
    const coatA = pick(Object.keys(COATS));
    const coatB = pick(Object.keys(COATS), [coatA]);
    cats = [
      { side: 'left', variant: first, coat: coatA },
      { side: 'right', variant: second, coat: coatB },
    ].map((cat) => ({ ...cat, el: buildCat(cat) }));
    for (const cat of cats) layerEl.append(cat.el);
    builtFor = mood;
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
      const x = cat.side === 'left' ? stage.x + stage.w * SIDE_MARGIN_OF_STAGE : stage.x + stage.w * (1 - SIDE_MARGIN_OF_STAGE) - w;
      cat.el.style.setProperty('--w', `${w}px`);
      cat.el.style.setProperty('--h', `${h}px`);
      cat.el.style.setProperty('--x', `${Math.round(x)}px`);
      cat.el.style.setProperty('--y', `${Math.round(floor - h)}px`);
    }
  }

  function scheduleAction() {
    clearTimeout(actionTimer);
    const [lo, hi] = ACTION_EVERY_MS[mood];
    actionTimer = setTimeout(() => {
      act();
      scheduleAction();
    }, lo + rng() * (hi - lo));
  }

  function act() {
    if (document.documentElement.dataset.motion === 'still' || document.hidden || cats.length === 0) return;
    const cat = cats[Math.floor(rng() * cats.length) % cats.length];
    const moves = cat.variant === 'play' && mood === 'day' ? PLAY_MOVES : CALM_MOVES;
    cat.el.dataset.act = moves[Math.floor(rng() * moves.length) % moves.length];
    setTimeout(() => delete cat.el.dataset.act, ACTION_MS);
  }

  /** After a whole fade out of sight: new company for the next purr, or for a new mood. */
  function rebuildUnseen() {
    rebuildTimer = null;
    if (!active || builtFor !== mood) build();
  }

  function render() {
    const on = active && visible;
    layerEl.classList.toggle('is-active', on);
    if (on) scheduleAction();
    else clearTimeout(actionTimer);
    clearTimeout(rebuildTimer);
    rebuildTimer = !on && cats.length ? setTimeout(rebuildUnseen, FADE_MS + 100) : null;
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
    /** 'night' (quieter company) or 'day'; a pair on screen keeps its poses until the layer next fades out. */
    setMood(next) {
      const value = next === 'night' ? 'night' : 'day';
      if (value === mood) return;
      mood = value;
      layerEl.dataset.mood = mood;
      if (active && visible) scheduleAction();
      else if (cats.length && rebuildTimer === null) build(); // already faded out: choose the next pair now, unseen
    },
    destroy() {
      clearTimeout(rebuildTimer);
      clearTimeout(actionTimer);
      layerEl.replaceChildren();
      cats = [];
    },
  };
}
