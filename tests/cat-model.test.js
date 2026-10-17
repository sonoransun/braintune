import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../docs/js/core/rng.js';
import { CAT_CONFIG, createCatScheduler, placeCat, rectsIntersect } from '../docs/js/core/cat-model.js';

const viewport = { w: 1024, h: 768 };
const baseCtx = { playing: true, band: 'alpha', purr: 0, still: false, presetId: 'calm', viewport, layout: 'desktop', activeCount: 0 };

function sample(fn, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn());
  return out;
}

test('CAT_CONFIG matches §5 and is frozen', () => {
  assert.deepEqual(CAT_CONFIG.maxConcurrent, { narrow: 2, default: 3 });
  assert.equal(CAT_CONFIG.minTogether, 2);
  assert.deepEqual(CAT_CONFIG.companionDelayMs, [1200, 3500]);
  assert.deepEqual(CAT_CONFIG.firstDelayMs, { playing: [4e3, 9e3], idle: [10e3, 20e3] });
  assert.deepEqual(CAT_CONFIG.gapMs, { playing: [20e3, 60e3], idle: [40e3, 100e3] });
  assert.deepEqual(CAT_CONFIG.dwellMs, { sit: [25e3, 60e3], loaf: [30e3, 70e3], sleep: [60e3, 180e3] });
  assert.deepEqual(CAT_CONFIG.walkSpeedPxPerS, [28, 40]);
  assert.deepEqual(Object.keys(CAT_CONFIG.poseWeights), ['sleepy', 'calm', 'alert', 'idle', 'still']);
  assert.deepEqual(CAT_CONFIG.poseWeights.still, { sit: 0.5, loaf: 0.5 });
  assert.deepEqual(CAT_CONFIG.coatWeights, { black: 1, orangeTabby: 1, grey: 1, calico: 1 });
  assert.equal(CAT_CONFIG.afterPetExtraMs, 10e3);
  assert.equal(CAT_CONFIG.callCooldownMs, 20e3);
  assert.deepEqual(CAT_CONFIG.blinkEveryMs, [4e3, 9e3]);
  assert.deepEqual(CAT_CONFIG.blinkEveryStillMs, [8e3, 14e3]);
  assert.equal(CAT_CONFIG.catnapGapScale, 0.6);
  assert.ok(Object.isFrozen(CAT_CONFIG) && Object.isFrozen(CAT_CONFIG.poseWeights.calm));
});

test('arrival delays fall in the configured ranges for first visit, playing, idle and catnap', () => {
  const s = createCatScheduler({ rng: mulberry32(1) });
  const check = (ctx, [lo, hi]) => {
    const xs = sample(() => s.nextArrivalDelay(ctx), 2000);
    assert.ok(xs.every((x) => x >= lo && x < hi), `${JSON.stringify(ctx)} outside [${lo}, ${hi})`);
    assert.ok(Math.min(...xs) < lo + (hi - lo) * 0.05 && Math.max(...xs) > hi - (hi - lo) * 0.05, 'spans the range');
  };
  check({ playing: true, firstEver: true, presetId: 'calm' }, [4e3, 9e3]);
  check({ playing: false, firstEver: true, presetId: 'calm' }, [10e3, 20e3]);
  check({ playing: true, firstEver: false, presetId: 'calm' }, [20e3, 60e3]);
  check({ playing: false, firstEver: false, presetId: 'calm' }, [40e3, 100e3]);
  check({ playing: true, firstEver: false, presetId: 'catnap' }, [12e3, 36e3]);
  check({ playing: true, firstEver: true, presetId: 'catnap' }, [2.4e3, 5.4e3]);
});

