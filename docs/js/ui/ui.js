// mountUI (plan §5, §7; v0.4 spec §5): every control ↔ store, engine events → orb / status / mini / title / live
// regions, and the session flows (first Play inside the click, the left/right check before a first headphones
// session, timer, attune, Play on open with its caption and first-gesture start, the resume offer, the blocked /
// interrupted veil, toasts held back at night).

import { STRINGS, fill, statusLine, formatHz, formatPitch, formatPercent, formatMinutes, formatRainfall, formatSea, limitationsCopy } from '../core/microcopy.js';
import { PRESETS, getPreset, resolvePreset, canonFor, suggestPreset, TIMER_OPTIONS, DEFAULT_PRESET_ID } from '../core/presets.js';
import { bandOf, recommendMode, recommendCarrier } from '../core/entrainment.js';
import { gateParams } from '../core/gate.js';
import { parse, startPlan } from '../core/state.js';
import { shouldDeferToast } from '../core/toast-queue.js';
import { POSES, COATS, catSvg, coatVars, catLabel } from '../core/cat-art.js';
import { createOrb } from './orb.js';
import { createToaster } from './toast.js';
import { createFirstRun } from './firstrun.js';
import { haptic } from './feedback.js';
import { installShortcuts } from './shortcuts.js';
import { createNightDim } from './nightdim.js';
import { bindRadioGroup, bindSlider, bindSwitch, bindDisclosure, bindStepper } from './controls.js';

const LAYERS = ['tone', 'rain', 'ocean', 'purr'];
const SOUNDING = new Set(['starting', 'playing', 'ambient', 'ending']);
const PAUSED = new Set(['paused', 'pausing']);
const CAT_MILESTONES = new Set([1, 10, 25, 50, 100]);
const THEMES = ['dark', 'light', 'auto'];
const PRESET_ICONS = { sleep: 'i-moon', deep: 'i-deep', rest: 'i-cloud', meditate: 'i-circle', catnap: 'i-paw', calm: 'i-wave', focus: 'i-target', energise: 'i-bolt', clarity: 'i-sparkle' };
const FIVE_MIN = 5 * 60000;
const ONE_MIN = 60000;
/** Seconds a preset change glides over; the engine starts a preset's beat glide after it. */
const APPLY_GLIDE_S = 2;
/** The Restart sound link fades in once sound has played this long. */
const RESTART_REVEAL_MS = 20000;
/** The left/right check: each tone lasts 1.5 s and the right one starts 2 s after the left. */
const STEREO_TOAST_MS = 1500;
const STEREO_RIGHT_AT_MS = 2000;
/** Controls whose tap is itself the start of a waiting session, and the switch that turns Play on open off instead. */
const START_BUTTONS = '#orb, #mini-toggle';
const AUTOPLAY_SWITCH = '#autoplay';
const SVG_NS = 'http://www.w3.org/2000/svg';

const pct = (x01) => Math.round(x01 * 100);
const minutesLeft = (ms) => formatMinutes(Math.max(1, Math.ceil(ms / 60000)));

/** Band of the active sound: the custom beat's band when fine tuning is in use, else the preset's. */
export function settingsBand(s) {
  if (s.custom) return bandOf(s.custom.beatHz);
  return (getPreset(s.presetId) ?? getPreset(DEFAULT_PRESET_ID)).band;
}

const activePreset = (s) => getPreset(s.presetId) ?? getPreset(DEFAULT_PRESET_ID);
const presetName = (s) => (s.custom ? STRINGS.presets.custom : activePreset(s).name);
const beatOf = (s) => s.custom?.beatHz ?? activePreset(s).beatHz;

/** Engine parameters for the current settings: the preset resolved for the listening setup and pad style, with custom fine tuning on top. */
function resolveSettings(s, platform) {
  const device = platform?.coarse ? 'phone' : 'desktop';
  const preset = activePreset(s);
  const base = resolvePreset(preset, { listening: s.listening, device, override: s.custom?.mode ?? 'auto', padStyle: s.padStyle });
  if (!s.custom) return base;
  const { beatHz, carrierHz, timbre, pad, mode: override } = s.custom;
  const mode = recommendMode({ listening: s.listening, beatHz, override });
  const carrier = recommendCarrier({ presetCarrierHz: carrierHz, mode, device, listening: s.listening });
  const canon = pad && canonFor(s.padStyle, preset);
  return { ...base, mode, beatHz, carrierHz: carrier, gate: gateParams(beatHz, { gentle: base.gentle }), timbre, pad, canon, glide: null };
}

/** Timer minutes for the active preset: the per-preset override when set (0 = none), else the preset default. */
function timerMinutesFor(s) {
  const override = s.timer.byPreset[s.presetId];
  return override === undefined || override === null ? activePreset(s).timerMinutes : override;
}

