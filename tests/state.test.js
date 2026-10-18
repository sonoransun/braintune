import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, SETTINGS_VERSION, DEFAULT_SETTINGS, migrate, serialize, parse, createStore, startPlan } from '../docs/js/core/state.js';
import { getPreset } from '../docs/js/core/presets.js';
import { createFakeStorage, throwingStorage } from './helpers/fake-storage.js';

function fakeTimers() {
  let seq = 0;
  const timers = new Map();
  return {
    setTimer: (fn, ms) => {
      seq += 1;
      timers.set(seq, { fn, ms });
      return seq;
    },
    clearTimer: (id) => timers.delete(id),
    run: () => {
      for (const [id, { fn }] of [...timers]) {
        timers.delete(id);
        fn();
      }
    },
    pending: () => timers.size,
  };
}

test('defaults match the plan and are deep-frozen', () => {
  assert.equal(STORAGE_KEY, 'braintune:settings:v1');
  assert.equal(SETTINGS_VERSION, 4);
  assert.equal(DEFAULT_SETTINGS.v, 4);
  assert.equal(DEFAULT_SETTINGS.autoplay, true);
  assert.equal(DEFAULT_SETTINGS.listening, 'speakers');
  assert.equal(DEFAULT_SETTINGS.presetId, 'sleep');
  assert.deepEqual(DEFAULT_SETTINGS.mix, { master: 0.45, tone: 0.35, rain: 0.7, ocean: 0.65, purr: 0.5 });
  assert.equal(DEFAULT_SETTINGS.rainIntensity, 0.35);
  assert.equal(DEFAULT_SETTINGS.oceanIntensity, 0.25);
  assert.equal(DEFAULT_SETTINGS.padStyle, 'auto');
  const sleep = getPreset('sleep');
  assert.deepEqual(DEFAULT_SETTINGS.mix, { master: 0.45, ...sleep.mix }, 'the default layer mix is Sleep\'s');
  assert.deepEqual([DEFAULT_SETTINGS.rainIntensity, DEFAULT_SETTINGS.oceanIntensity], [sleep.rainIntensity, sleep.oceanIntensity]);
  assert.deepEqual(DEFAULT_SETTINGS.timer, { byPreset: {}, after: 'stop' });
  assert.equal(DEFAULT_SETTINGS.theme, 'dark');
  assert.equal(DEFAULT_SETTINGS.keepAwake, false);
  assert.equal(DEFAULT_SETTINGS.nightDim, true);
  assert.equal(DEFAULT_SETTINGS.custom, null);
  assert.equal(DEFAULT_SETTINGS.session, null);
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS));
  assert.ok(Object.isFrozen(DEFAULT_SETTINGS.mix));
  assert.throws(() => {
    DEFAULT_SETTINGS.mix.master = 1;
  }, TypeError);
});

test('migrate of nothing yields a fresh copy of the defaults', () => {
  const a = migrate(undefined);
  assert.deepEqual(a, DEFAULT_SETTINGS);
  assert.notEqual(a, DEFAULT_SETTINGS);
  assert.notEqual(a.mix, DEFAULT_SETTINGS.mix);
  a.mix.master = 0.1;
  assert.equal(DEFAULT_SETTINGS.mix.master, 0.45);
  for (const raw of [null, 'text', 42, [], true]) assert.deepEqual(migrate(raw), DEFAULT_SETTINGS);
});

test('serialize/parse round-trip keeps every value', () => {
  const s = migrate({ listening: 'headphones', mix: { master: 0.4 }, cats: { spotted: 7 }, custom: { beatHz: 7.5, carrierHz: 300, timbre: 'glass', pad: false, mode: 'binaural' } });
  const back = parse(serialize(s));
  assert.deepEqual(back, s);
  assert.equal(back.listening, 'headphones');
  assert.equal(back.mix.master, 0.4);
  assert.equal(back.mix.tone, DEFAULT_SETTINGS.mix.tone);
  assert.equal(back.cats.spotted, 7);
  assert.deepEqual(back.custom, { beatHz: 7.5, carrierHz: 300, timbre: 'glass', pad: false, mode: 'binaural' });
});