test('mood: still wins, then idle, then preset rules (purr no longer forces sleepy), fallback calm', () => {
  const s = createCatScheduler({ rng: mulberry32(2) });
  assert.equal(s.mood({ playing: true, still: true, presetId: 'focus', purr: 0 }), 'still');
  assert.equal(s.mood({ playing: false, still: false, presetId: 'sleep', purr: 0.5 }), 'idle');
  for (const presetId of ['sleep', 'rest', 'catnap']) assert.equal(s.mood({ playing: true, still: false, presetId, purr: 0 }), 'sleepy');
  assert.equal(s.mood({ playing: true, still: false, presetId: 'focus', purr: 0.4 }), 'alert');
  for (const presetId of ['meditate', 'calm']) assert.equal(s.mood({ playing: true, still: false, presetId, purr: 0 }), 'calm');
  for (const presetId of ['focus', 'energise', 'clarity']) assert.equal(s.mood({ playing: true, still: false, presetId, purr: 0 }), 'alert');
  assert.equal(s.mood({ playing: true, still: false, presetId: 'mystery', purr: 0 }), 'calm');
});

test('plan is null at maxConcurrent for the width class (narrow < 400 → 2, else 3)', () => {
  const s = createCatScheduler({ rng: mulberry32(3) });
  assert.equal(s.plan({ ...baseCtx, viewport: { w: 390, h: 844 }, activeCount: 2 }), null);
  assert.ok(s.plan({ ...baseCtx, viewport: { w: 390, h: 844 }, activeCount: 1 }));
  assert.ok(s.plan({ ...baseCtx, viewport: { w: 400, h: 844 }, activeCount: 2 }));
  assert.equal(s.plan({ ...baseCtx, viewport: { w: 400, h: 844 }, activeCount: 3 }), null);
  assert.equal(s.plan({ ...baseCtx, activeCount: 3 }), null);
  assert.equal(s.plan({ ...baseCtx, activeCount: 5 }), null);
});

test('plan shape: ids count up, enter 600 / exit 500, dwell and speed per pose, blink interval per mood', () => {
  const s = createCatScheduler({ rng: mulberry32(4) });
  const plans = sample(() => s.plan(baseCtx), 400);
  plans.forEach((p, i) => {
    assert.equal(p.id, i + 1);
    assert.equal(p.enterMs, 600);
    assert.equal(p.exitMs, 500);
    assert.equal(typeof p.flip, 'boolean');
    assert.ok(['black', 'orangeTabby', 'grey', 'calico'].includes(p.coat));
    assert.ok(p.blinkEveryMs >= 4e3 && p.blinkEveryMs <= 9e3);
    if (p.pose === 'walk') {
      const [lo, hi] = p.zoom ? CAT_CONFIG.zoomies.speedPxPerS : CAT_CONFIG.walkSpeedPxPerS;
      assert.ok(p.speedPxPerS >= lo && p.speedPxPerS < hi, `walk speed ${p.speedPxPerS} (zoom ${p.zoom})`);
      assert.equal(p.dwellMs, Math.round((1000 * (viewport.w + 112)) / p.speedPxPerS));
    } else {
      assert.equal(p.speedPxPerS, null);
      const [lo, hi] = CAT_CONFIG.dwellMs[p.pose];
      assert.ok(p.dwellMs >= lo && p.dwellMs <= hi, `${p.pose} dwell ${p.dwellMs}`);
    }
  });
  const flips = plans.filter((p) => p.flip).length;
  assert.ok(flips > 140 && flips < 260, `flip should be a coin toss, got ${flips}/400`);
  const walker = plans.find((p) => p.pose === 'walk');
  const crossingS = walker.dwellMs / 1000;
  const [slow, fast] = walker.zoom ? [80, 120] : [28, 40];
  assert.ok(crossingS > (viewport.w + 112) / fast - 0.01 && crossingS < (viewport.w + 112) / slow + 0.01);
  const stillPlan = createCatScheduler({ rng: mulberry32(5) }).plan({ ...baseCtx, still: true });
  assert.ok(stillPlan.blinkEveryMs >= 8e3 && stillPlan.blinkEveryMs <= 14e3);
});