/** Mounts the UI over the sheet and announcer app.js created; returns { destroy, onPet, setStill, firstSoundMs, notify }. */
export function mountUI(root, options) {
  const { store, engine = null, scene = null, cats = null, platform = {}, lifecycle = {}, sheet, announcer, version = '', resetSite = null, onDim = null } = options;
  const now = options.now ?? (() => Date.now());
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = options.clearTimer ?? ((id) => clearTimeout(id));
  const doc = root.ownerDocument ?? root;
  const win = doc.defaultView;
  const html = doc.documentElement;
  const $ = (id) => doc.getElementById(id);
  const disposers = [];
  const listen = (target, type, fn, opts) => {
    target.addEventListener(type, fn, opts);
    disposers.push(() => target.removeEventListener(type, fn, opts));
  };

  // --- shared services --------------------------------------------------------------------------------------
  let lastInputKeyboard = false;
  const deferredToasts = []; // sticky toasts held for the next touch or key press (shouldDeferToast)
  listen(doc, 'keydown', () => {
    lastInputKeyboard = true;
    flushDeferred();
  }, true);
  listen(doc, 'pointerdown', () => {
    lastInputKeyboard = false;
    flushDeferred();
  }, true);
  const toaster = createToaster($('toasts'), { now, setTimer, clearTimer, keyboardIntent: () => lastInputKeyboard });
  const buzz = (kind) => haptic(kind, { enabled: store.get().haptics, nav: win.navigator });
  /** Shows a toast, replacing any visible toast with the same id (a newer timer or listening message wins). */
  const toast = (id, text, extra = {}) => {
    toaster.dismiss(id);
    return notify({ id, text, ...extra });
  };

  if (new URLSearchParams(win.location.search).get('gallery') === 'cats') {
    renderGallery(doc, $('panel-inner'));
    return { destroy() {}, onPet() {}, setStill() {}, firstSoundMs: () => null, notify: (toastOptions) => toaster.show(toastOptions) };
  }

  // --- session state ----------------------------------------------------------------------------------------
  const returningVisitor = store.get().firstRunDone;
  let engineState = engine ? 'idle' : 'unavailable';
  let autoPending = false; // Play on open is waiting for the first tap or key press
  let beginning = false; // a begin() is between its gesture and engine.play()
  let startedByTap = null; // the click that started a waiting session on the orb or mini button (it must not also toggle)
  let remainingMs = null;
  let timerTotalMs = 0;
  let lastRemaining = Infinity;
  let attuning = false;
  let customTimerChosen = false;
  let playClickAt = null;
  let firstSoundMs = null;
  let mutedBeforeAll = null;
  let installPrompt = null;
  let glideEndsAt = null; // when the beat glide the engine is running reaches the preset's beat (wall clock, ms)
  let glideTimer = null;
  let restartTimer = null;

  const isSounding = () => SOUNDING.has(engineState);
  const timerOptions = (s, resolved) => ({ endFadeSeconds: resolved.endFadeSeconds, chime: resolved.chime, after: s.timer.after });

  /** Shows a toast now, or holds a sticky one back during a sleepy session or the night dim until the next touch or key press. */
  function notify(toastOptions) {
    const mood = isSounding() ? activePreset(store.get()).mood : null;
    const dimmed = html.dataset.dim === 'night' || html.dataset.dim === 'deep';
    if (shouldDeferToast({ sticky: toastOptions.sticky, mood, dimmed })) {
      deferredToasts.push(toastOptions);
      return false;
    }
    return toaster.show(toastOptions);
  }

  function flushDeferred() {
    for (const toastOptions of deferredToasts.splice(0)) toaster.show(toastOptions);
  }

  // --- elements ---------------------------------------------------------------------------------------------
  const statusEl = $('status');
  const subEl = $('sub');
  const timeLeftEl = $('time-left');
  const hintEl = $('hint');
  const sheetHintEl = $('sheet-hint');
  const restartEl = $('restart');
  const overlayEl = $('overlay');
  const overlayText = $('overlay-text');
  const miniToggle = $('mini-toggle');
  const miniStatus = $('mini-status');
  const miniTime = $('mini-time');
  const modeLabel = $('mode-label');
  const modeIcon = $('mode').querySelector('use');
  const gammaNote = $('gamma-note');
  const attuneButton = $('attune');
  const attuneCancel = $('attune-cancel');
  const stereoRow = $('stereo-row');
  const keepAwakeDesc = $('keep-awake-desc');
  const installRow = $('install-row');
  const installButton = $('install');
  const timerCustomEl = $('timer-custom');

  // --- orb, status, title -----------------------------------------------------------------------------------
  const orb = createOrb($('orb'), { onToggle: onOrbToggle, still: html.dataset.motion === 'still' });

  /** The preset's beat glide while the engine runs it: { fromHz, toHz, active }, else null (fine tuning has none). */
  function glideNow(s) {
    const glide = s.custom ? null : activePreset(s).glide;
    if (!glide || glideEndsAt === null || !isSounding()) return null;
    return { fromHz: glide.fromHz, toHz: activePreset(s).beatHz, active: now() < glideEndsAt };
  }

  /** The engine (re)starts a preset's beat glide on every session start and preset re-apply, after delayS. */
  function trackGlide(delayS) {
    const s = store.get();
    const glide = s.custom ? null : activePreset(s).glide;
    if (glideTimer !== null) clearTimer(glideTimer);
    glideTimer = null;
    glideEndsAt = glide ? now() + (delayS + glide.minutes * 60) * 1000 : null;
    if (glide) {
      glideTimer = setTimer(() => {
        glideTimer = null;
        render();
      }, glideEndsAt - now());
    }
  }

  function currentLine(mark = null) {
    const s = store.get();
    return statusLine(engineState, {
      presetName: presetName(s), beatHz: beatOf(s), band: settingsBand(s), listening: s.listening,
      remainingMs, returning: returningVisitor, mark, glide: glideNow(s),
    });
  }

  function titleFor(s) {
    if (isSounding()) return fill(STRINGS.titles.playing, { preset: presetName(s), beat: formatHz(beatOf(s)) });
    return PAUSED.has(engineState) ? STRINGS.titles.paused : STRINGS.titles.idle;
  }

  /** The caption under the status while Play on open waits: begin the preset, or continue a stored session. */
  function waitingCaption(s) {
    const plan = startPlan(s, now());
    const name = (getPreset(plan.presetId) ?? activePreset(s)).name;
    if (plan.kind === 'resume') return fill(STRINGS.player.autoplayContinue, { preset: name, time: minutesLeft(plan.remainingMs) });
    return fill(STRINGS.player.autoplayOverlay, { preset: name });
  }

  function render() {
    const s = store.get();
    const line = currentLine();
    const sub = line.timeLeft && line.sub.endsWith(line.timeLeft) ? line.sub.slice(0, -line.timeLeft.length).trim() : line.sub;
    statusEl.textContent = line.status;
    subEl.textContent = sub;
    timeLeftEl.textContent = line.timeLeft ?? '';
    timeLeftEl.hidden = !line.timeLeft;
    miniStatus.textContent = line.status;
    miniTime.textContent = line.timeLeft ?? '';
    const label = attuning ? STRINGS.orb.attune : line.label;
    orb.setLabels({ label, attune: attuning });
    orb.setState(engineState);
    orb.setProgress(timerTotalMs > 0 && remainingMs !== null ? 1 - remainingMs / timerTotalMs : 0);
    orb.setTimerArmed(timerTotalMs > 0);
    orb.setWaiting(autoPending);
    miniToggle.setAttribute('aria-label', line.label);
    miniToggle.dataset.playing = String(isSounding());
    doc.title = titleFor(s);
    hintEl.hidden = !(autoPending || (s.hints.orb && engineState === 'idle'));
    hintEl.classList.toggle('hint--waiting', autoPending);
    hintEl.textContent = autoPending ? waitingCaption(s) : STRINGS.hints.orb;
    sheetHintEl.hidden = !s.hints.sheet;
    restartEl.hidden = !isSounding();
    overlayEl.hidden = !(engineState === 'blocked' || engineState === 'interrupted');
    overlayText.textContent = engineState === 'interrupted' ? STRINGS.player.interruptedOverlay : STRINGS.player.blockedOverlay;
    attuneButton.disabled = !isSounding() || attuning;
    attuneCancel.hidden = !attuning;
  }

  function setEngineState(state) {
    const previous = engineState;
    const wasSounding = isSounding();
    engineState = state;
    if ((state === 'starting' || state === 'playing') && firstSoundMs === null && playClickAt !== null) firstSoundMs = win.performance.now() - playClickAt;
    if (state === 'starting') trackGlide(0);
    if (state === 'ended') {
      orb.bloom();
      clearTimerState();
    }
    if (state === 'idle' || state === 'ended') store.set('session', null);
    if (PAUSED.has(state) && remainingMs !== null) store.set('session', { presetId: store.get().presetId, endsAt: null, pausedRemainingMs: remainingMs });
    if (attuning && !isSounding()) attuning = false;
    if (wasSounding !== isSounding()) {
      revealRestartLater();
      if (!isSounding()) flushDeferred();
    }
    syncKeepAwake();
    nightDim.refresh();
    render();
    const line = currentLine();
    if (line.announce && previous !== state) announcer.announce(line.announce);
  }

  /** Restart sound waits under the status until sound has played for 20 s; [hidden] stays the outer gate. */
  function revealRestartLater() {
    if (restartTimer !== null) clearTimer(restartTimer);
    restartTimer = null;
    restartEl.dataset.ready = 'false';
    if (!isSounding()) return;
    restartTimer = setTimer(() => {
      restartTimer = null;
      restartEl.dataset.ready = 'true';
    }, RESTART_REVEAL_MS);
  }

  function clearTimerState() {
    remainingMs = null;
    timerTotalMs = 0;
    lastRemaining = Infinity;
  }

  function onTimer({ remainingMs: ms, phase }) {
    if (phase === 'done') {
      clearTimerState();
      store.set('session', null);
    } else {
      remainingMs = ms;
      if (lastRemaining > FIVE_MIN && ms <= FIVE_MIN) announcer.announce(currentLine('five').announce);
      else if (lastRemaining > ONE_MIN && ms <= ONE_MIN) announcer.announce(currentLine('one').announce);
      lastRemaining = ms;
    }
    render();
  }

  // --- play / pause / timer ---------------------------------------------------------------------------------
  /**
   * First Play: unlock() synchronously inside the gesture; a first headphones session plays the left/right check
   * before it enters; then the preset plays, resolved from the store only now (so a chip tapped with the start
   * counts), and its timer is armed.
   */
  function begin({ resumeMs = null } = {}) {
    if (!engine || beginning) return;
    beginning = true;
    playClickAt = win.performance.now();
    buzz('play');
    toaster.dismiss('resume');
    Promise.resolve(engine.unlock())
      .then((result) => {
        if (result !== 'running') return false;
        const s = store.get();
        return s.listening === 'headphones' && !s.hints.stereoCheckDone ? runStereoCheck().then(() => true) : true;
      })
      .then((go) => {
        beginning = false;
        if (go) playNow(resumeMs);
      }, () => {
        beginning = false;
      });
  }

  function playNow(resumeMs) {
    const s = store.get();
    const resolved = resolveSettings(s, platform);
    engine.play({ preset: resolved });
    if (s.hints.orb) store.set('hints.orb', false);
    const ms = resumeMs ?? timerMinutesFor(s) * 60000;
    if (ms > 0) {
      armTimer(ms, s, resolved);
      return;
    }
    clearTimerState();
    store.set('session', null); // nothing left to resume from an untimed session
  }

  function armTimer(ms, s = store.get(), resolved = resolveSettings(s, platform)) {
    engine.armTimer(ms, timerOptions(s, resolved));
    timerTotalMs = ms;
    remainingMs = ms;
    lastRemaining = ms;
    store.set('session', { presetId: s.presetId, endsAt: now() + ms, pausedRemainingMs: null });
    render();
  }

  /** The left/right check: "Left…" as the left tone starts, "Right…" 2 s later; resolves once it has played (3.5 s). */
  function runStereoCheck() {
    if (!engine) return Promise.resolve(false);
    store.set('hints.stereoCheckDone', true);
    return Promise.resolve(engine.unlock()).then((result) => {
      if (result !== 'running') return false;
      toast('stereo-left', STRINGS.toasts.stereoLeft, { durationMs: STEREO_TOAST_MS });
      setTimer(() => toast('stereo-right', STRINGS.toasts.stereoRight, { durationMs: STEREO_TOAST_MS }), STEREO_RIGHT_AT_MS);
      return engine.stereoCheck();
    }).catch(() => false);
  }

  function onOrbToggle(event) {
    if (event && event === startedByTap) {
      startedByTap = null; // this tap already started the waiting session
      return;
    }
    if (attuning) {
      finishAttune();
      return;
    }
    if (!engine || engineState === 'unavailable') return;
    if (isSounding()) {
      buzz('pause');
      engine.pause();
    } else if (PAUSED.has(engineState)) {
      buzz('play');
      engine.resume();
    } else if (engineState === 'interrupted') {
      continueAfterInterruption();
    } else {
      begin();
    }
  }

  /** Interrupted: resume from the tap, else a fresh context and graph inside the same gesture. */
  function continueAfterInterruption() {
    Promise.resolve(engine.recover()).then(() => {
      const state = engine.getState().state;
      if (state === 'interrupted' || state === 'blocked') return engine.rebuild();
      return undefined;
    }).catch(() => {});
  }

  /** While sounding, the armed timer follows the chips: re-armed for minutes > 0, cancelled for the no-timer chip. */
  function retimeForPreset(s, resolved, minutes = timerMinutesFor(s)) {
    if (minutes > 0) {
      armTimer(minutes * 60000, s, resolved);
      return;
    }
    engine.cancelTimer();
    clearTimerState();
    store.set('session', null);
    render();
  }

  function setTimerMinutes(minutes) {
    const s = store.get();
    store.set(`timer.byPreset.${s.presetId}`, minutes);
    if (isSounding()) retimeForPreset(store.get(), resolveSettings(s, platform), minutes);
    toast('timer', minutes === 0 ? STRINGS.toasts.timerOff : minutes === 1 ? STRINGS.toasts.timerSetOne : fill(STRINGS.toasts.timerSet, { minutes: formatMinutes(minutes) }));
  }

  // --- presets, listening, fine tuning ----------------------------------------------------------------------
  function selectPreset(id) {
    const preset = getPreset(id);
    if (!preset || (id === store.get().presetId && !store.get().custom)) return;
    buzz('preset');
    customTimerChosen = false;
    store.patch({ presetId: id, custom: null, mix: { ...preset.mix }, rainIntensity: preset.rainIntensity, oceanIntensity: preset.oceanIntensity });
  }

  function setListening(value) {
    if (value === store.get().listening) return;
    buzz('toggle');
    store.set('listening', value);
    toast('listening', value === 'speakers' ? STRINGS.toasts.listeningSpeakers : STRINGS.toasts.listeningHeadphones);
  }

  /** Fine tuning writes custom = the resolved sound with one field changed; presets clear it again. */
  function updateCustom(partial) {
    const s = store.get();
    const r = resolveSettings(s, platform);
    const base = s.custom ?? { beatHz: r.beatHz, carrierHz: r.carrierHz, timbre: r.timbre, pad: r.pad, mode: 'auto' };
    store.set('custom', { ...base, ...partial });
  }

  function startAttune() {
    if (!engine || !isSounding() || attuning) return;
    engine.startAttune();
    attuning = true;
    render();
  }

  function finishAttune() {
    attuning = false;
    const hz = engine.commitAttune();
    if (Number.isFinite(hz)) {
      updateCustom({ carrierHz: hz });
      toast('attune', fill(STRINGS.fineTuning.attune.done, { pitch: formatPitch(hz) }));
    }
    render();
  }

  function cancelAttune() {
    if (!attuning) return;
    attuning = false;
    engine.cancelAttune();
    render();
  }

  // --- controls ---------------------------------------------------------------------------------------------
  renderPresetChips(doc, $('presets'));
  const presetChips = bindRadioGroup($('presets'), { onChange: selectPreset });
  const master = bindSlider($('master'), { output: $('master-out'), format: (v) => formatPercent(v / 100), setTimer, clearTimer, onInput: (v) => engine?.setMaster(v / 100), onCommit: (v) => store.set('mix.master', v / 100) });
  const mixSliders = Object.fromEntries(LAYERS.map((layer) => [layer, bindSlider($(`mix-${layer}`), {
    output: $(`mix-${layer}-out`), format: (v) => formatPercent(v / 100), setTimer, clearTimer,
    onInput: (v) => {
      engine?.setLayerLevel(layer, v / 100);
      if (store.get().muted[layer]) store.set(`muted.${layer}`, false);
    },
    onCommit: (v) => store.set(`mix.${layer}`, v / 100),
  })]));
  for (const layer of LAYERS) {
    listen($(`mute-${layer}`), 'click', () => {
      buzz('toggle');
      store.set(`muted.${layer}`, !store.get().muted[layer]);
    });
  }
  const timerChips = bindRadioGroup($('timer-chips'), {
    onChange: (value) => {
      buzz('tap');
      customTimerChosen = value === 'custom';
      timerCustomEl.hidden = !customTimerChosen;
      setTimerMinutes(customTimerChosen ? stepper.get() : Number(value));
    },
  });
  const stepper = bindStepper(timerCustomEl, { min: 1, max: 720, step: 5, value: 20, format: formatMinutes, onChange: (n) => setTimerMinutes(n) });
  const afterRadios = bindRadioGroup($('timer-after'), {
    onChange: (value) => {
      buzz('tap');
      store.set('timer.after', value);
      if (isSounding() && remainingMs !== null) armTimer(engine.timerRemainingMs());
    },
  });
  const beat = bindSlider($('beat'), { output: $('beat-out'), format: formatHz, shiftStep: 5, setTimer, clearTimer, onInput: (v) => { engine?.setBeat(v); gammaNote.hidden = v < 30; }, onCommit: (v) => updateCustom({ beatHz: v }) });
  const pitch = bindSlider($('pitch'), { output: $('pitch-out'), format: formatPitch, shiftStep: 50, setTimer, clearTimer, onInput: (v) => engine?.setCarrier(v), onCommit: (v) => updateCustom({ carrierHz: v }) });
  const rainfall = bindSlider($('rainfall'), { output: $('rainfall-out'), format: (v) => formatRainfall(v / 100), shiftStep: 20, setTimer, clearTimer, onInput: (v) => engine?.setRainIntensity(v / 100), onCommit: (v) => store.set('rainIntensity', v / 100) });
  const sea = bindSlider($('sea'), { output: $('sea-out'), format: (v) => formatSea(v / 100), shiftStep: 20, setTimer, clearTimer, onInput: (v) => engine?.setOceanIntensity(v / 100), onCommit: (v) => store.set('oceanIntensity', v / 100) });
  const timbre = bindRadioGroup($('timbre'), { onChange: (v) => { buzz('tap'); engine?.setTimbre(v); updateCustom({ timbre: v }); } });
  const pad = bindSwitch($('pad'), { onChange: (on) => { buzz('toggle'); engine?.setPad(on); updateCustom({ pad: on }); } });
  const padStyle = bindRadioGroup($('pad-style'), { onChange: (v) => { buzz('tap'); store.set('padStyle', v); } });
  const style = bindRadioGroup($('style'), {
    onChange: (v) => {
      buzz('tap');
      updateCustom({ mode: v });
      engine?.setMode(resolveSettings(store.get(), platform).mode);
    },
  });
  listen(attuneButton, 'click', startAttune);
  listen(attuneCancel, 'click', cancelAttune);
  bindDisclosure($('fine-toggle'), $('fine-panel'));
  bindDisclosure($('explainer-toggle'), $('explainer-panel'));
  bindDisclosure($('more-toggle'), $('more-panel'));
  const aboutDisclosure = bindDisclosure($('about-toggle'), $('about-panel'));

  const listening = bindRadioGroup($('listening'), { onChange: setListening });
  listen($('mode'), 'click', () => setListening(store.get().listening === 'speakers' ? 'headphones' : 'speakers'));
  listen($('stereo-check'), 'click', () => runStereoCheck());
  const catsSwitch = bindSwitch($('cats-switch'), { onChange: (on) => { buzz('toggle'); store.set('cats.enabled', on); } });
  const autoplaySwitch = bindSwitch($('autoplay'), { onChange: (on) => { buzz('toggle'); store.set('autoplay', on); } });
  const keepAwake = bindSwitch($('keep-awake'), { onChange: (on) => { buzz('toggle'); store.set('keepAwake', on); } });
  const theme = bindRadioGroup($('theme'), { onChange: (v) => { buzz('tap'); store.set('theme', v); } });
  const prefersStill = () => Boolean(win.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const still = bindSwitch($('still'), { onChange: (on) => { buzz('toggle'); store.set('motion', on ? 'still' : prefersStill() ? 'full' : 'auto'); } });
  const sceneRadios = bindRadioGroup($('scene-setting'), { onChange: (v) => { buzz('tap'); store.set('scene', v); } });
  const haptics = bindSwitch($('haptics'), { onChange: (on) => { store.set('haptics', on); buzz('toggle'); } });
  const nightDimSwitch = bindSwitch($('night-dim'), { onChange: (on) => { buzz('toggle'); store.set('nightDim', on); } });
  const shortcuts = bindSwitch($('shortcuts'), { onChange: (on) => { buzz('toggle'); store.set('shortcuts', on); } });
  listen($('restart-sound'), 'click', () => engine?.rebuild());
  listen($('overlay-button'), 'click', () => (engineState === 'interrupted' ? continueAfterInterruption() : begin()));
  listen(miniToggle, 'click', onOrbToggle);
  listen($('reset'), 'click', resetAll);
  listen(installButton, 'click', () => {
    const prompt = installPrompt;
    installPrompt = null;
    installRow.dataset.installable = 'false';
    installButton.hidden = true;
    prompt?.prompt?.();
  });
  listen(win, 'beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt = e;
    installRow.dataset.installable = 'true';
    installButton.hidden = false;
  });

  function resetAll() {
    const snapshot = store.snapshot();
    buzz('toggle');
    store.reset();
    Promise.resolve(resetSite?.()).catch(() => {});
    toast('reset', STRINGS.toasts.reset.text, { action: { label: STRINGS.toasts.reset.action, onAction: () => store.patch(parse(snapshot)) } });
  }

  // --- settings visibility and store → controls -------------------------------------------------------------
  const limits = platformLimits(lifecycle, platform);
  $('keep-awake-row').hidden = !platform.hasWakeLock;
  $('haptics-row').hidden = !platform.hasVibrate;
  $('version').textContent = version;
  $('storage-note').hidden = store.persisted !== false;
  $('platform-notes').replaceChildren(...limits.lines.map((text) => Object.assign(doc.createElement('li'), { textContent: text })));
  $('install-generic').textContent = limits.platform === 'apple' ? STRINGS.settings.addToHome.apple : STRINGS.settings.addToHome.generic;

  function syncPresetControls(s) {
    presetChips.set(s.custom ? '' : s.presetId);
  }

  function syncMixControls(s) {
    master.set(pct(s.mix.master));
    for (const layer of LAYERS) {
      mixSliders[layer].set(pct(s.mix[layer]));
      const muted = Boolean(s.muted[layer]);
      const button = $(`mute-${layer}`);
      button.setAttribute('aria-pressed', String(muted));
      button.setAttribute('aria-label', fill(muted ? STRINGS.mixer.unmute : STRINGS.mixer.mute, { layer: STRINGS.mixer[layer] }));
      button.closest('.row').dataset.muted = String(muted);
    }
  }

  function syncTimerControls(s) {
    const minutes = timerMinutesFor(s);
    const chip = customTimerChosen || !(minutes === 0 || TIMER_OPTIONS.includes(minutes)) ? 'custom' : String(minutes);
    timerChips.set(chip);
    stepper.set(minutes || 20);
    timerCustomEl.hidden = chip !== 'custom';
    afterRadios.set(s.timer.after);
  }

  function syncFineControls(s) {
    rainfall.set(pct(s.rainIntensity));
    sea.set(pct(s.oceanIntensity));
    const r = resolveSettings(s, platform);
    beat.set(r.beatHz);
    pitch.set(r.carrierHz);
    timbre.set(r.timbre);
    pad.set(r.pad);
    padStyle.set(s.padStyle);
    style.set(s.custom?.mode ?? 'auto');
    gammaNote.hidden = r.beatHz < 30;
  }

  function syncSettingsControls(s) {
    listening.set(s.listening);
    modeLabel.textContent = STRINGS.player.listening[s.listening];
    modeIcon.setAttribute('href', s.listening === 'headphones' ? '#i-headphones' : '#i-speaker');
    stereoRow.hidden = s.listening !== 'headphones';
    catsSwitch.set(s.cats.enabled);
    autoplaySwitch.set(s.autoplay);
    keepAwake.set(s.keepAwake);
    theme.set(s.theme);
    still.set(s.motion === 'still' || (s.motion === 'auto' && prefersStill()));
    sceneRadios.set(s.scene);
    haptics.set(s.haptics);
    nightDimSwitch.set(s.nightDim);
    shortcuts.set(s.shortcuts);
    $('cats-spotted').textContent = String(s.cats.spotted);
  }

  function syncKeepAwake() {
    if (!lifecycle.requestKeepAwake) return;
    if (store.get().keepAwake && isSounding()) {
      Promise.resolve(lifecycle.requestKeepAwake()).then((ok) => {
        keepAwakeDesc.textContent = ok ? STRINGS.settings.keepAwake.description : STRINGS.settings.keepAwake.unavailable;
      }).catch(() => {});
    } else {
      lifecycle.releaseKeepAwake?.();
    }
  }

  function setControlsDisabled(flag) {
    master.setDisabled(flag);
    for (const layer of LAYERS) {
      mixSliders[layer].setDisabled(flag);
      $(`mute-${layer}`).disabled = flag;
    }
    for (const group of [timerChips, afterRadios, timbre, padStyle, style]) group.setDisabled(flag);
    for (const control of [beat, pitch, pad, rainfall, sea]) control.setDisabled(flag);
    for (const button of [attuneButton, $('stereo-check'), miniToggle]) button.disabled = flag;
  }

  function syncAll(s) {
    syncPresetControls(s);
    syncMixControls(s);
    syncTimerControls(s);
    syncFineControls(s);
    syncSettingsControls(s);
    render();
  }

  disposers.push(store.subscribe((keys, s) => {
    const has = (key) => keys.includes(key);
    const backToPreset = has('custom') && !s.custom;
    // A new preset, listening setup or pad style re-resolves the sound; so does leaving fine tuning for the preset.
    if ((has('presetId') || has('listening') || backToPreset) && isSounding()) {
      const resolved = resolveSettings(s, platform);
      engine.applyPreset(resolved, { glideSeconds: APPLY_GLIDE_S });
      trackGlide(APPLY_GLIDE_S);
      if (has('presetId') || backToPreset) toast('shift', fill(STRINGS.toasts.presetShift, { preset: presetName(s) }));
      if (has('presetId')) retimeForPreset(s, resolved);
    } else if (has('padStyle') && isSounding()) {
      engine.setCanon(resolveSettings(s, platform).canon); // drone ⇄ canon without restarting the beat glide
    }
    if ((has('presetId') || has('custom')) && activePreset(s).mood !== 'sleepy') flushDeferred();
    if (has('autoplay') && !s.autoplay) stopWaiting();
    if (has('presetId') || has('custom') || has('padStyle')) {
      syncPresetControls(s);
      syncFineControls(s);
      syncTimerControls(s);
    }
    if (has('timer')) syncTimerControls(s);
    if (has('mix') || has('muted')) syncMixControls(s);
    if (has('keepAwake')) syncKeepAwake();
    syncSettingsControls(s);
    nightDim.refresh();
    render();
  }));

  // --- shortcuts, night dim, sheet, first run, resume offer -------------------------------------------------
  function dispatch(action) {
    if (action === 'escape') return onEscape();
    if (action.startsWith('preset:')) {
      const preset = PRESETS[Number(action.slice(7)) - 1];
      if (preset) selectPreset(preset.id);
      return Boolean(preset);
    }
    switch (action) {
      case 'toggle-play': onOrbToggle(); return true;
      case 'mute': toggleMuteAll(); return true;
      case 'listening': setListening(store.get().listening === 'speakers' ? 'headphones' : 'speakers'); return true;
      case 'theme': store.set('theme', THEMES[(THEMES.indexOf(store.get().theme) + 1) % THEMES.length]); return true;
      case 'cat': if (cats) { cats.petNewest() || cats.call(); } return Boolean(cats);
      case 'about': openAbout(); return true;
      default: return false;
    }
  }

  function onEscape() {
    if (attuning) {
      cancelAttune();
      return true;
    }
    if (doc.querySelector('dialog[open]')) return false;
    if (sheet.isExpanded()) {
      sheet.collapse();
      orb.focus();
      return true;
    }
    return false;
  }

  function toggleMuteAll() {
    const { muted } = store.get();
    const allMuted = LAYERS.every((layer) => muted[layer]);
    if (allMuted) {
      store.set('muted', mutedBeforeAll ?? Object.fromEntries(LAYERS.map((layer) => [layer, false])));
      mutedBeforeAll = null;
    } else {
      mutedBeforeAll = muted;
      store.set('muted', Object.fromEntries(LAYERS.map((layer) => [layer, true])));
    }
  }

  function openAbout() {
    aboutDisclosure.open();
    const toggle = $('about-toggle');
    toggle.focus();
    toggle.scrollIntoView({ block: 'start', behavior: html.dataset.motion === 'still' ? 'auto' : 'smooth' });
  }

  disposers.push(installShortcuts(doc, { isEnabled: () => store.get().shortcuts, dispatch }));

  const nightDim = createNightDim({
    root: html, isPlaying: isSounding, getPresetId: () => store.get().presetId, isEnabled: () => store.get().nightDim, onChange: onDim, now, setTimer, clearTimer,
  });
  nightDim.start();
  disposers.push(() => nightDim.stop());

  disposers.push(sheet.onChange((expanded) => {
    if (expanded && store.get().hints.sheet) store.set('hints.sheet', false);
  }));

  // "Let's begin" is a tap, so with Play on open the first session starts right from it.
  const firstRun = createFirstRun($('firstrun'), {
    onDone: ({ accepted } = {}) => {
      orb.focus();
      if (accepted && store.get().autoplay) begin();
    },
  });

  /**
   * Play on open. Browsers start audio only after a user gesture unless their autoplay policy says otherwise, so
   * where the documented Autoplay Policy Detection API reports 'allowed' the session starts at once; everywhere else
   * the scene, the waiting orb and a caption under the status wait, and the first tap or key press anywhere starts
   * it (a real gesture) while the tap still does what it was aimed at. A session stored with more than a minute
   * left continues (core/state.js startPlan).
   */
  function autoStart() {
    if (!engine || engineState !== 'idle') return false;
    if (win.navigator?.getAutoplayPolicy?.('audiocontext') === 'allowed') {
      startFromPlan();
      return true;
    }
    autoPending = true;
    doc.addEventListener('click', startFromTap, { capture: true });
    doc.addEventListener('keydown', startFromKey, { capture: true });
    render();
    return true;
  }

  const optsOut = (event) => Boolean(event.target?.closest?.(AUTOPLAY_SWITCH)); // turning Play on open off starts nothing

  /** Capture phase: the tap starts the session and still reaches its target; on the orb or the mini button the start is that tap's whole action. */
  function startFromTap(event) {
    if (optsOut(event)) return;
    if (event.target?.closest?.(START_BUTTONS)) startedByTap = event;
    startPending();
  }

  function startFromKey(event) {
    if (event.key === 'Tab' || event.key === 'Escape' || event.metaKey || event.ctrlKey || event.altKey || optsOut(event)) return;
    event.preventDefault();
    event.stopPropagation();
    startPending();
  }

  /** The waiting autoplay starts from this gesture; returns false when nothing was waiting. */
  function startPending() {
    if (!autoPending) return false;
    stopWaiting();
    startFromPlan();
    return true;
  }

  function stopWaiting() {
    if (!autoPending) return;
    autoPending = false;
    doc.removeEventListener('click', startFromTap, { capture: true });
    doc.removeEventListener('keydown', startFromKey, { capture: true });
    render();
  }

  /** Continues the stored session when more than a minute of it is left, on its preset; otherwise begins the current preset. */
  function startFromPlan() {
    const plan = startPlan(store.get(), now());
    if (plan.kind !== 'resume') {
      begin();
      return;
    }
    if (plan.presetId !== store.get().presetId && getPreset(plan.presetId)) selectPreset(plan.presetId);
    begin({ resumeMs: plan.remainingMs });
  }

  if (engine) {
    disposers.push(engine.on('state', ({ state }) => setEngineState(state)));
    disposers.push(engine.on('timer', onTimer));
    disposers.push(engine.on('entrance', ({ endS }) => orb.setEntrance(endS * 1000)));
    disposers.push(engine.on('warning', ({ code, message }) => toast(`warning-${code}`, message)));
  }

  /** Play on open off: a stored session with more than a minute left is offered in a toast; nothing plays until it is tapped. */
  function offerResume() {
    if (!store.get().session || !engine) return;
    const plan = startPlan(store.get(), now());
    if (plan.kind !== 'resume') {
      store.set('session', null);
      return;
    }
    toast('resume', fill(STRINGS.player.resumePrompt, { time: minutesLeft(plan.remainingMs) }), {
      action: { label: STRINGS.player.resume, onAction: startFromPlan },
      onDismiss: (reason) => {
        if (reason !== 'action') store.set('session', null);
      },
    });
  }

  // --- start ------------------------------------------------------------------------------------------------
  syncAll(store.get());
  if (!engine) setControlsDisabled(true);
  const firstRunOpened = firstRun.showIfNeeded(store, { suggested: suggestPreset(new Date(now()).getHours()) });
  if (!firstRunOpened && !(store.get().autoplay && autoStart())) offerResume();

  return {
    /** Cats: milestone toasts at 1, 10, 25, 50 and 100 spotted. */
    onPet(total) {
      if (!CAT_MILESTONES.has(total)) return;
      toast(`cats-${total}`, total === 1 ? STRINGS.toasts.catMilestoneFirst : fill(STRINGS.toasts.catMilestone, { n: total }));
    },
    setStill: (flag) => orb.setStill(flag),
    firstSoundMs: () => firstSoundMs,
    /** Toasts from outside the UI (offline ready, update ready); sticky ones wait at night (see notify above). */
    notify,
    destroy() {
      for (const dispose of disposers.splice(0)) dispose();
      stopWaiting();
      for (const id of [glideTimer, restartTimer]) if (id !== null) clearTimer(id);
      orb.destroy();
      firstRun.destroy();
      toaster.destroy();
    },
  };
}

