import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, SETTINGS_VERSION, DEFAULT_SETTINGS, migrate, serialize, parse, createStore } from '../docs/js/core/state.js';
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
  assert.equal(SETTINGS_VERSION, 2);
  assert.equal(DEFAULT_SETTINGS.v, 2);
  assert.equal(DEFAULT_SETTINGS.listening, 'speakers');
  assert.equal(DEFAULT_SETTINGS.presetId, 'sleep');
  assert.deepEqual(DEFAULT_SETTINGS.mix, { master: 0.45, tone: 0.5, rain: 0.6, ocean: 0.55, purr: 0.55 });
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
  assert.equal(out.oceanIntensity, 0.35);
  assert.equal(out.cats.spotted, 3);
  assert.equal(migrate({ cats: { spotted: -4 } }).cats.spotted, 0);
  assert.equal(out.haptics, true);
});

test('enums fall back to defaults when invalid', () => {
  const out = migrate({ listening: 'earbuds', theme: 'sepia', motion: 'wild', scene: 'half', timer: { after: 'loop' }, custom: { mode: 'quad' } });
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

test('a v1 store keeps personal choices and takes the v2 defaults once (Sleep, purr and rain on, quiet, ∞ timer)', () => {
  const v1 = {
    v: 1, firstRunDone: true, listening: 'headphones', presetId: 'focus', theme: 'light', cats: { enabled: true, spotted: 7 },
    mix: { master: 0.9, tone: 0.55, rain: 0, ocean: 0.55, purr: 0 }, timer: { byPreset: { focus: 45 }, after: 'ambient' },
  };
  const out = migrate(v1);
  assert.equal(out.v, 2);
  assert.deepEqual([out.firstRunDone, out.listening, out.theme, out.cats.spotted], [true, 'headphones', 'light', 7]);
  assert.equal(out.presetId, 'sleep');
  assert.deepEqual(out.mix, DEFAULT_SETTINGS.mix);
  assert.deepEqual(out.timer, { byPreset: {}, after: 'stop' });
  const again = migrate(JSON.parse(JSON.stringify(out)));
  assert.deepEqual(again, out, 'a v2 store is not reset again');
  assert.equal(migrate({ mix: { master: 0.3 } }).mix.master, 0.3, 'unversioned input is validated, not reset');
});
