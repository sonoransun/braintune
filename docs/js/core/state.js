// Settings schema, migration and an observable store. Pure: storage and timers are injected.

/** Key under which settings are kept in the injected storage. */
export const STORAGE_KEY = 'braintune:settings:v1';

/** Current settings schema version; migrate() always stamps it. */
export const SETTINGS_VERSION = 2;

/** Default settings, deep-frozen; the store always hands out fresh clones. */
export const DEFAULT_SETTINGS = deepFreeze({
  v: SETTINGS_VERSION,
  firstRunDone: false,
  listening: 'speakers',
  presetId: 'sleep',
  custom: null,
  mix: { master: 0.45, tone: 0.5, rain: 0.6, ocean: 0.55, purr: 0.55 },
  muted: { tone: false, rain: false, ocean: false, purr: false },
  rainIntensity: 0.35,
  oceanIntensity: 0.35,
  timer: { byPreset: {}, after: 'stop' },
  theme: 'dark',
  motion: 'auto',
  scene: 'full',
  cats: { enabled: true, spotted: 0 },
  haptics: true,
  shortcuts: true,
  keepAwake: false,
  nightDim: true,
  session: null,
  hints: { orb: true, sheet: true, stereoCheckDone: false },
});

const CUSTOM_TEMPLATE = deepFreeze({ beatHz: 10, carrierHz: 256, timbre: 'velvet', pad: true, mode: 'auto' });
const SESSION_TEMPLATE = deepFreeze({ presetId: 'sleep', endsAt: null, pausedRemainingMs: null });
const TIMBRES = ['sine', 'velvet', 'glass', 'warm'];
const MODES = ['auto', 'binaural', 'monaural', 'isochronic'];
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
  timer: shape({ byPreset: minutesMap, after: oneOf(['stop', 'ambient']) }),
  theme: oneOf(['dark', 'light', 'auto']),
  motion: oneOf(['auto', 'full', 'still']),
  scene: oneOf(['full', 'off']),
  cats: shape({ enabled: bool, spotted: count }),
  haptics: bool,
  shortcuts: bool,
  keepAwake: bool,
  nightDim: bool,
  session,
  hints: shape({ orb: bool, sheet: bool, stereoCheckDone: bool }),
};

// --- public API -------------------------------------------------------------

/** Coerces any value into valid settings: unknown keys dropped, numbers clamped, enums checked, version stamped. */
/** Keys a v1 store keeps when it moves to v2; everything else takes the v2 defaults (Sleep, purr and rain on, low volume, ∞ timer). */
const KEPT_FROM_V1 = ['firstRunDone', 'listening', 'theme', 'motion', 'scene', 'cats', 'haptics', 'shortcuts', 'keepAwake', 'nightDim', 'hints'];

/** Validated settings from any stored value; a v1 store keeps only personal choices so the v2 defaults apply once. */
export function migrate(raw) {
  if (isPlainObject(raw) && raw.v === 1) {
    raw = Object.fromEntries(KEPT_FROM_V1.filter((key) => key in raw).map((key) => [key, raw[key]]));
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
