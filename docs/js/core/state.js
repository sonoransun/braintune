// Settings schema, migration and an observable store. Pure: storage and timers are injected.

import { getPreset } from './presets.js';

/** Key under which settings are kept in the injected storage. */
export const STORAGE_KEY = 'braintune:settings:v1';

/** Current settings schema version; migrate() always stamps it. */
export const SETTINGS_VERSION = 4;

/** Default settings, deep-frozen; the store always hands out fresh clones. */
export const DEFAULT_SETTINGS = deepFreeze({
  v: SETTINGS_VERSION,
  firstRunDone: false,
  listening: 'speakers',
  presetId: 'sleep',
  custom: null,
  mix: { master: 0.45, tone: 0.35, rain: 0.7, ocean: 0.65, purr: 0.5 },
  muted: { tone: false, rain: false, ocean: false, purr: false },
  rainIntensity: 0.35,
  oceanIntensity: 0.25,
  padStyle: 'auto',
  timer: { byPreset: {}, after: 'stop' },
  theme: 'dark',
  motion: 'auto',
  scene: 'full',
  cats: { enabled: true, spotted: 0 },
  haptics: true,
  shortcuts: true,
  keepAwake: false,
  nightDim: true,
  autoplay: true,
  session: null,
  hints: { orb: true, sheet: true, stereoCheckDone: false },
});