test('corrupt input parses to defaults without throwing', () => {
  for (const raw of ['{not json', '', null, undefined, '"string"', '[1,2]', '42', 'null']) {
    assert.deepEqual(parse(raw), DEFAULT_SETTINGS, `raw=${String(raw)}`);
  }
});

test('unknown keys are dropped at every level and the version is bumped', () => {
  const out = migrate({ v: 0, extra: 1, mix: { master: 0.5, bogus: 2 }, hints: { orb: false, nope: true }, __proto__: { polluted: true } });
  assert.deepEqual(Object.keys(out), Object.keys(DEFAULT_SETTINGS));
  assert.deepEqual(Object.keys(out.mix), Object.keys(DEFAULT_SETTINGS.mix));
  assert.deepEqual(Object.keys(out.hints), Object.keys(DEFAULT_SETTINGS.hints));
  assert.equal(out.v, SETTINGS_VERSION);
  assert.equal(out.hints.orb, false);
  assert.equal(Object.hasOwn(out, 'polluted'), false);
});

test('0..1 numbers are clamped, counters floored, bad types replaced', () => {
  const out = migrate({ mix: { master: 1.4, tone: -1, rain: 'loud', purr: 0.3 }, rainIntensity: 2, oceanIntensity: NaN, cats: { spotted: 3.9 }, haptics: 'yes' });
  assert.equal(out.mix.master, 1);
  assert.equal(out.mix.tone, 0);
  assert.equal(out.mix.rain, DEFAULT_SETTINGS.mix.rain);
  assert.equal(out.mix.purr, 0.3);
  assert.equal(out.rainIntensity, 1);
  assert.equal(out.oceanIntensity, DEFAULT_SETTINGS.oceanIntensity);
  assert.equal(out.cats.spotted, 3);
  assert.equal(migrate({ cats: { spotted: -4 } }).cats.spotted, 0);
  assert.equal(out.haptics, true);
});

test('enums fall back to defaults when invalid', () => {
  const out = migrate({ listening: 'earbuds', theme: 'sepia', motion: 'wild', scene: 'half', timer: { after: 'loop' }, custom: { mode: 'quad' }, padStyle: 'fugue' });
  assert.equal(out.padStyle, 'auto');
  for (const padStyle of ['auto', 'drone', 'canon']) assert.equal(migrate({ padStyle }).padStyle, padStyle);
  assert.equal(out.listening, 'speakers');
  assert.equal(out.theme, 'dark');
  assert.equal(out.motion, 'auto');
  assert.equal(out.scene, 'full');
  assert.equal(out.timer.after, 'stop');
  assert.equal(out.custom.mode, 'auto');
  const ok = migrate({ listening: 'headphones', theme: 'auto', motion: 'still', scene: 'off', timer: { after: 'ambient' }, custom: { mode: 'isochronic' } });
  assert.equal(ok.listening, 'headphones');
  assert.equal(ok.theme, 'auto');
  assert.equal(ok.motion, 'still');
  assert.equal(ok.scene, 'off');
  assert.equal(ok.timer.after, 'ambient');
  assert.equal(ok.custom.mode, 'isochronic');
});

test('nested objects merge over defaults; nullable objects validate or vanish', () => {
  const out = migrate({ mix: { ocean: 0.2 }, timer: { byPreset: { sleep: 45, focus: null, bad: 'x', neg: -1 } }, custom: { beatHz: -3, timbre: 'wood' }, session: { presetId: 'focus', endsAt: 1700000000000 } });
  assert.deepEqual(out.mix, { ...DEFAULT_SETTINGS.mix, ocean: 0.2 });
  assert.deepEqual(out.timer.byPreset, { sleep: 45, focus: null });
  assert.deepEqual(out.custom, { beatHz: 10, carrierHz: 256, timbre: 'velvet', pad: true, mode: 'auto' });
  assert.deepEqual(out.session, { presetId: 'focus', endsAt: 1700000000000, pausedRemainingMs: null });
  assert.equal(migrate({ session: { presetId: 'calm' } }).session, null);
  assert.equal(migrate({ session: 'later' }).session, null);
  assert.equal(migrate({ custom: 'yes' }).custom, null);
  assert.deepEqual(migrate({ session: { pausedRemainingMs: 5000 } }).session, { presetId: 'sleep', endsAt: null, pausedRemainingMs: 5000 });
});

