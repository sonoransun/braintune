// Mediator (plan §5, v0.4 spec §5): store → engine / scene / cats / UI, engine → scene (wave rolls, slow texture),
// <html> attributes, media-query listeners, the night dim's deep stage, service worker registration and the
// window.__braintune debug hooks. The audio, scene and cats modules load dynamically and the page degrades
// gracefully without any of them.

import { createStore, parse, startPlan, STORAGE_KEY } from './core/state.js';
import { STRINGS } from './core/microcopy.js';
import { getPreset, DEFAULT_PRESET_ID } from './core/presets.js';
import { mulberry32 } from './core/rng.js';
import { bandPalette } from './core/palette.js';
import { pickQuality } from './core/scene-model.js';
import { createCatScheduler } from './core/cat-model.js';
import { APP_VERSION } from './version.js';
import { registerServiceWorker, resetBraintune } from './sw-register.js';
import { createSheet } from './ui/sheet.js';
import { createAnnouncer, haptic } from './ui/feedback.js';
import { mountUI, settingsBand } from './ui/ui.js';

const LAYERS = ['tone', 'rain', 'ocean', 'purr'];
const SOUNDING = new Set(['starting', 'playing', 'ambient', 'ending']);
const PALETTE_FADE_MS = 2500;
/** The deep night-dim stage fades the canvas over 2 s; held this long, the scene stops on its last frame. */
const DEEP_DIM_STOP_MS = 2100;
/** Loops are generated this long after load, once the first frame is up, when a session may start soon. */
const PREWARM_DELAY_MS = 300;
const RESIZE_DEBOUNCE_MS = 150;
const MIN_TARGET_PX = 44;
const INTERACTIVE = 'a[href], button, input, select, textarea, [role="button"], [role="switch"], [tabindex]:not([tabindex="-1"])';
const QUERIES = {
  desktop: '(min-width: 1024px)',
  short: '(orientation: landscape) and (max-height: 520px)',
  coarse: '(pointer: coarse)',
  reducedMotion: '(prefers-reduced-motion: reduce)',
  light: '(prefers-color-scheme: light)',
};

const now = () => Date.now();
const setTimer = (fn, ms) => setTimeout(fn, ms);
const clearTimer = (id) => clearTimeout(id);
const $ = (id) => document.getElementById(id);

/** localStorage when it works, else a Storage look-alike that throws so the store stays in memory and reports it. */
function safeStorage() {
  try {
    const storage = window.localStorage;
    const probe = '__braintune_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    const unavailable = () => {
      throw new Error('storage unavailable');
    };
    return { getItem: unavailable, setItem: unavailable, removeItem: unavailable, key: unavailable, length: 0 };
  }
}

/** Runs fn and turns an exception into one console.warn (a module from another layer failing must not stop the page). */
function guard(label, fn, fallback = null) {
  try {
    return fn();
  } catch (error) {
    console.warn(`Brain Tune: ${label} failed`, error);
    return fallback;
  }
}

function fallbackPlatform() {
  return {
    coarse: matchMedia(QUERIES.coarse).matches,
    hasAudioSession: 'audioSession' in navigator,
    hasWakeLock: 'wakeLock' in navigator,
    hasVibrate: 'vibrate' in navigator,
    standalone: matchMedia('(display-mode: standalone)').matches,
  };
}

