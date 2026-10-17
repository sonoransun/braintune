// The audio engine (§5 audio/engine.js, §6.7, §6.8 of the plan): the public API, the state
// machine, every fade and the orchestration of the tone, rain, ocean and purr layers. Everything
// time-related is injected (now, setTimer, clearTimer, rng, audioContextFactory, nav) so the
// engine runs under Node's fake context in tests. Every master write goes through writeMaster(),
// which ends with sessionTimer.rearmEndFade() so a timer's end fade survives any slider move.
//
// States: idle | starting | playing | pausing | paused | ending | ended | ambient | blocked |
// interrupted | unavailable. Events: 'state' { state }, 'timer' { remainingMs, phase },
// 'wave' { at, duration, inMs }, 'blocked', 'interrupted', 'warning' { code, message },
// 'ready' { layer } and 'context' { ctx } (for lifecycle.js).

import { DEFAULT_SETTINGS } from '../core/state.js';
import { masterGain, layerGain, dbToGain, CEILING_DB } from '../core/levels.js';
import { gateParams } from '../core/gate.js';
import { mulberry32 } from '../core/rng.js';
import { createContext, buildMaster, buildBuses } from './graph.js';
import { fade, createScheduler } from './automation.js';
import { createBufferCache } from './buffers.js';
import { createToneLayer } from './tone.js';
import { createRainLayer } from './rain.js';
import { createOceanLayer } from './ocean.js';
import { createPurrLayer } from './purr.js';
import { createSessionTimer } from './session-timer.js';
import { prepareSession } from './lifecycle.js';

/** Every engine state. */
export const STATES = Object.freeze([
  'idle', 'starting', 'playing', 'pausing', 'paused', 'ending', 'ended', 'ambient', 'blocked', 'interrupted', 'unavailable',
]);

const LAYERS = Object.freeze(['tone', 'rain', 'ocean', 'purr']);
const AMBIENCE = Object.freeze(['rain', 'ocean', 'purr']);
const AUDIBLE = new Set(['starting', 'playing', 'ending', 'ambient']);
const LEAD = 0.01;
const RESUME_TIMEOUT_MS = 1500;
const FADES = Object.freeze({ play: 1.5, pause: 0.6, pauseSuspend: 0.65, resume: 0.8, stop: 2, rebuild: 0.8, restore: 1.5, level: 0.5, mute: 0.3 });
/** Extra time after the stop fade before the context suspends, so a soft chime can ring out. */
const CHIME_TAIL_S = 0.5;
const STEREO_CHECK = Object.freeze({ hz: 440, seconds: 1, dbfs: -24, edge: 0.02, tailMs: 2200 });
/** Gate shape differences below these do not re-render the gate period. */
const GATE_EPSILON = Object.freeze({ ramp: 0.05, depth: 0.1 });

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const defaultSetTimer = (fn, ms) => setTimeout(fn, ms);
const defaultClearTimer = (handle) => clearTimeout(handle);

/** The part of the settings the engine keeps for itself (rebuild reads it back). */
function snapshotSettings(settings) {
  const source = settings ?? {};
  return {
    mix: { ...DEFAULT_SETTINGS.mix, ...(source.mix ?? {}) },
    muted: { ...DEFAULT_SETTINGS.muted, ...(source.muted ?? {}) },
    rainIntensity: source.rainIntensity ?? DEFAULT_SETTINGS.rainIntensity,
    oceanIntensity: source.oceanIntensity ?? DEFAULT_SETTINGS.oceanIntensity,
  };
}