test('store reads once at creation and persists after each change', () => {
  const storage = createFakeStorage({ [STORAGE_KEY]: { theme: 'light', mix: { master: 0.3 } } });
  const store = createStore(storage);
  assert.equal(store.get().theme, 'light');
  assert.equal(store.get().mix.master, 0.3);
  assert.equal(store.get().mix.rain, DEFAULT_SETTINGS.mix.rain);
  assert.equal(store.persisted, true);
  store.set('mix.master', 0.5);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).mix.master, 0.5);
  assert.equal(store.snapshot(), storage.getItem(STORAGE_KEY));
  assert.equal(store.persisted, true);
});

test('get() returns clones; mutating them never touches the store', () => {
  const store = createStore(createFakeStorage());
  const a = store.get();
  a.mix.master = 0;
  a.cats.spotted = 99;
  assert.equal(store.get().mix.master, DEFAULT_SETTINGS.mix.master);
  assert.equal(store.get().cats.spotted, 0);
  const obj = { beatHz: 8, carrierHz: 300, timbre: 'sine', pad: false, mode: 'auto' };
  store.set('custom', obj);
  obj.beatHz = 1;
  assert.equal(store.get().custom.beatHz, 8);
});

test('throwing storage leaves an in-memory store with persisted=false', () => {
  const store = createStore(throwingStorage());
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.equal(store.persisted, false);
  store.set('theme', 'light');
  assert.equal(store.get().theme, 'light');
  assert.equal(store.persisted, false);
  store.patch({ cats: { spotted: 2 } });
  assert.equal(store.get().cats.spotted, 2);
  assert.equal(store.get().cats.enabled, true);
  store.reset();
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.equal(createStore(undefined).persisted, false);
});

test('a storage that starts working then fails flips persisted', () => {
  const storage = createFakeStorage();
  const store = createStore(storage);
  store.set('theme', 'auto');
  assert.equal(store.persisted, true);
  storage.setItem = () => {
    throw new Error('quota');
  };
  store.set('theme', 'light');
  assert.equal(store.persisted, false);
  assert.equal(store.get().theme, 'light');
});

test('subscribers get only the changed top-level keys', () => {
  const store = createStore(createFakeStorage());
  const calls = [];
  const off = store.subscribe((keys, state) => calls.push({ keys, state }));
  store.set('mix.master', 0.2);
  assert.deepEqual(calls.at(-1).keys, ['mix']);
  assert.equal(calls.at(-1).state.mix.master, 0.2);
  store.patch({ theme: 'light', haptics: false, mix: { tone: 0.1 } });
  assert.deepEqual([...calls.at(-1).keys].sort(), ['haptics', 'mix', 'theme']);
  assert.deepEqual(calls.at(-1).state.mix, { ...DEFAULT_SETTINGS.mix, master: 0.2, tone: 0.1 });
  const before = calls.length;
  store.set('mix.master', 0.2);
  store.patch({ theme: 'light', mix: { tone: 0.1 } });
  assert.equal(calls.length, before, 'unchanged writes do not notify');
  off();
  store.set('theme', 'dark');
  assert.equal(calls.length, before);
});