test('pose frequencies match the mood weights ± 2 % and coats are uniform', () => {
  const N = 20000;
  const contexts = {
    sleepy: { ...baseCtx, presetId: 'sleep' },
    calm: { ...baseCtx, presetId: 'calm' },
    alert: { ...baseCtx, presetId: 'focus' },
    idle: { ...baseCtx, playing: false },
    still: { ...baseCtx, still: true },
  };
  for (const [mood, ctx] of Object.entries(contexts)) {
    const s = createCatScheduler({ rng: mulberry32(100 + mood.length) });
    const counts = {};
    const coats = {};
    for (let i = 0; i < N; i++) {
      const p = s.plan(ctx);
      counts[p.pose] = (counts[p.pose] ?? 0) + 1;
      coats[p.coat] = (coats[p.coat] ?? 0) + 1;
    }
    const weights = CAT_CONFIG.poseWeights[mood];
    for (const pose of Object.keys(counts)) assert.ok(pose in weights, `${mood} drew ${pose}`);
    for (const [pose, w] of Object.entries(weights)) {
      const freq = (counts[pose] ?? 0) / N;
      assert.ok(Math.abs(freq - w) <= 0.02, `${mood}/${pose}: ${freq} vs ${w}`);
    }
    for (const c of ['black', 'orangeTabby', 'grey', 'calico']) assert.ok(Math.abs(coats[c] / N - 0.25) <= 0.02, `${mood} coat ${c}`);
  }
});

test('still mood never walks or sleeps; sleepy cats mostly rest but sometimes frolic', () => {
  const s = createCatScheduler({ rng: mulberry32(6) });
  let sleepyWalks = 0;
  for (let i = 0; i < 5000; i++) {
    const still = s.plan({ ...baseCtx, still: true });
    assert.ok(still.pose === 'sit' || still.pose === 'loaf', still.pose);
    assert.equal(still.speedPxPerS, null);
    if (s.plan({ ...baseCtx, presetId: 'rest' }).pose === 'walk') sleepyWalks += 1;
  }
  assert.ok(sleepyWalks > 1700 && sleepyWalks < 2300, `sleepy walk share ${sleepyWalks / 5000}`);
});

test('rectsIntersect: overlap, touching edges and margin', () => {
  const a = { x: 0, y: 0, w: 10, h: 10 };
  assert.equal(rectsIntersect(a, { x: 5, y: 5, w: 10, h: 10 }), true);
  assert.equal(rectsIntersect(a, { x: 10, y: 0, w: 10, h: 10 }), false);
  assert.equal(rectsIntersect(a, { x: 0, y: 10, w: 10, h: 10 }), false);
  assert.equal(rectsIntersect(a, { x: 15, y: 0, w: 10, h: 10 }, 8), true);
  assert.equal(rectsIntersect(a, { x: 18, y: 0, w: 10, h: 10 }, 8), false);
  assert.equal(rectsIntersect(a, { x: 20, y: 20, w: 1, h: 1 }), false);
});

test('placeCat: within the ledge, never intersecting avoid rects (with margin), deterministic', () => {
  const ledge = { y: 700, x0: 20, x1: 980 };
  const size = { w: 112, h: 96 };
  const avoid = [
    { x: 300, y: 620, w: 200, h: 90 },
    { x: 700, y: 640, w: 60, h: 60 },
    { x: 100, y: 500, w: 80, h: 80 },
  ];
  const plan = { pose: 'sit', flip: false };
  const results = [];
  for (let seed = 0; seed < 500; seed++) {
    const pos = placeCat({ plan, viewport, ledge, avoid, size, rng: mulberry32(seed) });
    if (pos === null) continue;
    results.push(pos);
    assert.equal(pos.y, ledge.y - size.h);
    assert.ok(pos.x >= ledge.x0 && pos.x <= ledge.x1 - size.w);
    const rect = { x: pos.x, y: pos.y, w: size.w, h: size.h };
    for (const r of avoid) assert.equal(rectsIntersect(rect, r, 8), false);
  }
  assert.ok(results.length > 450, 'placement rarely fails with this much free ledge');
  assert.deepEqual(placeCat({ plan, viewport, ledge, avoid, size, rng: mulberry32(42) }), placeCat({ plan, viewport, ledge, avoid, size, rng: mulberry32(42) }));
  assert.deepEqual(placeCat({ plan, viewport, ledge, avoid: [], size, rng: mulberry32(1), tries: 1 }), placeCat({ plan, viewport, ledge, avoid: [], size, rng: mulberry32(1), tries: 8 }));
});