/** Visible interactive elements whose box is under 44×44 CSS px (chip and option radios are measured by their label). */
function touchTargets() {
  return [...document.querySelectorAll(INTERACTIVE)]
    .map((el) => (el.matches('input[type="radio"]') ? el.closest('label') ?? el : el))
    .filter((el, i, list) => list.indexOf(el) === i && !el.closest('[hidden], [inert]') && getComputedStyle(el).visibility !== 'hidden')
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.width > 0 && rect.height > 0 && (rect.width < MIN_TARGET_PX || rect.height < MIN_TARGET_PX))
    .map(({ el, rect }) => ({ element: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}`, width: Math.round(rect.width), height: Math.round(rect.height) }));
}

/** Service worker registration (or the ?nosw kill switch) at load; toasts go through the UI once it is mounted (it holds a sticky one back at night). */
function scheduleWorkerRegistration(notify) {
  const register = () => registerServiceWorker({
    onOfflineReady: () => notify({ id: 'offline', text: STRINGS.toasts.offlineReady }),
    onUpdateReady: (apply) => notify({ id: 'update', text: STRINGS.toasts.updateReady.text, sticky: true, action: { label: STRINGS.toasts.updateReady.action, onAction: apply } }),
  });
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

async function main() {
  const root = document.documentElement;
  let ui = null;
  scheduleWorkerRegistration((toast) => ui?.notify(toast));
  const store = createStore(safeStorage(), { debounceMs: 250, setTimer, clearTimer });
  const mq = Object.fromEntries(Object.entries(QUERIES).map(([name, query]) => [name, matchMedia(query)]));
  const [{ createEngine } = {}, lifecycle = {}, { createScene } = {}, { createCats } = {}, { createToonLayer } = {}] = await Promise.all([
    import('./audio/engine.js').catch(() => ({})),
    import('./audio/lifecycle.js').catch(() => ({})),
    import('./scene/scene.js').catch(() => ({})),
    import('./cats/cats.js').catch(() => ({})),
    import('./cats/toon.js').catch(() => ({})),
  ]);
  const platform = guard('detectPlatform', () => lifecycle.detectPlatform?.(), null) ?? fallbackPlatform();
  const rng = mulberry32((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0);
  const themeMeta = document.querySelector('meta[name="theme-color"]');

  const moodOf = (s) => (getPreset(s.presetId) ?? getPreset(DEFAULT_PRESET_ID)).mood;
  const layoutName = () => (mq.desktop.matches ? 'desktop' : mq.short.matches ? 'short' : 'phone');
  const stillNow = (s = store.get()) => s.motion === 'still' || (s.motion === 'auto' && mq.reducedMotion.matches);
  const themeNow = (s = store.get()) => (s.theme === 'auto' ? (mq.light.matches ? 'light' : 'dark') : s.theme);
  const viewport = () => ({ w: window.innerWidth, h: window.innerHeight });
  const quality = (s) => pickQuality({
    width: window.innerWidth, dpr: window.devicePixelRatio, deviceMemory: navigator.deviceMemory,
    hardwareConcurrency: navigator.hardwareConcurrency, coarse: platform.coarse,
    saveData: Boolean(navigator.connection?.saveData), motion: stillNow(s) ? 'still' : 'full', scene: s.scene,
  });

  // --- services ----------------------------------------------------------------------------------------------
  const engine = createEngine ? guard('createEngine', () => createEngine({ settings: store.get(), now, setTimer, clearTimer, rng })) : null;
  if (engine) guard('installLifecycle', () => lifecycle.installLifecycle?.(engine));
  const sheet = createSheet({
    root, stageEl: document.querySelector('.stage'), panelEl: $('panel'), miniControlsEl: $('mini-controls'),
    orbEl: $('orb'), sentinelEl: $('sheet-sentinel'), handleEl: $('handle'), win: window,
  });
  const announcer = createAnnouncer($('live-a'), $('live-b'), { now });
  const canvas = $('scene');
  const scene = createScene && canvas?.getContext
    ? guard('createScene', () => createScene(canvas, { quality: quality(store.get()), rng, now: () => performance.now() }))
    : null;
  let playing = false;
  const cats = createCats
    ? guard('createCats', () => createCats($('cats'), {
      rng, scheduler: createCatScheduler({ rng }), store, announce: announcer.announce, engine,
      haptic: (kind) => haptic(kind, { enabled: store.get().haptics, nav: navigator }),
      isStill: () => stillNow(), getLedge: sheet.ledge, getAvoidRects: sheet.avoidRects, getViewport: viewport,
      onPet: (total) => ui?.onPet(total),
    }))
    : null;
  const toon = createToonLayer && $('toon') ? guard('createToonLayer', () => createToonLayer($('toon'), { rng })) : null;

  /** The scene, and the cell-shaded cats behind the controls, compose into the visible stage. */
  function setStage() {
    const rect = sheet.stageRect();
    scene?.setStageRect(rect);
    toon?.setStageRect(rect);
  }

  // --- store → everything ------------------------------------------------------------------------------------
  function applyAttributes(s) {
    root.dataset.layout = layoutName();
    root.dataset.pointer = mq.coarse.matches ? 'coarse' : 'fine';
    root.dataset.theme = themeNow(s);
    root.dataset.band = settingsBand(s);
    root.dataset.motion = stillNow(s) ? 'still' : 'full';
    root.dataset.scene = s.scene;
    root.dataset.cats = s.cats.enabled ? 'on' : 'off';
  }

  function applyPalette(s) {
    const band = settingsBand(s);
    const theme = themeNow(s);
    const palette = bandPalette(band, theme);
    if (themeMeta) themeMeta.content = palette.skyTop;
    scene?.setPalette(palette, PALETTE_FADE_MS, { band, theme });
  }

  function applyLevels(s) {
    if (engine) {
      guard('engine levels', () => {
        engine.setMaster(s.mix.master);
        for (const layer of LAYERS) {
          engine.setLayerLevel(layer, s.mix[layer]);
          engine.setMuted(layer, s.muted[layer]);
        }
      });
    }
    // On screen, rain density and wave size follow the Rainfall / Sea intensities; a muted or silent layer shows none.
    scene?.setRain(s.muted.rain || s.mix.rain <= 0 ? 0 : s.rainIntensity);
    scene?.setOcean(s.muted.ocean || s.mix.ocean <= 0 ? 0 : s.oceanIntensity);
  }

  function applyIntensities(s) {
    if (!engine) return;
    guard('engine intensities', () => {
      engine.setRainIntensity(s.rainIntensity);
      engine.setOceanIntensity(s.oceanIntensity);
    });
  }

  function applyMotion(s) {
    const still = stillNow(s);
    root.dataset.motion = still ? 'still' : 'full';
    ui?.setStill(still);
    scene?.setQuality(quality(s));
    scene?.setStill(still);
  }

  let sceneAsleep = false; // html[data-dim="deep"] has held for DEEP_DIM_STOP_MS: the canvas keeps its last frame
  let asleepTimer = null;

  function syncSceneRunning() {
    if (!scene) return;
    if (document.hidden || sheet.isExpanded() || sceneAsleep) scene.stop();
    else scene.start();
  }

  /** Night dim stage → scene: the deep stage stops the drawing once its fade has run; any other stage draws again. */
  function onDim(stage) {
    clearTimer(asleepTimer);
    asleepTimer = null;
    sceneAsleep = false;
    if (stage === 'deep') {
      asleepTimer = setTimer(() => {
        asleepTimer = null;
        sceneAsleep = true;
        syncSceneRunning();
      }, DEEP_DIM_STOP_MS);
    }
    syncSceneRunning();
  }

  function applyCats(s) {
    // Cell-shaded cats frolic in the background whenever a purr is audible; quieter company in the sleepy presets.
    toon?.setMood(moodOf(s) === 'sleepy' ? 'night' : 'day');
    toon?.setActive(playing && s.cats.enabled && !s.muted.purr && s.mix.purr > 0 && s.mix.master > 0);
    if (!cats) return;
    cats.setEnabled(s.cats.enabled);
    cats.setContext({ playing, band: settingsBand(s), purr: s.muted.purr ? 0 : s.mix.purr, presetId: s.presetId });
  }

  store.subscribe((keys, s) => {
    const has = (key) => keys.includes(key);
    applyAttributes(s);
    if (has('presetId') || has('custom') || has('theme')) applyPalette(s);
    if (has('mix') || has('muted') || has('rainIntensity') || has('oceanIntensity')) applyLevels(s);
    if (has('rainIntensity') || has('oceanIntensity')) applyIntensities(s);
    if (has('motion') || has('scene')) applyMotion(s);
    if (has('presetId') || has('custom') || has('mix') || has('muted') || has('cats')) applyCats(s);
  });

  // --- engine → scene / cats ---------------------------------------------------------------------------------
  if (engine) {
    engine.on('wave', ({ inMs = 0, duration, strength }) => scene?.rollWave(performance.now() + inMs, duration, strength));
    engine.on('texture', ({ inMs = 0, pad, gust, set }) => scene?.setTexture({ pad, gust, set }, performance.now() + inMs));
    engine.on('state', ({ state }) => {
      playing = SOUNDING.has(state);
      applyCats(store.get());
    });
  }

  // --- sheet, layout, media, lifecycle -----------------------------------------------------------------------
  function relayout() {
    root.dataset.layout = layoutName();
    root.dataset.pointer = mq.coarse.matches ? 'coarse' : 'fine';
    sheet.refresh();
    scene?.resize();
    setStage();
    cats?.onLayoutChange();
    syncSceneRunning();
  }
  let resizeHandle = null;
  let scrollFrame = 0;
  sheet.onChange((expanded) => {
    setStage();
    cats?.setVisible(!expanded);
    toon?.setVisible(!expanded);
    syncSceneRunning();
  });
  window.addEventListener('resize', () => {
    clearTimer(resizeHandle);
    resizeHandle = setTimer(relayout, RESIZE_DEBOUNCE_MS);
  });
  window.addEventListener('scroll', () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      setStage();
    });
  }, { passive: true });
  mq.desktop.addEventListener('change', relayout);
  mq.short.addEventListener('change', relayout);
  mq.coarse.addEventListener('change', relayout);
  mq.reducedMotion.addEventListener('change', () => applyMotion(store.get()));
  mq.light.addEventListener('change', () => {
    applyAttributes(store.get());
    applyPalette(store.get());
  });
  document.addEventListener('visibilitychange', syncSceneRunning);
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY && e.newValue) store.patch(parse(e.newValue));
  });
  window.addEventListener('pagehide', () => store.flush());

  // --- mount -------------------------------------------------------------------------------------------------
  const initial = store.get();
  applyAttributes(initial);
  ui = mountUI(root, {
    store, engine, scene, cats, platform, lifecycle, sheet, announcer, version: APP_VERSION, now, setTimer, clearTimer, onDim,
    resetSite: () => resetBraintune({ storage: safeStorage() }),
  });
  applyPalette(initial);
  applyLevels(initial);
  applyIntensities(initial);
  applyMotion(initial);
  applyCats(initial);
  setStage();
  syncSceneRunning();
  cats?.start();
  root.dataset.ready = 'true';
  // No AudioContext before a gesture (v0.4 D3): when a session may start soon, only the noise loops are generated.
  if (engine && (initial.autoplay || startPlan(initial, now()).kind === 'resume')) setTimer(() => guard('prewarm', () => engine.prewarm()), PREWARM_DELAY_MS);

  window.__braintune = {
    version: APP_VERSION,
    store,
    audio: {
      state: () => engine?.getState().state ?? 'unavailable',
      levels: () => engine?.getLevels() ?? null,
      meter: (layer) => engine?.meter?.(layer) ?? null,
      rebuild: () => engine?.rebuild(),
      get firstSoundMs() {
        return ui.firstSoundMs();
      },
    },
    visuals: {
      frameRate: () => scene?.frameRate() ?? 0,
      luminanceTrace: (seconds) => scene?.luminanceTrace(seconds) ?? Promise.resolve(null),
    },
    cats: { toonActive: () => document.getElementById('toon')?.classList.contains('is-active') ?? false, spawnNow: (pose, coat) => cats?.spawnNow(pose, coat) },
    audit: { touchTargets },
  };
}

main();