test('patch shallow-merges plain objects and replaces everything else', () => {
  const store = createStore(createFakeStorage());
  store.patch({ hints: { orb: false } });
  assert.deepEqual(store.get().hints, { orb: false, sheet: true, stereoCheckDone: false });
  store.patch({ custom: { beatHz: 6, carrierHz: 220, timbre: 'warm', pad: true, mode: 'auto' } });
  assert.equal(store.get().custom.beatHz, 6);
  store.patch({ custom: null, session: { presetId: 'rest', endsAt: 5, pausedRemainingMs: null } });
  assert.equal(store.get().custom, null);
  assert.equal(store.get().session.presetId, 'rest');
  assert.throws(() => store.set('__proto__.x', 1), TypeError);
  assert.throws(() => store.patch({ constructor: {} }), TypeError);
});

test('reset returns to defaults and notifies with every top-level key', () => {
  const storage = createFakeStorage();
  const store = createStore(storage);
  store.set('theme', 'light');
  store.set('cats.spotted', 12);
  let received = null;
  store.subscribe((keys) => {
    received = keys;
  });
  store.reset();
  assert.deepEqual(store.get(), DEFAULT_SETTINGS);
  assert.deepEqual(received, Object.keys(DEFAULT_SETTINGS));
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), DEFAULT_SETTINGS);
});

test('debounced writes coalesce through the injected timers', () => {
  const storage = createFakeStorage();
  const timers = fakeTimers();
  const store = createStore(storage, { debounceMs: 250, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  store.set('mix.master', 0.1);
  store.set('mix.master', 0.2);
  store.set('mix.master', 0.3);
  assert.equal(storage.getItem(STORAGE_KEY), null, 'nothing written before the timer fires');
  assert.equal(timers.pending(), 1, 'earlier timers were cleared');
  timers.run();
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).mix.master, 0.3);
  store.set('theme', 'light');
  store.flush();
  assert.equal(timers.pending(), 0);
  assert.equal(JSON.parse(storage.getItem(STORAGE_KEY)).theme, 'light');
  store.flush();
});

