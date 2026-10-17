import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mapKeyToAction } from '../docs/js/core/keyboard-map.js';

const ON = { shortcutsEnabled: true, typing: false, focusIsInteractive: false, dialogOpen: false };
const key = (k, extra = {}) => ({ key: k, code: '', metaKey: false, ctrlKey: false, altKey: false, ...extra });

test('Space and K toggle play only when focus is not interactive', () => {
  assert.equal(mapKeyToAction(key(' '), ON), 'toggle-play');
  assert.equal(mapKeyToAction(key(' ', { code: 'Space' }), ON), 'toggle-play');
  assert.equal(mapKeyToAction(key('k'), ON), 'toggle-play');
  assert.equal(mapKeyToAction(key('K'), ON), 'toggle-play');
  assert.equal(mapKeyToAction(key(' '), { ...ON, focusIsInteractive: true }), null);
  assert.equal(mapKeyToAction(key('k'), { ...ON, focusIsInteractive: true }), null);
  assert.equal(mapKeyToAction(key('m'), { ...ON, focusIsInteractive: true }), 'mute', 'other keys still work on interactive focus');
});

test('digits 1-8 select presets', () => {
  for (let n = 1; n <= 8; n += 1) assert.equal(mapKeyToAction(key(String(n)), ON), `preset:${n}`);
  assert.equal(mapKeyToAction(key('9'), ON), null);
  assert.equal(mapKeyToAction(key('0'), ON), null);
  assert.equal(mapKeyToAction(key('12'), ON), null);
});

test('letters map case-insensitively and ? opens About', () => {
  assert.equal(mapKeyToAction(key('m'), ON), 'mute');
  assert.equal(mapKeyToAction(key('M'), ON), 'mute');
  assert.equal(mapKeyToAction(key('h'), ON), 'listening');
  assert.equal(mapKeyToAction(key('t'), ON), 'theme');
  assert.equal(mapKeyToAction(key('T'), ON), 'theme');
  assert.equal(mapKeyToAction(key('c'), ON), 'cat');
  assert.equal(mapKeyToAction(key('?'), ON), 'about');
  assert.equal(mapKeyToAction(key('x'), ON), null);
  assert.equal(mapKeyToAction(key('Enter'), ON), null);
  assert.equal(mapKeyToAction(key('Shift'), ON), null);
});

test('ignored while typing, disabled or with a dialog open', () => {
  for (const k of [' ', 'k', '1', 'm', 'h', 't', 'c', '?']) {
    assert.equal(mapKeyToAction(key(k), { ...ON, typing: true }), null, `typing ${k}`);
    assert.equal(mapKeyToAction(key(k), { ...ON, shortcutsEnabled: false }), null, `disabled ${k}`);
    assert.equal(mapKeyToAction(key(k), { ...ON, dialogOpen: true }), null, `dialog ${k}`);
  }
});

test('modifier combinations are left to the browser', () => {
  for (const mod of ['metaKey', 'ctrlKey', 'altKey']) {
    assert.equal(mapKeyToAction(key('k', { [mod]: true }), ON), null, mod);
    assert.equal(mapKeyToAction(key('1', { [mod]: true }), ON), null, mod);
    assert.equal(mapKeyToAction(key('m', { [mod]: true }), ON), null, mod);
  }
});

test('Escape always maps, even when typing, disabled or in a dialog', () => {
  assert.equal(mapKeyToAction(key('Escape'), ON), 'escape');
  assert.equal(mapKeyToAction(key('Escape'), { ...ON, typing: true }), 'escape');
  assert.equal(mapKeyToAction(key('Escape'), { ...ON, shortcutsEnabled: false }), 'escape');
  assert.equal(mapKeyToAction(key('Escape'), { ...ON, dialogOpen: true }), 'escape');
  assert.equal(mapKeyToAction(key('Escape', { metaKey: true }), ON), 'escape');
  assert.equal(mapKeyToAction({ code: 'Escape' }, {}), 'escape');
});

test('tolerates missing fields', () => {
  assert.equal(mapKeyToAction({}, {}), null);
  assert.equal(mapKeyToAction({ key: 'k' }, undefined), 'toggle-play');
  assert.equal(mapKeyToAction(undefined, ON), null);
});
