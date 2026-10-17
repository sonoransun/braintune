// Visiting cats (plan §7.8): a spawn loop on the ledge, placement clear of the controls, petting with hearts,
// Still mode, and frozen timers while the sheet is expanded or the tab is hidden. DOM code: document, timers and
// the Web Animations API are used directly; every random draw comes from the injected rng and scheduler.
import { CAT_CONFIG, placeCat, rectsIntersect } from '../core/cat-model.js';
import { catLabel, catSvg, coatVars } from '../core/cat-art.js';
import { STRINGS, fill } from '../core/microcopy.js';
import { randRange } from '../core/rng.js';

/** Button box per pose in CSS px (the 120×100 art fits inside) and the share of the height that sits above the ledge line. */
export const CAT_SIZES = Object.freeze({
  sit: Object.freeze({ w: 96, h: 80, foot: 1 }),
  loaf: Object.freeze({ w: 108, h: 90, foot: 0.895 }),
  walk: Object.freeze({ w: 114, h: 95, foot: 0.88 }),
  sleep: Object.freeze({ w: 108, h: 90, foot: 0.9 }),
});

const ART_W = 120;
const ART_H = 100;
const SVG_NS = 'http://www.w3.org/2000/svg';
const PLACE_MARGIN_PX = 8;
const TAP_SLOP_PX = 8;
const PET_GAP_MS = 350; // one pet per 350 ms per cat keeps the one-shots under 3/s (§7.9)
const BLINK_MS = 180;
const TILT_MS = 400;
const HAPPY_MS = 1200;
const PURR_LABEL_MS = 2000;
const HEART_MS = 1400;
const HEART_STAGGER_MS = 120;
const HEART_COLOURS = ['#FF8FA3', '#FFB3C1', '#FFD1DC'];
const HEART_SIZE_PX = [10, 14];
const HEART_RISE_PX = [36, 48];

const aboveLedge = (size) => Math.round(size.h * size.foot);
const round2 = (v) => Math.round(v * 100) / 100;
const numberAttr = (el, name) => Number(el.getAttribute(name));

/** 'A orange tabby…' → 'An orange tabby…': the petting template opens with the article and the coat word decides it. */
const withArticle = (text) => text.replace(/^A (?=[aeiou])/i, 'An ');

/** One-shot timer that counts only while running: pause() keeps the remaining time, start() continues it. */
function pausableTimeout(fn, ms) {
  let remaining = ms;
  let startedAt = 0;
  let handle = null;
  let done = false;
  const timer = {
    start() {
      if (done || handle !== null) return;
      startedAt = performance.now();
      handle = setTimeout(() => {
        handle = null;
        done = true;
        fn();
      }, Math.max(0, remaining));
    },
    pause() {
      if (handle === null) return;
      clearTimeout(handle);
      handle = null;
      remaining -= performance.now() - startedAt;
    },
    extend(extraMs) {
      const wasRunning = handle !== null;
      timer.pause();
      remaining += extraMs;
      if (wasRunning) timer.start();
    },
    cancel() {
      timer.pause();
      done = true;
    },
    remainingMs: () => (handle === null ? remaining : remaining - (performance.now() - startedAt)),
  };
  return timer;
}

/** Adds a hidden happy-eye arc beside each open eye, drawn from that eye's own geometry (sleeping eyes stay as they are). */
function addHappyEyes(el) {
  for (const eye of el.querySelectorAll('g.cat__eye')) {
    const sclera = eye.querySelector('.cat__sclera');
    const [cx, cy, rx, ry] = ['cx', 'cy', 'rx', 'ry'].map((name) => numberAttr(sclera, name));
    const arc = document.createElementNS(SVG_NS, 'path');
    arc.setAttribute('class', 'cat__happy');
    arc.setAttribute('d', `M${round2(cx - rx)} ${round2(cy + ry * 0.3)}Q${round2(cx)} ${round2(cy - ry * 1.3)} ${round2(cx + rx)} ${round2(cy + ry * 0.3)}`);
    arc.setAttribute('fill', 'none');
    arc.setAttribute('stroke', eye.querySelector('.cat__pupil').getAttribute('fill'));
    arc.setAttribute('stroke-width', '1.6');
    arc.setAttribute('stroke-linecap', 'round');
    eye.after(arc);
  }
}