const CUSTOM_TEMPLATE = deepFreeze({ beatHz: 10, carrierHz: 256, timbre: 'velvet', pad: true, mode: 'auto' });
const SESSION_TEMPLATE = deepFreeze({ presetId: 'sleep', endsAt: null, pausedRemainingMs: null });
const TIMBRES = ['sine', 'velvet', 'warm', 'amber', 'glass', 'bell'];
const MODES = ['auto', 'binaural', 'monaural', 'isochronic'];
const PAD_STYLES = ['auto', 'drone', 'canon'];
const LAYERS = ['tone', 'rain', 'ocean', 'purr'];
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// --- generic helpers --------------------------------------------------------

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function clone(value) {
  if (Array.isArray(value)) return value.map(clone);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

function deepEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const keysA = Object.keys(a);
  return keysA.length === Object.keys(b).length && keysA.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

function deepFreeze(value) {
  if (isPlainObject(value) || Array.isArray(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
}

function assertSafeKeys(keys) {
  for (const key of keys) {
    if (key === '' || UNSAFE_KEYS.has(key)) throw new TypeError(`Invalid settings key: ${key}`);
  }
}

// --- validation rules: (value, fallback) => validated value -----------------

const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const unit = (v, d) => (isFiniteNumber(v) ? Math.min(1, Math.max(0, v)) : d);
const count = (v, d) => (isFiniteNumber(v) && v >= 0 ? Math.floor(v) : d);
const positive = (v, d) => (isFiniteNumber(v) && v > 0 ? v : d);
const text = (v, d) => (typeof v === 'string' && v.length > 0 && v.length <= 64 ? v : d);
const oneOf = (allowed) => (v, d) => (allowed.includes(v) ? v : d);
const numberOrNull = (v) => (isFiniteNumber(v) ? v : null);
const nonNegativeOrNull = (v) => (isFiniteNumber(v) && v >= 0 ? v : null);

function validateShape(raw, defaults, rules) {
  const source = isPlainObject(raw) ? raw : {};
  const out = {};
  for (const key of Object.keys(defaults)) out[key] = rules[key](source[key], defaults[key]);
  return out;
}

const shape = (rules) => (v, d) => validateShape(v, d, rules);

function minutesMap(raw) {
  const out = {};
  if (!isPlainObject(raw)) return out;
  for (const [id, minutes] of Object.entries(raw)) {
    const valid = minutes === null || (isFiniteNumber(minutes) && minutes >= 0);
    if (valid && !UNSAFE_KEYS.has(id)) out[id] = minutes;
  }
  return out;
}

const CUSTOM_RULES = { beatHz: positive, carrierHz: positive, timbre: oneOf(TIMBRES), pad: bool, mode: oneOf(MODES) };
const SESSION_RULES = { presetId: text, endsAt: numberOrNull, pausedRemainingMs: nonNegativeOrNull };

function custom(raw) {
  return isPlainObject(raw) ? validateShape(raw, CUSTOM_TEMPLATE, CUSTOM_RULES) : null;
}

function session(raw) {
  if (!isPlainObject(raw)) return null;
  const valid = validateShape(raw, SESSION_TEMPLATE, SESSION_RULES);
  return valid.endsAt === null && valid.pausedRemainingMs === null ? null : valid;
}

const TOP_RULES = {
  v: () => SETTINGS_VERSION,
  firstRunDone: bool,
  listening: oneOf(['speakers', 'headphones']),
  presetId: text,
  custom,
  mix: shape({ master: unit, tone: unit, rain: unit, ocean: unit, purr: unit }),
  muted: shape({ tone: bool, rain: bool, ocean: bool, purr: bool }),
  rainIntensity: unit,
  oceanIntensity: unit,
  padStyle: oneOf(PAD_STYLES),
  timer: shape({ byPreset: minutesMap, after: oneOf(['stop', 'ambient']) }),
  theme: oneOf(['dark', 'light', 'auto']),
  motion: oneOf(['auto', 'full', 'still']),
  scene: oneOf(['full', 'off']),
  cats: shape({ enabled: bool, spotted: count }),
  haptics: bool,
  shortcuts: bool,
  keepAwake: bool,
  nightDim: bool,
  autoplay: bool,
  session,
  hints: shape({ orb: bool, sheet: bool, stereoCheckDone: bool }),
};

// --- migration --------------------------------------------------------------

/** Keys every older store keeps when it moves to the current version; everything else takes the new defaults (Sleep with a moderate purr, a quiet tone, rain on, low volume, ∞ timer). */
const KEPT_ACROSS_VERSIONS = ['firstRunDone', 'listening', 'theme', 'motion', 'scene', 'cats', 'haptics', 'shortcuts', 'keepAwake', 'nightDim', 'hints', 'padStyle'];

/** Keys a v3 store also keeps: what it was playing and how (its master volume and layer mix follow fromV3). */
const KEPT_FROM_V3 = ['presetId', 'timer', 'autoplay', 'custom', 'session', 'muted', 'rainIntensity', 'oceanIntensity'];

/** Layer mixes the v3 Sleep and Deep sleep presets stored; a v3 store still on one of them takes the preset's current mix. */
const V3_PRESET_MIX = deepFreeze({
  sleep: { tone: 0.35, rain: 0.6, ocean: 0.55, purr: 0.45 },
  deep: { tone: 0.3, rain: 0.65, ocean: 0.6, purr: 0.45 },
});

/** Sea intensity of the v3 Sleep preset; a stock Sleep store moves on to Sleep's current sea. */
const V3_SLEEP_SEA = 0.35;

function pick(raw, keys) {
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(raw, key)).map((key) => [key, raw[key]]));
}

/** A v3 store's kept keys with its master volume; a stock Sleep or Deep sleep layer mix (and Sleep's stock sea) moves to the preset's current values, any other mix stays. */
function fromV3(raw) {
  const out = pick(raw, [...KEPT_ACROSS_VERSIONS, ...KEPT_FROM_V3]);
  const mix = isPlainObject(raw.mix) ? raw.mix : {};
  const stock = Object.hasOwn(V3_PRESET_MIX, raw.presetId) && LAYERS.every((layer) => mix[layer] === V3_PRESET_MIX[raw.presetId][layer]);
  if (!stock) return { ...out, mix };
  const preset = getPreset(raw.presetId);
  const sea = raw.presetId === 'sleep' && raw.oceanIntensity === V3_SLEEP_SEA ? { oceanIntensity: preset.oceanIntensity } : {};
  return { ...out, ...sea, mix: { ...preset.mix, master: mix.master } };
}

// --- public API -------------------------------------------------------------

/** Validated settings from any stored value: unknown keys dropped, numbers clamped, enums checked, version stamped; an older versioned store keeps only personal choices (a v3 store also what it was playing, fromV3) so new defaults apply once. */
export function migrate(raw) {
  if (isPlainObject(raw) && Number.isInteger(raw.v) && raw.v < SETTINGS_VERSION) {
    raw = raw.v === 3 ? fromV3(raw) : pick(raw, KEPT_ACROSS_VERSIONS);
  }
  return validateShape(raw, DEFAULT_SETTINGS, TOP_RULES);
}

/** Serialises settings to a JSON string. */
export function serialize(settings) {
  return JSON.stringify(settings);
}

/** Parses a serialised settings string; corrupt or non-object input yields defaults and never throws. */
export function parse(str) {
  try {
    return migrate(JSON.parse(str));
  } catch {
    return migrate(undefined);
  }
}

/** Remaining time a stored session needs, in ms, to be resumed rather than started afresh. */
const RESUME_MIN_MS = 60000;

/** What a start from Play on open plays: { kind: 'resume', presetId, remainingMs } when the stored session (paused, or running until endsAt) has more than a minute left at time now (ms), else { kind: 'fresh', presetId }. */
export function startPlan(settings, now) {
  const session = settings?.session;
  const left = session ? session.pausedRemainingMs ?? (session.endsAt === null ? 0 : session.endsAt - now) : 0;
  if (left > RESUME_MIN_MS) return { kind: 'resume', presetId: session.presetId, remainingMs: left };
  return { kind: 'fresh', presetId: settings?.presetId ?? DEFAULT_SETTINGS.presetId };
}

/** Creates an observable settings store backed by a Storage-like object; storage failures leave it in memory. */
export function createStore(storage, { key = STORAGE_KEY, debounceMs = 0, setTimer, clearTimer } = {}) {
  const subscribers = new Set();
  let persisted = true;
  let pending = null;
  let state = readInitial();

  function readInitial() {
    try {
      return parse(storage.getItem(key));
    } catch {
      persisted = false;
      return migrate(undefined);
    }
  }

  function write() {
    pending = null;
    try {
      storage.setItem(key, serialize(state));
      persisted = true;
    } catch {
      persisted = false;
    }
  }

  function cancelPending() {
    if (pending !== null && typeof clearTimer === 'function') clearTimer(pending);
    pending = null;
  }

  function scheduleWrite() {
    if (!(debounceMs > 0) || typeof setTimer !== 'function') {
      write();
      return;
    }
    cancelPending();
    pending = setTimer(write, debounceMs);
  }

  function flush() {
    if (pending === null) return;
    cancelPending();
    write();
  }

  function notify(keys) {
    const snapshot = clone(state);
    for (const fn of [...subscribers]) fn(keys, snapshot);
  }

  function commit(next) {
    const changed = Object.keys(next).filter((k) => !deepEqual(state[k], next[k]));
    if (changed.length === 0) return;
    state = next;
    scheduleWrite();
    notify(changed);
  }

  function set(path, value) {
    const segments = String(path).split('.');
    assertSafeKeys(segments);
    const next = clone(state);
    let cursor = next;
    for (const segment of segments.slice(0, -1)) {
      if (!isPlainObject(cursor[segment])) cursor[segment] = {};
      cursor = cursor[segment];
    }
    cursor[segments[segments.length - 1]] = clone(value);
    commit(next);
  }

  function patch(partial) {
    if (!isPlainObject(partial)) return;
    const keys = Object.keys(partial);
    assertSafeKeys(keys);
    const next = clone(state);
    for (const key of keys) {
      const value = clone(partial[key]);
      next[key] = isPlainObject(value) && isPlainObject(next[key]) ? { ...next[key], ...value } : value;
    }
    commit(next);
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  function reset() {
    state = migrate(undefined);
    scheduleWrite();
    notify(Object.keys(DEFAULT_SETTINGS));
  }

  return {
    get: () => clone(state),
    set,
    patch,
    subscribe,
    reset,
    snapshot: () => serialize(state),
    flush,
    get persisted() {
      return persisted;
    },
  };
}
