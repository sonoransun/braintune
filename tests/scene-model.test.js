import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../docs/js/core/rng.js';
import {
  DRIFT_PX_PER_S, QUALITY_TIERS, pickQuality, waveAmpScale, makeWaveBands, wavePhase, waveHeight,
  createRainParticles, makeStars, starAlpha,
} from '../docs/js/core/scene-model.js';

const desktop = { width: 1440, dpr: 2, deviceMemory: 8, hardwareConcurrency: 8, coarse: false, saveData: false, motion: 'full', scene: 'full' };
const phone = { ...desktop, width: 390, coarse: true };
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

test('pickQuality matrix: off > low > high/medium precedence', () => {
  assert.equal(pickQuality(desktop).tier, 'high');
  assert.equal(pickQuality(phone).tier, 'medium');
  assert.equal(pickQuality({ ...desktop, width: 1023 }).tier, 'medium');
  assert.equal(pickQuality({ ...desktop, coarse: true }).tier, 'medium');
  assert.equal(pickQuality({ ...desktop, deviceMemory: 2 }).tier, 'low');
  assert.equal(pickQuality({ ...desktop, hardwareConcurrency: 2 }).tier, 'low');
  assert.equal(pickQuality({ ...desktop, saveData: true }).tier, 'low');
  assert.equal(pickQuality({ ...desktop, deviceMemory: undefined, hardwareConcurrency: undefined }).tier, 'high');
  assert.equal(pickQuality({ ...desktop, scene: 'off' }).tier, 'off');
  assert.equal(pickQuality({ ...desktop, motion: 'still' }).tier, 'off');
  assert.equal(pickQuality({ ...desktop, deviceMemory: 1, scene: 'off' }).tier, 'off');
  assert.equal(pickQuality({ ...phone, deviceMemory: 1 }).tier, 'low');
});

test('pickQuality tiers carry the §7.6 numbers plus glitter slots and are returned as copies', () => {
  assert.deepEqual(QUALITY_TIERS, {
    high: { tier: 'high', dprCap: 2, fps: 60, maxDrops: 220, stars: true, ripples: true, blur: true, glints: 14 },
    medium: { tier: 'medium', dprCap: 1.5, fps: 30, maxDrops: 160, stars: true, ripples: true, blur: false, glints: 6 },
    low: { tier: 'low', dprCap: 1, fps: 24, maxDrops: 80, stars: false, ripples: false, blur: false, glints: 0 },
    off: { tier: 'off', dprCap: 1, fps: 10, maxDrops: 0, stars: false, ripples: false, blur: false, glints: 0 },
  });
  assert.deepEqual(pickQuality(desktop), QUALITY_TIERS.high);
  assert.deepEqual(pickQuality(phone), QUALITY_TIERS.medium);
  assert.deepEqual(pickQuality({ ...phone, saveData: true }), QUALITY_TIERS.low);
  assert.deepEqual(pickQuality({ ...desktop, scene: 'off' }), QUALITY_TIERS.off);
  assert.notEqual(pickQuality(desktop), QUALITY_TIERS.high);
  assert.ok(Object.isFrozen(QUALITY_TIERS.high));
});

test('makeWaveBands: four bands at 0.60/0.72/0.84/0.95 h with scaled amplitudes and the §7.6 components plus fine ripples', () => {
  const bands = makeWaveBands(390, 409);
  assert.equal(bands.length, 4);
  assert.deepEqual(bands.map((b) => b.base), [0.6 * 409, 0.72 * 409, 0.84 * 409, 0.95 * 409]);
  assert.deepEqual(bands.map((b) => b.amp), [4, 7, 11, 16]);
  const table = (b) => bands[b].components.map(({ lambda, omega, weight }) => [lambda, omega, weight]);
  assert.deepEqual(table(0), [[220, 0.18, 1], [130, -0.11, 0.5]]);
  assert.deepEqual(table(1), [[300, 0.14, 1], [170, -0.09, 0.45], [90, 0.21, 0.2], [46, 0.24, 0.07]]);
  assert.deepEqual(table(2), [[420, 0.11, 1], [230, -0.08, 0.5], [120, 0.17, 0.25], [62, -0.21, 0.09]]);
  assert.deepEqual(table(3), [[560, 0.09, 1], [310, -0.07, 0.5], [150, 0.13, 0.25], [84, 0.23, 0.1]]);
});