/** Creates the engine; `settings` is the store's state (mix, muted, intensities) and everything else is injectable. */
export function createEngine({
  settings = DEFAULT_SETTINGS, now = Date.now, setTimer = defaultSetTimer, clearTimer = defaultClearTimer,
  rng = mulberry32(now() >>> 0), audioContextFactory = createContext, nav = globalThis.navigator,
} = {}) {
  const cfg = snapshotSettings(settings);
  const listeners = new Map();
  const timers = new Set();
  const layers = { rain: null, ocean: null, purr: null };
  const meters = {};
  let state = 'idle';
  let ctx = null;
  let master = null;
  let buses = null;
  let cache = null;
  let scheduler = null;
  let tone = null;
  let preset = null;
  let gate = null;
  let masterTarget = 0;
  let masterFadeEndT = 0;
  let toneFadeEndT = 0;
  let sessionKind = 'tone';
  let pendingPlay = null;
  let pendingTimer = null;
  let recovering = null;
  let suspending = false;

  // --- events and state ---------------------------------------------------------------------

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type)?.delete(fn);
  }

  function emit(type, payload) {
    for (const fn of [...(listeners.get(type) ?? [])]) {
      try {
        fn(payload);
      } catch (err) {
        console.warn(`braintune: ${type} listener failed`, err);
      }
    }
  }

  function setState(next) {
    if (next === state) return;
    state = next;
    emit('state', { state: next });
  }

  function warn(code, err) {
    emit('warning', { code, message: err && err.message ? err.message : String(err) });
  }

  function later(fn, ms) {
    const handle = setTimer(() => {
      timers.delete(handle);
      fn();
    }, ms);
    timers.add(handle);
    return handle;
  }

  const wait = (ms) => new Promise((resolve) => later(resolve, ms));
  const audible = () => AUDIBLE.has(state);
  const effectiveLevel = (layer) => (cfg.muted[layer] ? 0 : layerGain(cfg.mix[layer]));
  const startBeat = (resolved) => resolved.glide?.fromHz ?? resolved.beatHz;

  // --- graph --------------------------------------------------------------------------------

  function createGraph() {
    if (typeof audioContextFactory !== 'function') throw new TypeError('no AudioContext factory');
    prepareSession(nav);
    const created = audioContextFactory();
    if (!created) throw new TypeError('AudioContext factory returned nothing');
    ctx = created;
    master = buildMaster(ctx);
    buses = buildBuses(ctx, master.master);
    cache = createBufferCache(ctx, { rng, setTimer });
    scheduler = createScheduler(ctx, { setTimer, clearTimer });
    tone = null;
    gate = null;
    masterTarget = 0;
    masterFadeEndT = 0;
    toneFadeEndT = 0;
    for (const layer of AMBIENCE) layers[layer] = null;
    for (const key of Object.keys(meters)) delete meters[key];
    emit('context', { ctx });
  }

  function disposeGraph() {
    if (!ctx) return;
    scheduler.stop();
    sessionTimer.forgetFade();
    if (tone) tone.stop();
    for (const layer of AMBIENCE) layers[layer]?.dispose();
    cache.dispose();
    const old = ctx;
    ctx = null;
    tone = null;
    Promise.resolve()
      .then(() => old.close())
      .catch((err) => warn('close-failed', err));
  }

  /** Our own suspend: flagged so the statechange it raises never triggers recovery. */
  function suspendContext() {
    suspending = true;
    return Promise.resolve()
      .then(() => ctx.suspend())
      .catch((err) => warn('suspend-failed', err))
      .finally(() => {
        suspending = false;
      });
  }

  /** ctx.resume() racing a 1.5 s timeout; resolves whether the context runs. */
  function resumeContext() {
    let handle = null;
    const timeout = new Promise((resolve) => {
      handle = later(() => resolve(false), RESUME_TIMEOUT_MS);
    });
    const attempt = Promise.resolve()
      .then(() => ctx.resume())
      .then(() => ctx.state === 'running', () => false);
    return Promise.race([attempt, timeout]).then((running) => {
      clearTimer(handle);
      timers.delete(handle);
      return running && ctx.state === 'running';
    });
  }

  // --- master and buses ---------------------------------------------------------------------

  /** The one master write: fade to `value` over `seconds`, then re-arm the timer's end fade. */
  function writeMaster(value, seconds, shape = 'scurve') {
    masterTarget = value;
    const t = ctx.currentTime + LEAD;
    fade(master.master.gain, master.master.gain.value, value, t, seconds, shape);
    masterFadeEndT = t + seconds;
    sessionTimer.rearmEndFade();
  }

  function writeBus(layer, seconds) {
    const param = buses[layer].gain;
    const t = ctx.currentTime + LEAD;
    fade(param, param.value, effectiveLevel(layer), t, seconds, 'linear');
    if (layer !== 'tone') return;
    toneFadeEndT = t + seconds;
    sessionTimer.rearmEndFade();
  }

  function writeAllBuses(seconds) {
    for (const layer of LAYERS) writeBus(layer, seconds);
  }

  // --- layers -------------------------------------------------------------------------------

  function ensureLayer(name) {
    if (layers[name]) return layers[name];
    if (name === 'rain') layers.rain = createRainLayer(ctx, buses.rain, scheduler, cache, { rng, intensity: cfg.rainIntensity });
    else if (name === 'ocean') {
      layers.ocean = createOceanLayer(ctx, buses.ocean, scheduler, cache, {
        rng,
        intensity: cfg.oceanIntensity,
        onWave: (at, duration) => emit('wave', { at, duration, inMs: Math.max(0, (at - ctx.currentTime) * 1000) }),
      });
    } else if (name === 'purr') layers.purr = createPurrLayer(ctx, buses.purr, scheduler, cache, { rng, cueBus: master.master });
    else throw new RangeError(`engine: unknown layer "${name}"`);
    return layers[name];
  }

  function startLayer(name) {
    const layer = ensureLayer(name);
    layer.start().then((started) => {
      if (started) emit('ready', { layer: name });
    }, (err) => warn(`${name}-failed`, err));
  }

  /** Starts every ambience layer that is audible and stops the ones that are not. */
  function syncLayers() {
    for (const name of AMBIENCE) {
      if (audible() && effectiveLevel(name) > 0) startLayer(name);
      else if (layers[name]?.running) layers[name].stop();
    }
  }

  function stopLayers(seconds) {
    for (const name of AMBIENCE) layers[name]?.stop({ seconds });
  }

  function gateDiffers(next) {
    return !gate || Math.abs(next.ramp - gate.ramp) >= GATE_EPSILON.ramp || Math.abs(next.depth - gate.depth) >= GATE_EPSILON.depth;
  }

  function ensureTone() {
    if (tone) return;
    gate = preset.gate;
    tone = createToneLayer(ctx, buses.tone, cache, {
      carrierHz: preset.carrierHz, beatHz: startBeat(preset), mode: preset.mode, timbre: preset.timbre, pad: preset.pad, gate, setTimer, clearTimer,
    });
    tone.start();
  }

  /** Moves the tone to a resolved preset over `seconds` (0 = at once). */
  function configureTone(resolved, seconds) {
    const current = tone.getState();
    tone.setMode(resolved.mode, { seconds: Math.min(1.2, seconds) });
    if (resolved.carrierHz !== current.carrierHz) tone.setCarrier(resolved.carrierHz, { seconds });
    tone.setTimbre(resolved.timbre);
    tone.setPad(resolved.pad);
    if (gateDiffers(resolved.gate)) {
      gate = resolved.gate;
      tone.setGate(gate, startBeat(resolved));
    }
    if (resolved.glide) {
      tone.scheduleBeatGlide(resolved.glide.fromHz, resolved.beatHz, resolved.glide.minutes * 60, { after: seconds });
    } else if (resolved.beatHz !== current.beatHz || seconds === 0) {
      tone.setBeat(resolved.beatHz, { seconds });
    }
  }

  /** Builds (or re-syncs) the tone and buses for the current preset without ramps. */
  function ensureSessionGraph() {
    ensureTone();
    configureTone(preset, 0);
    writeAllBuses(0);
    layers.rain?.setIntensity(cfg.rainIntensity);
    layers.ocean?.setIntensity(cfg.oceanIntensity);
  }

  function schedulePlayingState(seconds) {
    later(() => {
      if (state === 'starting') setState(sessionKind === 'ambient' ? 'ambient' : 'playing');
    }, seconds * 1000);
  }

  /** From a running context: fade the master in over `seconds` and run the session. */
  function runSession(seconds) {
    ensureSessionGraph();
    scheduler.flush();
    scheduler.start();
    writeMaster(masterGain(cfg.mix.master), seconds, 'scurve');
    if (sessionTimer.isPaused()) sessionTimer.resume();
    else sessionTimer.onVisible();
    syncLayers();
    schedulePlayingState(seconds);
  }

  function interrupted() {
    scheduler.stop();
    setState('interrupted');
    emit('interrupted');
  }

  /** Leaves the ending state (timer cancelled or re-armed mid-fade): restore the faded parameter. */
  function leaveEnding() {
    if (state !== 'ending') return;
    setState(sessionKind === 'ambient' ? 'ambient' : 'playing');
    writeMaster(masterGain(cfg.mix.master), FADES.restore, 'scurve');
    writeBus('tone', FADES.restore);
  }

  // --- session timer ------------------------------------------------------------------------

  const sessionTimer = createSessionTimer({
    now,
    setTimer,
    clearTimer,
    ctxTime: () => (ctx ? ctx.currentTime : null),
    fadeTarget: (after) => {
      if (!ctx) return null;
      if (after === 'ambient') return { param: buses.tone.gain, value: effectiveLevel('tone'), floorT: toneFadeEndT };
      return { param: master.master.gain, value: masterTarget, floorT: masterFadeEndT };
    },
    chimeIn: () => (ctx && ctx.state === 'running' ? master.chimeIn : null),
    onEnding: () => {
      if (state === 'playing' || state === 'ambient') setState('ending');
    },
    finish: finishSession,
    emit: (payload) => emit('timer', payload),
    presetId: () => preset?.id ?? null,
  });

  function finishSession(after) {
    if (!ctx || !(audible() || state === 'interrupted')) return;
    if (after === 'ambient') {
      const param = buses.tone.gain;
      if (param.value > 0) fade(param, param.value, 0, ctx.currentTime + LEAD, FADES.stop, 'scurve');
      sessionKind = 'ambient';
      setState('ambient');
      return;
    }
    setState('ending');
    writeMaster(0, FADES.stop, 'scurve');
    scheduler.stop();
    stopLayers(FADES.stop);
    later(() => {
      if (state !== 'ending') return;
      suspendContext().then(() => setState('ended'));
    }, (FADES.stop + CHIME_TAIL_S) * 1000);
  }

  // --- public API ---------------------------------------------------------------------------

  /** Inside the Play gesture: audio session → context → graph → resume; resolves 'running' or 'blocked'. */
  function unlock() {
    if (state === 'unavailable') return Promise.resolve('blocked');
    if (!ctx) {
      try {
        createGraph();
      } catch (err) {
        setState('unavailable');
        warn('no-audio-context', err);
        return Promise.resolve('blocked');
      }
    }
    return Promise.resolve()
      .then(() => ctx.resume())
      .then(() => ctx.state === 'running', () => false)
      .then((running) => {
        if (!running) {
          if (state === 'idle' || state === 'starting' || state === 'blocked') {
            setState('blocked');
            emit('blocked');
          }
          return 'blocked';
        }
        if (state === 'blocked') {
          setState('idle');
          if (pendingPlay) {
            const next = pendingPlay;
            pendingPlay = null;
            play(next);
          }
        }
        return 'running';
      });
  }

  /** Starts a session with a resolved preset (tone at once, ambience as its buffers resolve); resolves whether it started. */
  function play({ preset: next } = {}) {
    if (state === 'unavailable') return Promise.resolve(false);
    if (next) preset = next;
    if (!preset) throw new TypeError('engine.play needs a resolved preset');
    pendingPlay = null;
    if (state === 'paused' || state === 'pausing' || state === 'interrupted') return resume();
    if (audible()) {
      applyPreset(preset);
      return Promise.resolve(true);
    }
    sessionKind = 'tone';
    setState('starting');
    return unlock().then((result) => {
      if (result !== 'running') {
        pendingPlay = { preset };
        return false;
      }
      if (state !== 'starting') return false;
      runSession(FADES.play);
      if (pendingTimer) {
        const { ms, opts } = pendingTimer;
        pendingTimer = null;
        armTimer(ms, opts);
      }
      return true;
    });
  }

  /** Master → 0 over 0.6 s, then the context suspends. */
  function pause() {
    if (!audible()) return;
    setState('pausing');
    sessionTimer.pause();
    writeMaster(0, FADES.pause, 'scurve');
    scheduler.stop();
    later(() => {
      if (state !== 'pausing') return;
      suspendContext().then(() => setState('paused'));
    }, FADES.pauseSuspend * 1000);
  }

  /** From paused (or interrupted, in a tap): context resume, then 0 → target over 0.8 s; rebuilds when a closed context cannot come back. */
  function resume() {
    if (state === 'interrupted') return continueAfterInterruption();
    if (state !== 'paused' && state !== 'pausing') return Promise.resolve(false);
    setState('starting');
    return resumeContext().then((running) => {
      if (state !== 'starting') return false;
      if (!running) {
        interrupted();
        return false;
      }
      runSession(FADES.resume);
      return true;
    });
  }

  function continueAfterInterruption() {
    if (!ctx || ctx.state === 'closed') return rebuild();
    setState('starting');
    return resumeContext().then((running) => {
      if (state !== 'starting') return false;
      if (running) {
        runSession(FADES.resume);
        return true;
      }
      return rebuild();
    });
  }

  /** Fade to silence over `fadeSeconds`, stop transients, suspend; ends idle. */
  function stop({ fadeSeconds = 2 } = {}) {
    pendingPlay = null;
    pendingTimer = null;
    if (!ctx || state === 'idle' || state === 'unavailable') return Promise.resolve();
    if (state === 'blocked' || state === 'ended') {
      setState('idle');
      return Promise.resolve();
    }
    const seconds = audible() ? fadeSeconds : 0;
    setState('pausing');
    sessionTimer.cancel();
    tone?.cancelAttune();
    writeMaster(0, seconds, 'scurve');
    scheduler.stop();
    stopLayers(seconds);
    return wait(seconds * 1000 + 50).then(() => {
      if (state !== 'pausing') return;
      return suspendContext().then(() => setState('idle'));
    });
  }

  /** Glides mode, carrier, beat, timbre, pad, the four layer levels and the intensities to a resolved preset. */
  function applyPreset(resolved, { glideSeconds = 2 } = {}) {
    preset = resolved;
    cfg.rainIntensity = resolved.rainIntensity;
    cfg.oceanIntensity = resolved.oceanIntensity;
    for (const layer of LAYERS) cfg.mix[layer] = resolved.mix[layer];
    if (!tone) return;
    const live = audible();
    if (state === 'ambient' || (state === 'ending' && sessionKind === 'ambient')) {
      sessionKind = 'tone';
      setState('playing');
    }
    configureTone(resolved, live ? glideSeconds : 0);
    writeAllBuses(live ? FADES.play : 0);
    layers.rain?.setIntensity(cfg.rainIntensity);
    layers.ocean?.setIntensity(cfg.oceanIntensity);
    if (live) syncLayers();
  }

  function patchPreset(fields) {
    if (preset) preset = { ...preset, ...fields };
  }

  /** Mode crossfade (1.2 s). */
  function setMode(mode) {
    patchPreset({ mode });
    tone?.setMode(mode);
  }

  /** Carrier glide (1.5 s exponential). */
  function setCarrier(hz) {
    patchPreset({ carrierHz: hz });
    tone?.setCarrier(hz);
  }

  /** Beat ramp (1.5 s linear); re-renders the gate period only when its shape changes noticeably. */
  function setBeat(hz) {
    const next = gateParams(hz);
    patchPreset({ beatHz: hz, gate: next, glide: null });
    if (!tone) return;
    tone.setBeat(hz);
    if (gateDiffers(next)) {
      gate = next;
      tone.setGate(gate, hz);
    }
  }

  /** Timbre crossfade (0.8 s). */
  function setTimbre(name) {
    patchPreset({ timbre: name });
    tone?.setTimbre(name);
  }

  /** Pad on or off (1.2 s). */
  function setPad(on) {
    patchPreset({ pad: Boolean(on) });
    tone?.setPad(on);
  }

  function updateLayer(layer, seconds) {
    if (!ctx) return;
    writeBus(layer, seconds);
    if (AMBIENCE.includes(layer)) syncLayers();
  }

  /** Layer slider 0..1 → layerGain over `seconds`; an ambience layer starts or stops with it. */
  function setLayerLevel(layer, x01, { seconds = FADES.level } = {}) {
    if (!LAYERS.includes(layer)) throw new RangeError(`engine: unknown layer "${layer}"`);
    cfg.mix[layer] = clamp01(x01);
    updateLayer(layer, seconds);
  }

  /** Mutes or unmutes a layer (0.3 s) without moving its slider. */
  function setMuted(layer, muted) {
    if (!LAYERS.includes(layer)) throw new RangeError(`engine: unknown layer "${layer}"`);
    cfg.muted[layer] = Boolean(muted);
    updateLayer(layer, FADES.mute);
  }

  /** Volume slider 0..1 → masterGain over `seconds` (applied while audible; otherwise on the next fade-in). */
  function setMaster(x01, { seconds = FADES.level } = {}) {
    cfg.mix.master = clamp01(x01);
    if (ctx && audible()) writeMaster(masterGain(cfg.mix.master), seconds, 'linear');
  }

  /** Rain intensity 0..1. */
  function setRainIntensity(s) {
    cfg.rainIntensity = clamp01(s);
    layers.rain?.setIntensity(cfg.rainIntensity);
  }

  /** Ocean intensity 0..1. */
  function setOceanIntensity(i) {
    cfg.oceanIntensity = clamp01(i);
    layers.ocean?.setIntensity(cfg.oceanIntensity);
  }

  /** The pet cue through the purr layer; only while running and audible with the volume up. Resolves whether it played. */
  function purrCue() {
    if (!ctx || ctx.state !== 'running' || !audible() || masterTarget <= 0) return Promise.resolve(false);
    return ensureLayer('purr').cue();
  }

  /** 1 s 440 Hz hard left, then 1 s hard right, at −24 dBFS (post-master, so the volume slider does not matter); resolves when done. */
  function stereoCheck() {
    if (state === 'unavailable') return Promise.resolve(false);
    return unlock().then((result) => {
      if (result !== 'running') return false;
      const t0 = ctx.currentTime + 0.05;
      const amplitude = dbToGain(STEREO_CHECK.dbfs - CEILING_DB);
      checkTone(-1, t0, amplitude);
      checkTone(1, t0 + STEREO_CHECK.seconds, amplitude);
      return wait(STEREO_CHECK.tailMs).then(() => {
        if (state === 'idle' || state === 'ended') return suspendContext().then(() => true);
        return true;
      });
    });
  }

  function checkTone(pan, at, amplitude) {
    const { hz, seconds, edge } = STEREO_CHECK;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(amplitude, at + edge);
    env.gain.setValueAtTime(amplitude, at + seconds - edge);
    env.gain.linearRampToValueAtTime(0, at + seconds);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    osc.connect(env);
    env.connect(panner);
    panner.connect(master.chimeIn);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
      panner.disconnect();
    };
    osc.start(at);
    osc.stop(at + seconds + edge);
  }

  /** Attune: slow carrier sweep until commit or cancel (only while audible). */
  function startAttune(opts) {
    if (tone && audible()) tone.startAttune(opts);
  }

  /** Locks the swept carrier and returns it in Hz. */
  function commitAttune() {
    if (!tone) return preset?.carrierHz ?? null;
    const hz = tone.commitAttune();
    patchPreset({ carrierHz: hz });
    return hz;
  }

  /** Abandons the sweep and glides back. */
  function cancelAttune() {
    tone?.cancelAttune();
  }

  /** Arms the session timer; before play it waits for the session, while paused it waits for resume. */
  function armTimer(ms, opts = {}) {
    const options = { endFadeSeconds: preset?.endFadeSeconds ?? 30, chime: preset?.chime ?? 'none', after: 'stop', ...opts };
    if (!(ms > 0)) {
      cancelTimer();
      return;
    }
    leaveEnding();
    if (audible()) {
      pendingTimer = null;
      sessionTimer.arm(ms, options);
    } else if (state === 'paused' || state === 'pausing' || state === 'interrupted') {
      pendingTimer = null;
      sessionTimer.arm(ms, options);
      sessionTimer.pause();
    } else {
      pendingTimer = { ms, opts: options };
    }
  }

  /** Cancels the session timer (and restores the level if the end fade had begun). */
  function cancelTimer() {
    pendingTimer = null;
    sessionTimer.cancel();
    leaveEnding();
  }

  /** Milliseconds left, 0 without a timer. */
  function timerRemainingMs() {
    if (pendingTimer) return pendingTimer.ms;
    return sessionTimer.remainingMs();
  }

  /** §6.8 item 2: while the engine believes it is playing and the context is not running, resume with a 1.5 s timeout; failure → 'interrupted'. */
  function recover() {
    if (!ctx || suspending || !(audible() || state === 'interrupted')) return Promise.resolve(false);
    if (ctx.state === 'running') {
      if (state === 'interrupted') {
        setState('starting');
        runSession(FADES.resume);
      } else {
        sessionTimer.onVisible();
      }
      return Promise.resolve(true);
    }
    if (state === 'interrupted') return Promise.resolve(false);
    if (ctx.state === 'closed') {
      interrupted();
      return Promise.resolve(false);
    }
    if (recovering) return recovering;
    recovering = resumeContext().then((running) => {
      recovering = null;
      if (!audible()) return running;
      if (running) {
        scheduler.flush();
        sessionTimer.onVisible();
        return true;
      }
      interrupted();
      return false;
    });
    return recovering;
  }

  /** Closes the context and rebuilds the graph from the engine's own settings; a session fades back in over 0.8 s. */
  function rebuild() {
    if (!ctx || state === 'unavailable') return Promise.resolve(false);
    const inSession = audible() || state === 'interrupted';
    const paused = state === 'paused' || state === 'pausing';
    disposeGraph();
    try {
      createGraph();
    } catch (err) {
      setState('unavailable');
      warn('no-audio-context', err);
      return Promise.resolve(false);
    }
    if (!inSession) {
      if (preset && paused) ensureSessionGraph();
      return Promise.resolve(true);
    }
    setState('starting');
    return unlock().then((result) => {
      if (result !== 'running' || state !== 'starting') return false;
      runSession(FADES.rebuild);
      return true;
    });
  }

  /** { state, ctxTime, sampleRate, contextState, mode, carrierHz, beatHz, presetId, timer: { remainingMs, phase } }. */
  function getState() {
    const voice = tone ? tone.getState() : { mode: preset?.mode ?? null, carrierHz: preset?.carrierHz ?? null, beatHz: preset?.beatHz ?? null };
    return {
      state,
      ctxTime: ctx ? ctx.currentTime : 0,
      sampleRate: ctx ? ctx.sampleRate : 0,
      contextState: ctx ? ctx.state : null,
      mode: voice.mode,
      carrierHz: voice.carrierHz,
      beatHz: voice.beatHz,
      presetId: preset?.id ?? null,
      timer: { remainingMs: timerRemainingMs(), phase: pendingTimer ? 'paused' : sessionTimer.phase() },
    };
  }

  /** Current linear gains { master, tone, rain, ocean, purr } (sliders through their tapers, 0 when muted). */
  function getLevels() {
    return {
      master: masterGain(cfg.mix.master),
      tone: effectiveLevel('tone'),
      rain: effectiveLevel('rain'),
      ocean: effectiveLevel('ocean'),
      purr: effectiveLevel('purr'),
    };
  }

  /** RMS 0..1 at a layer bus ('tone' | 'rain' | 'ocean' | 'purr') or the output ('master'); 0 without a context. */
  function meter(layer = 'master') {
    if (!ctx) return 0;
    if (!meters[layer]) {
      if (layer === 'master') meters.master = master.analyser;
      else if (buses[layer]) {
        meters[layer] = ctx.createAnalyser();
        meters[layer].fftSize = 256;
        buses[layer].connect(meters[layer]);
      } else throw new RangeError(`engine: unknown layer "${layer}"`);
    }
    const samples = new Float32Array(meters[layer].fftSize);
    meters[layer].getFloatTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / samples.length);
  }

  /** Scheduler hidden mode (slower ticks, longer lookahead); lifecycle.js calls it on visibilitychange. */
  function setHidden(hidden) {
    scheduler?.setHidden(hidden);
  }

  /** Stops everything and closes the context. */
  function dispose() {
    sessionTimer.cancel();
    pendingPlay = null;
    pendingTimer = null;
    for (const handle of timers) clearTimer(handle);
    timers.clear();
    disposeGraph();
    listeners.clear();
    state = 'idle';
  }

  return {
    unlock, play, pause, resume, stop,
    applyPreset, setMode, setCarrier, setBeat, setTimbre, setPad,
    setLayerLevel, setMuted, setMaster, setRainIntensity, setOceanIntensity,
    purrCue, stereoCheck, startAttune, commitAttune, cancelAttune,
    armTimer, cancelTimer, timerRemainingMs,
    recover, rebuild, getState, getLevels, meter, setHidden,
    getContext: () => ctx,
    on, dispose,
  };
}