// --- rendering helpers ---------------------------------------------------------------------------------------

/** About → platform notes ({ platform, lines }) from the lifecycle module when it answers for this platform, else the desktop copy. */
function platformLimits(lifecycle, platform) {
  try {
    const limits = lifecycle.describeLimitations?.(platform);
    if (Array.isArray(limits?.lines) && limits.lines.length > 0) return limits;
  } catch {
    // A lifecycle module that cannot describe this platform must not stop the UI from mounting.
  }
  return { platform: 'desktop', lines: limitationsCopy('desktop') };
}

function svgIcon(doc, id) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const use = doc.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

/** One chip per preset, in PRESETS order (shortcut digits 1–9 follow the same order). */
function renderPresetChips(doc, fieldset) {
  for (const preset of PRESETS) {
    const label = doc.createElement('label');
    label.className = 'chip';
    const input = doc.createElement('input');
    input.type = 'radio';
    input.name = 'preset';
    input.value = preset.id;
    const text = doc.createElement('span');
    text.className = 'chip__text';
    text.textContent = preset.name;
    label.append(input, svgIcon(doc, PRESET_ICONS[preset.id]), text);
    fieldset.append(label);
  }
}

/** ?gallery=cats: every pose × coat in both themes, for art review. */
function renderGallery(doc, container) {
  const wrap = doc.createElement('div');
  wrap.className = 'gallery';
  for (const theme of ['dark', 'light']) {
    const group = doc.createElement('section');
    group.className = 'gallery__theme';
    group.dataset.theme = theme;
    const title = doc.createElement('h2');
    title.className = 'gallery__title';
    title.textContent = STRINGS.settings.theme[theme];
    const grid = doc.createElement('div');
    grid.className = 'gallery__grid';
    for (const pose of POSES) {
      for (const coat of Object.keys(COATS)) {
        const cell = doc.createElement('figure');
        cell.className = 'gallery__cell';
        const cat = doc.createElement('div');
        cat.className = 'cat is-present';
        cat.dataset.pose = pose;
        cat.dataset.coat = coat;
        cat.innerHTML = catSvg({ pose, coat });
        for (const [name, value] of Object.entries(coatVars(coat))) cat.style.setProperty(name, value);
        const caption = doc.createElement('figcaption');
        caption.textContent = catLabel(pose, coat);
        cell.append(cat, caption);
        grid.append(cell);
      }
    }
    group.append(title, grid);
    wrap.append(group);
  }
  container.replaceChildren(wrap);
}