test('wave components: weights fall with spatial frequency and every |ω| ≤ 0.3 rad/s', () => {
  for (const band of makeWaveBands(390, 409)) {
    const bySpatialFrequency = [...band.components].sort((a, b) => b.lambda - a.lambda);
    for (let i = 1; i < bySpatialFrequency.length; i += 1) {
      assert.ok(bySpatialFrequency[i].weight < bySpatialFrequency[i - 1].weight, `λ ${bySpatialFrequency[i].lambda}`);
    }
    for (const c of band.components) assert.ok(Math.abs(c.omega) <= 0.3, `ω ${c.omega}`);
  }
});

test('amplitude scale is min(1.6, h / 409)', () => {
  assert.equal(waveAmpScale(409), 1);
  assert.equal(waveAmpScale(2000), 1.6);
  near(waveAmpScale(200), 200 / 409);
  near(makeWaveBands(1000, 818)[3].amp, 16 * 1.6);
  near(makeWaveBands(1000, 200)[0].amp, 4 * (200 / 409));
});

test('waveHeight is periodic in λ for a single component and bounded by amp·ampScale', () => {
  const band = { base: 0, amp: 10, components: [{ lambda: 220, omega: 0.18, weight: 1 }] };
  for (const t of [0, 1.3, 7.7]) {
    for (const x of [0, 13, 100, 219]) near(waveHeight(band, x, t), waveHeight(band, x + 220, t), 1e-9);
  }
  const bands = makeWaveBands(390, 409);
  for (const b of bands) {
    for (let x = 0; x < 1200; x += 7) {
      const h = waveHeight(b, x, 3.1, 1.3);
      assert.ok(Math.abs(h) <= b.amp * 1.3 + 1e-9);
    }
  }
  near(waveHeight(band, 55, 0, 2), 20 * Math.sin((2 * Math.PI * 55) / 220));
});

test('wave pattern drifts at 8 px/s: with ω = 0, h(x, t) = h(x + 8t, 0)', () => {
  assert.equal(DRIFT_PX_PER_S, 8);
  const band = { base: 0, amp: 6, components: [{ lambda: 300, omega: 0, weight: 1 }, { lambda: 170, omega: 0, weight: 0.45 }] };
  for (const t of [0.5, 2, 9.25]) {
    for (const x of [0, 40, 123]) near(waveHeight(band, x, t), waveHeight(band, x + DRIFT_PX_PER_S * t, 0), 1e-9);
  }
  near(wavePhase(band, 10, 2, 1), (2 * Math.PI * (10 + 16)) / 170);
});

test('rain particles: active count = round(density·maxDrops), fields in range, drops stay above the waterline', () => {
  const w = 390;
  const h = 600;
  const p = createRainParticles({ rng: mulberry32(7), w, h, maxDrops: 160 });
  const waterline = (x) => 0.9 * h + 5 * Math.sin(x / 40);
  const slantPad = h * Math.tan((6 * Math.PI) / 180);
  assert.equal(p.drops.length, 0);
  p.step(1 / 60, 1, waterline);
  assert.equal(p.drops.length, 160);
  p.step(1 / 60, 0.5, waterline);
  assert.equal(p.drops.length, 80);
  p.step(1 / 60, 0.33, waterline);
  assert.equal(p.drops.length, 53);
  p.step(1 / 60, 2, waterline);
  assert.equal(p.drops.length, 160);
  for (let i = 0; i < 600; i++) {
    p.step(1 / 60, 0.8, waterline);
    assert.equal(p.drops.length, 128);
    for (const d of p.drops) {
      assert.ok(d.len >= 10 && d.len <= 24);
      assert.ok(d.speed >= 380 && d.speed <= 620);
      assert.ok(d.alpha >= 0.12 && d.alpha <= 0.3);
      near(Math.atan2(d.vx, d.vy), (6 * Math.PI) / 180, 1e-9);
      near(Math.hypot(d.vx, d.vy), d.speed, 1e-9);
      assert.ok(d.y < waterline(d.x), 'drop recycled once it passes the waterline');
      assert.ok(d.x >= -slantPad - 1 && d.x <= w + 1.5 * slantPad + 5, 'x stays within the slant drift of a 1.5 h fall');
    }
  }
  const recycled = p.drops.filter((d) => d.y < 0).length;
  assert.ok(recycled > 0 && recycled < p.drops.length, 'drops are spread between the top margin and the waterline');
});

