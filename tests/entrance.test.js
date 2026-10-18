import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ENTRANCES, entrancePlan, entranceEnd } from '../docs/js/core/entrance.js';
import { getPreset, PRESETS } from '../docs/js/core/presets.js';

const ALL_ON = Object.freeze({ tone: 0.35, rain: 0.7, ocean: 0.65, purr: 0.5 });
const plain = (steps) => steps.map((s) => ({ ...s }));

test('ENTRANCES: each mood brings in all four layers once, frozen', () => {
  assert.deepEqual(Object.keys(ENTRANCES), ['sleepy', 'calm', 'alert']);
  for (const [mood, steps] of Object.entries(ENTRANCES)) {
    assert.deepEqual(steps.map((s) => s.layer).sort(), ['ocean', 'purr', 'rain', 'tone'], mood);
    assert.equal(steps[0].atS, 0, `${mood} starts at once`);
    for (const s of steps) assert.ok(s.seconds >= 2, `${mood}.${s.layer} rises over ${s.seconds} s`);
    assert.ok(Object.isFrozen(steps) && Object.isFrozen(steps[0]));
  }
  assert.deepEqual(ENTRANCES.sleepy.map((s) => [s.layer, s.atS, s.seconds]), [['ocean', 0, 3], ['purr', 1.2, 3], ['tone', 2.5, 4], ['rain', 4, 4]]);
  assert.deepEqual(ENTRANCES.alert[0], { layer: 'tone', atS: 0, seconds: 2 }, 'alert leads with the tone');
});

test('entrancePlan returns the mood plan when every layer sounds; an unknown mood plays calm', () => {
  for (const mood of ['sleepy', 'calm', 'alert']) assert.deepEqual(entrancePlan(mood, { mix: ALL_ON, muted: {} }), plain(ENTRANCES[mood]));
  assert.deepEqual(entrancePlan('giddy', { mix: ALL_ON }), plain(ENTRANCES.calm));
  assert.deepEqual(entrancePlan(undefined, { mix: ALL_ON }), plain(ENTRANCES.calm));
});

test('silent and muted layers are dropped and the plan shifts to start at 0 (Cat nap: purr 0, tone 1.3, rain 2.8)', () => {
  const catnap = getPreset('catnap');
  assert.deepEqual(entrancePlan(catnap.mood, { mix: catnap.mix, muted: {} }), [
    { layer: 'purr', atS: 0, seconds: 3 }, { layer: 'tone', atS: 1.3, seconds: 4 }, { layer: 'rain', atS: 2.8, seconds: 4 },
  ]);
  const muted = entrancePlan('sleepy', { mix: ALL_ON, muted: { ocean: true, purr: true } });
  assert.deepEqual(muted, [{ layer: 'tone', atS: 0, seconds: 4 }, { layer: 'rain', atS: 1.5, seconds: 4 }]);
  assert.deepEqual(entrancePlan('alert', { mix: { tone: 0, rain: 0, ocean: 0, purr: 0 }, muted: {} }), []);
  for (const p of PRESETS) {
    const steps = entrancePlan(p.mood, { mix: p.mix, muted: {} });
    assert.equal(steps[0].atS, 0, `${p.id} starts at once`);
    assert.deepEqual(steps.map((s) => s.layer).sort(), Object.keys(p.mix).filter((k) => p.mix[k] > 0).sort(), `${p.id} layers`);
  }
});

test('entranceEnd: the end of the tone step, else of the last step to finish', () => {
  assert.equal(entranceEnd(ENTRANCES.sleepy), 6.5);
  assert.equal(entranceEnd(ENTRANCES.calm), 4.2);
  assert.equal(entranceEnd(ENTRANCES.alert), 2);
  const catnap = getPreset('catnap');
  assert.equal(entranceEnd(entrancePlan('sleepy', { mix: catnap.mix })), 5.3);
  assert.equal(entranceEnd(entrancePlan('sleepy', { mix: ALL_ON, muted: { tone: true } })), 8, 'without the tone: rain ends last');
  assert.equal(entranceEnd([]), 0);
});