/** Mounts the cat layer; see the integration contract for the deps and the returned controls. */
export function createCats(layerEl, deps) {
  const { rng, scheduler, store, announce, engine, haptic, isStill, getLedge, getAvoidRects, getViewport, onPet } = deps;
  const cats = []; // in arrival order; exiting cats stay until their fade ends
  const timers = new Set(); // every pausable timer, so the expanded sheet and a hidden tab can freeze them all
  const context = { playing: false, band: null, purr: 0, presetId: null };
  let started = false;
  let enabled = true;
  let visible = true;
  let firstEver = true;
  let arrival = null;
  let companionTimer = null;
  let lastCallAt = -Infinity;
  let press = null;

  const paused = () => document.hidden || !visible;
  const still = () => Boolean(isStill?.());
  const active = () => cats.filter((cat) => !cat.exiting);
  const purringLabel = (cat) => withArticle(fill(STRINGS.cats.petting, { coat: STRINGS.cats.coats[cat.coat] }));

  // --- timers ------------------------------------------------------------------------------------------------

  function after(ms, fn) {
    const timer = pausableTimeout(() => {
      timers.delete(timer);
      fn();
    }, ms);
    timers.add(timer);
    if (!paused()) timer.start();
    return timer;
  }

  function drop(timer) {
    if (!timer) return;
    timer.cancel();
    timers.delete(timer);
  }

  function syncPause() {
    const halt = paused();
    for (const timer of timers) (halt ? timer.pause() : timer.start());
    for (const cat of cats) if (cat.walk) (halt ? cat.walk.pause() : cat.walk.play());
  }

  // --- arrivals ----------------------------------------------------------------------------------------------

  function arrivalContext(playing) {
    return { playing, firstEver, presetId: context.presetId };
  }

  function scheduleArrival() {
    drop(arrival);
    arrival = started && enabled ? after(scheduler.nextArrivalDelay(arrivalContext(context.playing)), onArrival) : null;
  }

  function onArrival() {
    firstEver = false;
    const leader = trySpawn();
    if (leader) scheduleCompanion(leader);
    scheduleArrival();
  }

  /** Cats come in company: a lone arrival brings a friend a moment later; walkers are chased across. */
  function scheduleCompanion(leader) {
    const delay = scheduler.companionDelay?.(active().length);
    if (delay === null || delay === undefined) return;
    drop(companionTimer);
    companionTimer = after(delay, () => {
      companionTimer = null;
      if (!enabled || !started || leader.exiting) return;
      const plan = scheduler.companion(leader.plan, planContext(active().length));
      const friend = plan ? spawn(plan) : null;
      if (friend && plan.frolic) leader.el.dataset.frolic = 'true';
    });
  }

  function dropCompanion() {
    drop(companionTimer);
    companionTimer = null;
  }

  /** Play pressed while a visit is pending: keep the shorter of the current wait and a fresh playing-table draw. */
  function hurryArrival() {
    if (!arrival) return;
    const fresh = scheduler.nextArrivalDelay(arrivalContext(true));
    if (arrival.remainingMs() > fresh) {
      drop(arrival);
      arrival = after(fresh, onArrival);
    }
  }

  function planContext(activeCount) {
    return {
      playing: context.playing,
      purr: context.purr,
      presetId: context.presetId,
      still: still(),
      viewport: getViewport(),
      layout: document.documentElement.dataset.layout,
      activeCount,
    };
  }

  function trySpawn() {
    if (!enabled || paused()) return null;
    const plan = scheduler.plan(planContext(active().length));
    return plan ? spawn(plan) : null;
  }

  // --- placement ---------------------------------------------------------------------------------------------

  function occupiedRects(except) {
    return cats
      .filter((cat) => cat !== except && cat.pose !== 'walk')
      .map((cat) => ({ x: cat.x, y: cat.y, w: cat.size.w, h: aboveLedge(cat.size) }));
  }

  function findSpot(plan, except = null) {
    const ledge = getLedge();
    if (!ledge) return null;
    const size = CAT_SIZES[plan.pose];
    return placeCat({
      plan,
      viewport: getViewport(),
      ledge,
      avoid: [...getAvoidRects(), ...occupiedRects(except)],
      size: { w: size.w, h: aboveLedge(size) },
      rng,
      margin: PLACE_MARGIN_PX,
    });
  }

  function fits(cat, ledge, avoid) {
    const rect = { x: cat.x, y: ledge.y - aboveLedge(cat.size), w: cat.size.w, h: aboveLedge(cat.size) };
    if (rect.x < ledge.x0 || rect.x + rect.w > ledge.x1) return false;
    return !avoid.some((other) => rectsIntersect(rect, other, PLACE_MARGIN_PX));
  }

  function moveTo(cat, x, y) {
    cat.x = x;
    cat.y = y;
    cat.el.style.setProperty('--x', `${Math.round(x)}px`);
    cat.el.style.setProperty('--y', `${Math.round(y)}px`);
  }

  // --- cat lifecycle -----------------------------------------------------------------------------------------

  function buildElement(plan, size) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'cat';
    el.tabIndex = -1;
    el.dataset.pose = plan.pose;
    el.dataset.coat = plan.coat;
    if (plan.frolic) el.dataset.frolic = 'true';
    el.setAttribute('aria-label', catLabel(plan.pose, plan.coat));
    el.innerHTML = catSvg({ pose: plan.pose, coat: plan.coat, flip: plan.flip });
    addHappyEyes(el);
    for (const [name, value] of Object.entries(coatVars(plan.coat))) el.style.setProperty(name, value);
    el.style.setProperty('--w', `${size.w}px`);
    el.style.setProperty('--h', `${size.h}px`);
    return el;
  }

  function spawn(plan) {
    const spot = findSpot(plan);
    if (!spot) return null;
    const size = CAT_SIZES[plan.pose];
    const cat = {
      plan, pose: plan.pose, coat: plan.coat, flip: plan.flip, size,
      el: buildElement(plan, size), x: 0, y: 0, exiting: false, petted: false, lastPetAt: -Infinity,
      dwell: null, blink: null, walk: null, label: null,
    };
    moveTo(cat, spot.x, spot.y);
    cats.push(cat);
    layerEl.append(cat.el);
    void cat.el.offsetWidth; // commit the hidden start state so the entrance transition runs
    cat.el.classList.add('is-present');
    if (plan.pose === 'walk') startWalk(cat);
    else cat.dwell = after(plan.dwellMs, () => exitCat(cat));
    scheduleBlink(cat);
    return cat;
  }

  function walkKeyframes(cat) {
    const { w } = cat.size;
    const vw = getViewport().w;
    const [from, to] = cat.flip ? [vw, -w] : [-w, vw];
    return { distance: Math.abs(to - from), frames: [{ transform: `translate(${from}px, ${cat.y}px)` }, { transform: `translate(${to}px, ${cat.y}px)` }] };
  }

  function startWalk(cat) {
    const { distance, frames } = walkKeyframes(cat);
    cat.walk = cat.el.animate(frames, { duration: (distance / cat.plan.speedPxPerS) * 1000, easing: 'linear', fill: 'forwards' });
    cat.walk.onfinish = () => removeCat(cat);
    if (paused()) cat.walk.pause();
  }

  function scheduleBlink(cat) {
    if (cat.pose === 'sleep') return;
    cat.blink = after(cat.plan.blinkEveryMs * randRange(rng, 0.7, 1.3), () => {
      cat.el.classList.add('is-blinking');
      after(BLINK_MS, () => cat.el.classList.remove('is-blinking'));
      scheduleBlink(cat);
    });
  }

  function blurIfFocused(el) {
    if (document.activeElement === el) el.blur(); // focus returns to body with no scroll jump (§9)
  }

  function exitCat(cat) {
    if (cat.exiting) return;
    cat.exiting = true;
    drop(cat.dwell);
    drop(cat.blink);
    blurIfFocused(cat.el);
    cat.el.classList.remove('is-present');
    cat.el.classList.add('is-exiting');
    cat.dwell = after(cat.plan.exitMs, () => removeCat(cat));
  }

  function removeCat(cat) {
    const index = cats.indexOf(cat);
    if (index >= 0) cats.splice(index, 1);
    for (const timer of [cat.dwell, cat.blink, cat.label]) drop(timer);
    cat.walk?.cancel();
    blurIfFocused(cat.el);
    cat.el.remove();
  }

  function relayout() {
    const ledge = getLedge();
    if (!ledge) return;
    const avoid = getAvoidRects();
    for (const cat of cats.filter((c) => !c.exiting)) {
      if (cat.pose === 'walk') {
        if (still()) exitCat(cat);
        else relayoutWalker(cat, ledge);
      } else if (fits(cat, ledge, avoid)) {
        moveTo(cat, cat.x, ledge.y - aboveLedge(cat.size));
      } else {
        const spot = findSpot(cat.plan, cat);
        if (spot) moveTo(cat, spot.x, spot.y);
        else exitCat(cat);
      }
    }
  }

  function relayoutWalker(cat, ledge) {
    moveTo(cat, cat.x, ledge.y - aboveLedge(cat.size));
    cat.walk?.effect.setKeyframes(walkKeyframes(cat).frames);
  }

  // --- petting -----------------------------------------------------------------------------------------------

  function headAnchor(cat) {
    const face = cat.el.querySelector('.cat__face');
    const fx = numberAttr(face, 'cx') / ART_W;
    const top = (numberAttr(face, 'cy') - numberAttr(face, 'r')) / ART_H;
    return { x: (cat.flip ? 1 - fx : fx) * cat.size.w, y: top * cat.size.h };
  }

  function spawnHearts(cat) {
    const anchor = headAnchor(cat);
    const count = Math.floor(randRange(rng, 3, 6));
    for (let i = 0; i < count; i += 1) {
      const heart = document.createElement('span');
      heart.className = 'cat__heart';
      heart.setAttribute('aria-hidden', 'true');
      heart.style.setProperty('--hx', `${Math.round(anchor.x + randRange(rng, -14, 14))}px`);
      heart.style.setProperty('--hy', `${Math.round(anchor.y + randRange(rng, -4, 4))}px`);
      heart.style.setProperty('--size', `${Math.round(randRange(rng, ...HEART_SIZE_PX))}px`);
      heart.style.setProperty('--rise', `${Math.round(randRange(rng, ...HEART_RISE_PX))}px`);
      heart.style.setProperty('--delay', `${i * HEART_STAGGER_MS}ms`);
      heart.style.setProperty('--heart', HEART_COLOURS[Math.floor(rng() * HEART_COLOURS.length)]);
      cat.el.append(heart);
      after(HEART_MS + i * HEART_STAGGER_MS + 100, () => heart.remove());
    }
  }

  function showAffection(cat) {
    const { el } = cat;
    el.classList.add('is-happy', 'is-tilting');
    after(TILT_MS, () => el.classList.remove('is-tilting'));
    after(HAPPY_MS, () => el.classList.remove('is-happy'));
    spawnHearts(cat);
    el.setAttribute('aria-label', purringLabel(cat));
    drop(cat.label);
    cat.label = after(PURR_LABEL_MS, () => el.setAttribute('aria-label', catLabel(cat.pose, cat.coat)));
  }

  function countSpotted() {
    const spotted = (store.get().cats?.spotted ?? 0) + 1;
    store.set('cats.spotted', spotted);
    onPet?.(spotted);
  }

  function pet(cat) {
    const now = performance.now();
    if (cat.exiting || now - cat.lastPetAt < PET_GAP_MS) return;
    cat.lastPetAt = now;
    showAffection(cat);
    engine?.purrCue?.();
    haptic?.('pet');
    cat.dwell?.extend(CAT_CONFIG.afterPetExtraMs);
    if (!cat.petted) {
      cat.petted = true;
      countSpotted();
    }
  }

  function catFromEvent(event) {
    const el = event.target instanceof Element ? event.target.closest('.cat') : null;
    return el ? (cats.find((cat) => cat.el === el) ?? null) : null;
  }

  function onPointerDown(event) {
    const cat = catFromEvent(event);
    press = cat ? { cat, id: event.pointerId, x: event.clientX, y: event.clientY } : null;
  }

  /** A tap that barely moved pets even where the browser swallows the click; the click that follows is deduped by PET_GAP_MS. */
  function onPointerUp(event) {
    const start = press;
    press = null;
    if (!start || start.id !== event.pointerId || catFromEvent(event) !== start.cat) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < TAP_SLOP_PX) pet(start.cat);
  }

  function onClick(event) {
    const cat = catFromEvent(event);
    if (cat) pet(cat);
  }

  // --- public controls ---------------------------------------------------------------------------------------

  function start() {
    if (started) return;
    started = true;
    scheduleArrival();
  }

  function stop() {
    started = false;
    drop(arrival);
    arrival = null;
    dropCompanion();
  }

  function setEnabled(on) {
    if (enabled === Boolean(on)) return;
    enabled = Boolean(on);
    if (enabled) {
      scheduleArrival();
      return;
    }
    drop(arrival);
    arrival = null;
    dropCompanion();
    for (const cat of [...cats]) exitCat(cat);
  }

  function setVisible(on) {
    visible = Boolean(on);
    layerEl.classList.toggle('is-hidden', !visible);
    syncPause();
  }

  function setContext(patch) {
    const wasPlaying = context.playing;
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) context[key] = value;
    if (!wasPlaying && context.playing) hurryArrival();
  }

  function call() {
    const now = performance.now();
    const ready = enabled && now - lastCallAt >= CAT_CONFIG.callCooldownMs;
    const cat = ready ? trySpawn() : null;
    if (cat) {
      lastCallAt = now;
      scheduleCompanion(cat);
    }
    if (cat || active().length === 0) announce?.(cat ? STRINGS.cats.called : STRINGS.cats.none);
    return Boolean(cat);
  }

  function petNewest() {
    const cat = active().at(-1);
    if (!cat) return false;
    pet(cat);
    announce?.(purringLabel(cat));
    return true;
  }

  /** A plan with the requested pose/coat, keeping the walk speed or dwell consistent with the pose. */
  function planFor(pose, coat) {
    const drawn = scheduler.plan(planContext(0));
    const plan = { ...drawn, pose: pose ?? drawn.pose, coat: coat ?? drawn.coat };
    if (plan.pose === 'walk') plan.speedPxPerS ??= (CAT_CONFIG.walkSpeedPxPerS[0] + CAT_CONFIG.walkSpeedPxPerS[1]) / 2;
    else if (drawn.pose === 'walk') plan.dwellMs = Math.round(randRange(rng, ...CAT_CONFIG.dwellMs[plan.pose]));
    return plan;
  }

  function spawnNow(pose, coat) {
    return spawn(planFor(pose, coat))?.el ?? null;
  }

  function destroy() {
    stop();
    motionObserver.disconnect();
    document.removeEventListener('visibilitychange', syncPause);
    layerEl.removeEventListener('pointerdown', onPointerDown);
    layerEl.removeEventListener('pointerup', onPointerUp);
    layerEl.removeEventListener('click', onClick);
    for (const cat of [...cats]) removeCat(cat);
    for (const timer of timers) timer.cancel();
    timers.clear();
    layerEl.classList.remove('is-hidden');
  }

  // Still mode switched on mid-walk: walkers leave (relayout retires them) instead of crossing for up to 18 s more.
  const motionObserver = new MutationObserver(relayout);
  motionObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  document.addEventListener('visibilitychange', syncPause);
  layerEl.addEventListener('pointerdown', onPointerDown);
  layerEl.addEventListener('pointerup', onPointerUp);
  layerEl.addEventListener('click', onClick);

  return { start, stop, setEnabled, setVisible, setContext, call, petNewest, onLayoutChange: relayout, spawnNow, destroy };
}