test('placeCat returns null when the ledge is blocked or too short, and honours tries', () => {
  const ledge = { y: 700, x0: 20, x1: 980 };
  const size = { w: 112, h: 96 };
  const wall = [{ x: 0, y: 0, w: 1024, h: 768 }];
  assert.equal(placeCat({ plan: { pose: 'loaf', flip: false }, viewport, ledge, avoid: wall, size, rng: mulberry32(1) }), null);
  assert.equal(placeCat({ plan: { pose: 'sit', flip: false }, viewport, ledge: { y: 700, x0: 20, x1: 100 }, avoid: [], size, rng: mulberry32(1) }), null);
  let calls = 0;
  const countingRng = () => { calls++; return 0.5; };
  assert.equal(placeCat({ plan: { pose: 'sit', flip: false }, viewport, ledge, avoid: wall, size, rng: countingRng, tries: 3 }), null);
  assert.equal(calls, 3);
});

test('placeCat: walkers start off-screen on the side they face and skip avoid checks', () => {
  const ledge = { y: 700, x0: 20, x1: 980 };
  const size = { w: 112, h: 96 };
  const wall = [{ x: -1000, y: -1000, w: 5000, h: 5000 }];
  assert.deepEqual(placeCat({ plan: { pose: 'walk', flip: false }, viewport, ledge, avoid: wall, size, rng: mulberry32(1) }), { x: -112, y: 604 });
  assert.deepEqual(placeCat({ plan: { pose: 'walk', flip: true }, viewport, ledge, avoid: wall, size, rng: mulberry32(1) }), { x: 1024, y: 604 });
});

test('companions: a lone cat brings a friend; walkers get a same-direction, slightly faster chaser in another coat', () => {
  const s = createCatScheduler({ rng: mulberry32(9) });
  assert.equal(s.companionDelay(0) >= 1200 && s.companionDelay(1) <= 3500, true);
  assert.equal(s.companionDelay(2), null, 'two cats about: no companion needed');
  let chasers = 0;
  for (let i = 0; i < 300; i++) {
    const leader = s.plan(baseCtx);
    const friend = s.companion(leader, { ...baseCtx, activeCount: 1 });
    assert.ok(friend, 'room for a companion');
    assert.notEqual(friend.coat, leader.coat);
    if (leader.pose === 'walk') {
      chasers += 1;
      assert.equal(friend.pose, 'walk');
      assert.equal(friend.flip, leader.flip);
      assert.ok(friend.speedPxPerS > leader.speedPxPerS && friend.speedPxPerS < leader.speedPxPerS * 1.13);
      assert.ok(friend.frolic && leader.frolic);
    }
  }
  assert.ok(chasers > 30, `walkers were paired (${chasers})`);
  assert.equal(s.companion(s.plan(baseCtx), { ...baseCtx, activeCount: 3 }), null, 'never above the cap');
  const stillLeader = { ...s.plan({ ...baseCtx, still: true }), pose: 'walk', speedPxPerS: 30 };
  assert.notEqual(s.companion(stillLeader, { ...baseCtx, still: true, activeCount: 1 }).pose, 'walk', 'Still mode never sends a chaser');
});

test('zoomies: some walkers dash at 80–120 px/s, never sleepy ones', () => {
  const s = createCatScheduler({ rng: mulberry32(21) });
  let walks = 0;
  let zooms = 0;
  for (let i = 0; i < 4000; i++) {
    const p = s.plan({ ...baseCtx, presetId: 'focus' });
    if (p.pose !== 'walk') continue;
    walks += 1;
    if (p.zoom) zooms += 1;
  }
  const share = zooms / walks;
  assert.ok(share > 0.13 && share < 0.23, `zoomies share ${share}`);
  for (let i = 0; i < 2000; i++) assert.ok(!s.plan({ ...baseCtx, presetId: 'deep' }).zoom, 'deep sleep cats never dash');
});
