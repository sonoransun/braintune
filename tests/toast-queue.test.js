import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createToastQueue, createAnnounceQueue, shouldDeferToast } from '../docs/js/core/toast-queue.js';

function clock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => {
    t += ms;
  };
  return now;
}

test('push dedupes by id and returns false for the duplicate', () => {
  const now = clock();
  const q = createToastQueue({ now });
  assert.equal(q.push({ id: 'timer', text: 'Timer set to 30 minutes.' }), true);
  assert.equal(q.push({ id: 'timer', text: 'Timer set to 45 minutes.' }), false);
  assert.equal(q.list().length, 1);
  assert.equal(q.list()[0].text, 'Timer set to 30 minutes.');
  assert.equal(q.push({ text: 'Brain Tune works offline now.' }), true, 'id defaults to the text');
  assert.equal(q.push({ text: 'Brain Tune works offline now.' }), false);
  q.dismiss('timer');
  assert.equal(q.push({ id: 'timer', text: 'Timer set to 45 minutes.' }), true, 'dismissed ids may return');
});

test('at most max toasts; the oldest non-sticky is dropped first', () => {
  const now = clock();
  const q = createToastQueue({ now, max: 3 });
  q.push({ id: 'sticky', text: 'A gentle update is ready.', sticky: true });
  q.push({ id: 'a', text: 'a' });
  q.push({ id: 'b', text: 'b' });
  q.push({ id: 'c', text: 'c' });
  assert.deepEqual(q.list().map((t) => t.id), ['sticky', 'b', 'c']);
  q.push({ id: 'd', text: 'd' });
  assert.deepEqual(q.list().map((t) => t.id), ['sticky', 'c', 'd']);
});

test('sticky and action toasts never expire; info toasts do', () => {
  const now = clock(1000);
  const q = createToastQueue({ now, max: 4 });
  q.push({ id: 'info', text: 'Timer set to 30 minutes.' });
  q.push({ id: 'short', text: 'Left…', durationMs: 1000 });
  q.push({ id: 'undo', text: 'Settings reset.', action: { label: 'Undo' } });
  const sticky = { id: 'update', text: 'A gentle update is ready.', sticky: true, action: { label: 'Reload when you like' } };
  assert.equal(q.push(sticky), true);
  assert.equal(q.list().length, 4);
  assert.deepEqual(q.tick().expired, []);
  now.advance(1000);
  let r = q.tick();
  assert.deepEqual(r.expired, ['short']);
  assert.deepEqual(r.visible.map((t) => t.id), ['info', 'undo', 'update']);
  now.advance(3000);
  r = q.tick();
  assert.deepEqual(r.expired, ['info']);
  now.advance(10 * 60 * 1000);
  r = q.tick();
  assert.deepEqual(r.expired, []);
  assert.deepEqual(r.visible.map((t) => t.id), ['undo', 'update']);
  assert.equal(r.visible[0].expiresAt, null);
  assert.equal(q.dismiss('undo'), true);
  assert.equal(q.dismiss('undo'), false);
  assert.deepEqual(q.list().map((t) => t.id), ['update']);
});

test('pinned toasts are never dropped for overflow, so they may exceed max', () => {
  const now = clock();
  const q = createToastQueue({ now, max: 3 });
  q.push({ id: 'info', text: 'Timer set to 30 minutes.' });
  q.push({ id: 'u1', text: 'Settings reset.', action: { label: 'Undo' } });
  q.push({ id: 's1', text: 'A gentle update is ready.', sticky: true });
  q.push({ id: 'u2', text: 'Another choice.', action: { label: 'Keep' } });
  assert.deepEqual(q.list().map((t) => t.id), ['u1', 's1', 'u2'], 'the info toast made room');
  q.push({ id: 's2', text: 'Still here.', sticky: true });
  assert.deepEqual(q.list().map((t) => t.id), ['u1', 's1', 'u2', 's2'], 'nothing droppable, so all four stay');
});

test('list and tick hand out copies', () => {
  const now = clock();
  const q = createToastQueue({ now });
  q.push({ id: 'x', text: 'x' });
  q.list()[0].text = 'changed';
  assert.equal(q.list()[0].text, 'x');
  assert.equal(q.list()[0].expiresAt, 4000);
});

test('announce queue drops identical text within dedupeMs', () => {
  const now = clock();
  const a = createAnnounceQueue({ now, dedupeMs: 1000 });
  assert.equal(a.push('Paused.'), true);
  assert.equal(a.push('Paused.'), false);
  now.advance(999);
  assert.equal(a.push('Paused.'), false);
  assert.equal(a.push('Session complete.'), true, 'different text passes');
  now.advance(1);
  assert.equal(a.push('Paused.'), true, 'stale duplicate passes once dedupeMs has elapsed');
  assert.equal(a.push(''), false);
  assert.equal(a.push(null), false);
});

test('shouldDeferToast: only a sticky toast waits, during a sleepy session or while the screen is dimmed', () => {
  for (const sticky of [true, false]) {
    for (const mood of ['sleepy', 'calm', 'alert', null]) {
      for (const dimmed of [true, false]) {
        const expected = sticky && (mood === 'sleepy' || dimmed);
        assert.equal(shouldDeferToast({ sticky, mood, dimmed }), expected, `sticky ${sticky}, mood ${mood}, dimmed ${dimmed}`);
      }
    }
  }
  assert.equal(shouldDeferToast(), false, 'nothing given defers nothing');
  assert.equal(shouldDeferToast({ sticky: 'yes', mood: 'sleepy' }), false, 'only a real sticky flag counts');
});

test('queues require an injected clock', () => {
  assert.throws(() => createToastQueue({}), TypeError);
  assert.throws(() => createAnnounceQueue(), TypeError);
});