test('a custom key is honoured', () => {
  const storage = createFakeStorage();
  const store = createStore(storage, { key: 'other' });
  store.set('theme', 'light');
  assert.ok(storage.getItem('other'));
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('a v1 store keeps personal choices and lands on the current defaults once (Sleep, purr and rain on, quiet, ∞ timer)', () => {
  const v1 = {
    v: 1, firstRunDone: true, listening: 'headphones', presetId: 'focus', theme: 'light', cats: { enabled: true, spotted: 7 },
    mix: { master: 0.9, tone: 0.55, rain: 0, ocean: 0.55, purr: 0 }, timer: { byPreset: { focus: 45 }, after: 'ambient' },
  };
  const out = migrate(v1);
  assert.equal(out.v, 4);
  assert.deepEqual([out.firstRunDone, out.listening, out.theme, out.cats.spotted], [true, 'headphones', 'light', 7]);
  assert.equal(out.presetId, 'sleep');
  assert.deepEqual(out.mix, DEFAULT_SETTINGS.mix);
  assert.deepEqual(out.timer, { byPreset: {}, after: 'stop' });
  const again = migrate(JSON.parse(JSON.stringify(out)));
  assert.deepEqual(again, out, 'a current store is not reset again');
  assert.equal(migrate({ mix: { master: 0.3 } }).mix.master, 0.3, 'unversioned input is validated, not reset');
});

test('a v2 store also lands on the current defaults once (quieter tone, moderate purr, Play on open)', () => {
  const v2 = { v: 2, firstRunDone: true, presetId: 'calm', autoplay: false, mix: { master: 0.7, tone: 0.5, rain: 0.6, ocean: 0.55, purr: 0.55 }, timer: { byPreset: { calm: 30 }, after: 'stop' } };
  const out = migrate(v2);
  assert.equal(out.v, 4);
  assert.equal(out.firstRunDone, true);
  assert.equal(out.presetId, 'sleep');
  assert.equal(out.autoplay, true);
  assert.deepEqual(out.mix, DEFAULT_SETTINGS.mix, 'not even the master volume survives from v2');
  assert.deepEqual(out.timer, DEFAULT_SETTINGS.timer);
  assert.equal(out.oceanIntensity, DEFAULT_SETTINGS.oceanIntensity);
  assert.equal(migrate({ ...out, autoplay: false }).autoplay, false, 'a current choice to turn autoplay off sticks');
});

/** A v3 store as 0.3 wrote it after a few choices: Sleep's stock mix at a raised volume, Play on open off, a custom pitch. */
const V3_SLEEP = Object.freeze({
  v: 3, firstRunDone: true, listening: 'headphones', presetId: 'sleep',
  custom: { beatHz: 2, carrierHz: 220, timbre: 'velvet', pad: true, mode: 'auto' },
  mix: { master: 0.7, tone: 0.35, rain: 0.6, ocean: 0.55, purr: 0.45 },
  muted: { tone: false, rain: true, ocean: false, purr: false },
  rainIntensity: 0.35, oceanIntensity: 0.35,
  timer: { byPreset: { sleep: 720, focus: 45 }, after: 'ambient' },
  theme: 'light', motion: 'auto', scene: 'full', cats: { enabled: true, spotted: 12 }, haptics: false, shortcuts: true,
  keepAwake: true, nightDim: false, autoplay: false,
  session: { presetId: 'sleep', endsAt: null, pausedRemainingMs: 90_000 },
  hints: { orb: false, sheet: false, stereoCheckDone: true },
});

test('a v3 store at master 0.7 on Sleep with the stock mix keeps 0.7, its preset, timers, Play on open off and custom, and takes Sleep\'s new layer mix and sea .25', () => {
  const out = migrate(JSON.parse(JSON.stringify(V3_SLEEP)));
  const sleep = getPreset('sleep');
  assert.equal(out.v, 4);
  assert.deepEqual(out.mix, { master: 0.7, ...sleep.mix });
  assert.deepEqual(out.mix, { master: 0.7, tone: 0.35, rain: 0.7, ocean: 0.65, purr: 0.5 });
  assert.equal(out.oceanIntensity, 0.25);
  assert.equal(out.rainIntensity, 0.35);
  assert.equal(out.presetId, 'sleep');
  assert.deepEqual(out.timer, { byPreset: { sleep: 720, focus: 45 }, after: 'ambient' });
  assert.equal(out.autoplay, false);
  assert.deepEqual(out.custom, V3_SLEEP.custom);
  assert.deepEqual(out.session, V3_SLEEP.session, 'a paused session can still be resumed');
  assert.deepEqual(out.muted, V3_SLEEP.muted);
  assert.equal(out.padStyle, 'auto');
  for (const key of ['firstRunDone', 'listening', 'theme', 'haptics', 'keepAwake', 'nightDim']) assert.equal(out[key], V3_SLEEP[key], key);
  assert.deepEqual([out.cats, out.hints], [V3_SLEEP.cats, V3_SLEEP.hints]);
  assert.deepEqual(migrate(JSON.parse(JSON.stringify(out))), out, 'a v4 store is not reset again');
});

test('a v3 store with a hand-set mix keeps it, with its sea and rain; a stock Sleep mix keeps a hand-set sea', () => {
  const handSet = { ...V3_SLEEP, mix: { master: 0.3, tone: 0.2, rain: 0.6, ocean: 0.55, purr: 0.45 }, rainIntensity: 0.8, oceanIntensity: 0.35 };
  const out = migrate(handSet);
  assert.deepEqual(out.mix, handSet.mix);
  assert.deepEqual([out.rainIntensity, out.oceanIntensity], [0.8, 0.35]);
  const calm = migrate({ ...V3_SLEEP, presetId: 'calm', mix: { master: 0.45, ...getPreset('calm').mix }, rainIntensity: 0.45, oceanIntensity: 0.35 });
  assert.deepEqual(calm.mix, { master: 0.45, ...getPreset('calm').mix }, 'presets whose mix did not change keep theirs');
  assert.deepEqual([calm.presetId, calm.rainIntensity, calm.oceanIntensity], ['calm', 0.45, 0.35]);
  assert.equal(migrate({ ...V3_SLEEP, oceanIntensity: 0.6 }).oceanIntensity, 0.6, 'only the stock sea moves');
  const missing = migrate({ v: 3, presetId: 'sleep' });
  assert.deepEqual(missing.mix, DEFAULT_SETTINGS.mix, 'a v3 store without a mix takes the defaults');
});

test('a v3 store on Deep sleep with its stock mix takes Deep sleep\'s new mix; other stored values are validated', () => {
  const deep = getPreset('deep');
  const out = migrate({ v: 3, presetId: 'deep', mix: { master: 0.5, tone: 0.3, rain: 0.65, ocean: 0.6, purr: 0.45 }, rainIntensity: 0.25, oceanIntensity: 0.25 });
  assert.deepEqual(out.mix, { master: 0.5, ...deep.mix });
  assert.deepEqual([out.presetId, out.rainIntensity, out.oceanIntensity], ['deep', 0.25, 0.25]);
  assert.equal(migrate({ v: 3, presetId: 'deep', mix: { master: 'loud', tone: 0.3, rain: 0.65, ocean: 0.6, purr: 0.45 } }).mix.master, DEFAULT_SETTINGS.mix.master);
  assert.equal(migrate({ v: 3, presetId: 'constructor', mix: { master: 0.5 } }).presetId, 'constructor', 'an odd preset id is kept for the UI to resolve');
  assert.equal(migrate({ v: 3, custom: { ...V3_SLEEP.custom, timbre: 'amber' } }).custom.timbre, 'amber');
  assert.equal(migrate({ v: 3, custom: { ...V3_SLEEP.custom, timbre: 'brass' } }).custom.timbre, 'velvet');
  assert.equal(migrate({ v: 3, padStyle: 'canon' }).padStyle, 'canon');
  assert.equal(migrate({ v: 2, padStyle: 'drone' }).padStyle, 'drone', 'the pad style is a personal choice kept from any version');
});

test('startPlan: a stored session with more than a minute left resumes, anything else starts the current preset afresh', () => {
  const NOW = 1_700_000_000_000;
  const at = (session, extra = {}) => startPlan(migrate({ presetId: 'calm', ...extra, session }), NOW);
  assert.deepEqual(at(null), { kind: 'fresh', presetId: 'calm' }, 'no session');
  assert.deepEqual(startPlan(migrate(undefined), NOW), { kind: 'fresh', presetId: 'sleep' }, 'defaults start Sleep');
  assert.deepEqual(at({ presetId: 'rest', pausedRemainingMs: 90_000 }), { kind: 'resume', presetId: 'rest', remainingMs: 90_000 }, 'paused with 90 s left');
  assert.deepEqual(at({ presetId: 'rest', pausedRemainingMs: 30_000 }), { kind: 'fresh', presetId: 'calm' }, 'paused with 30 s left');
  assert.deepEqual(at({ presetId: 'rest', pausedRemainingMs: 60_000 }).kind, 'fresh', 'exactly a minute is not more than a minute');
  assert.deepEqual(at({ presetId: 'sleep', endsAt: NOW + 12 * 60_000 }), { kind: 'resume', presetId: 'sleep', remainingMs: 12 * 60_000 }, 'running, ending in the future');
  assert.deepEqual(at({ presetId: 'sleep', endsAt: NOW + 30_000 }), { kind: 'fresh', presetId: 'calm' }, 'running, 30 s left');
  assert.deepEqual(at({ presetId: 'sleep', endsAt: NOW - 5_000 }), { kind: 'fresh', presetId: 'calm' }, 'running, already over');
  assert.equal(at({ presetId: 'sleep', endsAt: NOW + 3_600_000, pausedRemainingMs: 120_000 }).remainingMs, 120_000, 'a paused remainder wins over endsAt');
  assert.deepEqual(startPlan({ presetId: 'focus', session: null }, Number.NaN), { kind: 'fresh', presetId: 'focus' });
  assert.equal(startPlan({ session: { presetId: 'sleep', endsAt: NOW + 120_000, pausedRemainingMs: null } }, Number.NaN).kind, 'fresh', 'an unknown clock never resumes');
});