test('ripples: spawned on the waterline, ≤ 4 per second, ≤ 12 live, and they expire after 0.6 s', () => {
  const h = 400;
  const p = createRainParticles({ rng: mulberry32(11), w: 800, h, maxDrops: 220 });
  const waterline = () => 0.5 * h;
  const dt = 1 / 60;
  const spawnLog = [];
  let clock = 0;
  for (let i = 0; i < 600; i++) {
    clock += dt;
    p.step(dt, 1, waterline);
    assert.ok(p.ripples.length <= 12);
    for (const r of p.ripples) {
      assert.equal(r.life, 0.6);
      assert.ok(r.age >= 0 && r.age < r.life);
      assert.equal(r.y, 0.5 * h);
    }
    spawnLog.push({ t: clock, n: p.ripples.filter((r) => r.age === 0).length });
  }
  const total = spawnLog.reduce((s, e) => s + e.n, 0);
  assert.ok(total >= 30, `rain at full density should keep spawning ripples, got ${total}`);
  for (const { t } of spawnLog) {
    const inWindow = spawnLog.filter((e) => e.t > t - 1 && e.t <= t).reduce((s, e) => s + e.n, 0);
    assert.ok(inWindow <= 4, `${inWindow} ripples in one second`);
  }
  for (let i = 0; i < 40; i++) p.step(dt, 0, waterline);
  assert.equal(p.ripples.length, 0);
  assert.equal(p.drops.length, 0);
});

test('stars: count, placement in the upper sky, periods 10–18 s, base alpha 0.25–0.85', () => {
  const stars = makeStars(mulberry32(3), 1200, 800, 80);
  assert.equal(stars.length, 80);
  for (const s of stars) {
    assert.ok(s.x >= 0 && s.x < 1200);
    assert.ok(s.y >= 0 && s.y < 0.45 * 800);
    assert.ok(s.r > 0);
    assert.ok(s.period >= 10 && s.period <= 18);
    assert.ok(s.phase >= 0 && s.phase < 2 * Math.PI);
    assert.ok(s.base >= 0.25 && s.base <= 0.85);
  }
  assert.deepEqual(makeStars(mulberry32(3), 1200, 800, 5), makeStars(mulberry32(3), 1200, 800, 5));
});

test('starAlpha stays within [0.25·base, base] and repeats with the star period', () => {
  const star = { x: 0, y: 0, r: 1, period: 12, phase: 0.4, base: 0.8 };
  for (let t = 0; t < 36; t += 0.05) {
    const a = starAlpha(star, t);
    assert.ok(a >= 0.25 * star.base - 1e-12 && a <= star.base + 1e-12);
    near(a, starAlpha(star, t + star.period), 1e-9);
  }
  near(starAlpha(star, 0), 0.8 * (0.55 + 0.45 * Math.sin(0.4)));
  assert.equal(starAlpha({ ...star, phase: -Math.PI / 2 }, 0), 0.25 * star.base);
  assert.equal(starAlpha({ ...star, phase: Math.PI / 2 }, 0), star.base);
});
