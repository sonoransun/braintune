import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MASTER_MAX, VOICE_PEAK, PAD_DB, CEILING_DB, LIMITER,
  dbToGain, gainToDb, layerGain, masterGain, compressorMakeupGain, ceilingGain, carrierTrim,
  fadeBreakpoints, equalPower, bedGainDb, limiterOutputDb, levelBudget,
} from '../docs/js/core/levels.js';
import { PRESETS, resolvePreset } from '../docs/js/core/presets.js';

const near = (actual, expected, tol, what = 'value') =>
  assert.ok(Math.abs(actual - expected) <= tol, `${what} ${actual} is not within ${tol} of ${expected}`);

const SHAPES = ['linear', 'scurve', 'equalPowerIn', 'equalPowerOut'];
import { DEFAULT_SETTINGS } from '../docs/js/core/state.js';

// v2 starts quiet: master 0.45 instead of 0.7, every level about 7.7 dB below the plan §6.6 table.
const DEFAULT_MASTER = DEFAULT_SETTINGS.mix.master;
const LISTENINGS = ['headphones', 'speakers'];
const DEVICES = ['phone', 'desktop'];

/** Budget of a preset as the engine would run it: the timbre only matters on the isochronic carrier. */
function budgetFor(preset, listening, device, overrides = {}) {
  const r = resolvePreset(preset, { listening, device });
  return levelBudget({
    mix: { ...r.mix, master: DEFAULT_MASTER },
    carrierHz: r.carrierHz,
    rainIntensity: r.rainIntensity,
    oceanIntensity: r.oceanIntensity,
    timbre: r.mode === 'isochronic' ? r.timbre : 'sine',
    ...overrides,
  });
}

test('constants match the plan', () => {
  assert.equal(MASTER_MAX, 0.7);
  assert.equal(VOICE_PEAK, 0.7);
  assert.equal(PAD_DB, -14);
  assert.equal(CEILING_DB, -1);
  assert.deepEqual({ ...LIMITER }, { threshold: -3, knee: 0, ratio: 20, attack: 0.002, release: 0.25 });
  assert.ok(Object.isFrozen(LIMITER));
});

test('dB conversions round-trip and treat silence as -Infinity', () => {
  near(dbToGain(-6.0206), 0.5, 1e-4);
  near(gainToDb(2), 6.0206, 1e-4);
  assert.equal(dbToGain(0), 1);
  assert.equal(gainToDb(1), 0);
  near(gainToDb(dbToGain(-23.7)), -23.7, 1e-12);
  assert.equal(gainToDb(0), -Infinity);
  assert.equal(dbToGain(-Infinity), 0);
});

test('tapers: layerGain(.55) = .3025, masterGain(1) = .7, inputs clamped to 0..1', () => {
  near(layerGain(0.55), 0.3025, 1e-12);
  assert.equal(masterGain(1), 0.7);
  assert.equal(layerGain(0), 0);
  assert.equal(layerGain(1), 1);
  assert.equal(layerGain(-1), 0);
  assert.equal(layerGain(2), 1);
  assert.equal(masterGain(0), 0);
  near(masterGain(0.7), 0.343, 1e-12);
});

test('limiter makeup 1.2177 and ceiling 0.732 add up to CEILING_DB', () => {
  near(compressorMakeupGain(LIMITER), 1.2177, 1e-3);
  near(gainToDb(compressorMakeupGain(LIMITER)), 1.71, 1e-2);
  near(ceilingGain(), 0.732, 1e-3);
  near(gainToDb(compressorMakeupGain(LIMITER)) + gainToDb(ceilingGain()), CEILING_DB, 1e-9);
  assert.equal(compressorMakeupGain({ threshold: 0, ratio: 20 }), 1, 'no gain reduction at 0 dBFS means no makeup');
  assert.throws(() => compressorMakeupGain({ threshold: -3, knee: 6, ratio: 20 }), RangeError);
});

test('carrierTrim follows (400 / f)^0.35 and clamps to [0.8, 1.3]', () => {
  assert.equal(carrierTrim(400), 1);
  near(carrierTrim(256), 1.169, 1e-3);
  near(carrierTrim(200), 2 ** 0.35, 1e-12);
  assert.equal(carrierTrim(100), 1.3);
  assert.equal(carrierTrim(50), 1.3);
  assert.equal(carrierTrim(1200), 0.8);
  assert.equal(carrierTrim(5000), 0.8);
  let prev = Infinity;
  for (let f = 100; f <= 1200; f += 10) {
    assert.ok(carrierTrim(f) <= prev, `carrierTrim not monotone at ${f} Hz`);
    prev = carrierTrim(f);
  }
});

test('fadeBreakpoints: n + 1 Float32 values, exact endpoints, monotone, known midpoints', () => {
  for (const shape of SHAPES) {
    const up = fadeBreakpoints(0.3, 0.9, 32, shape);
    assert.ok(up instanceof Float32Array);
    assert.equal(up.length, 33);
    assert.equal(up[0], Math.fround(0.3), `${shape} start`);
    assert.equal(up[32], Math.fround(0.9), `${shape} end`);
    for (let i = 1; i < up.length; i++) assert.ok(up[i] >= up[i - 1], `${shape} not monotone at ${i}`);
    const down = fadeBreakpoints(1, 0, 8, shape);
    assert.equal(down[0], 1);
    assert.equal(down[8], 0);
    for (let i = 1; i < down.length; i++) assert.ok(down[i] <= down[i - 1], `${shape} down not monotone at ${i}`);
  }
  near(fadeBreakpoints(0, 1, 2, 'linear')[1], 0.5, 1e-6);
  near(fadeBreakpoints(0, 1, 2, 'scurve')[1], 0.5, 1e-6);
  near(fadeBreakpoints(0, 1, 4, 'scurve')[1], 0.15625, 1e-6, 'smoothstep(0.25)');
  near(fadeBreakpoints(0, 1, 2, 'equalPowerIn')[1], Math.SQRT1_2, 1e-6);
  near(fadeBreakpoints(1, 0, 2, 'equalPowerOut')[1], Math.SQRT1_2, 1e-6);
  assert.equal(fadeBreakpoints(0, 1).length, 33, 'defaults to n = 32');
  assert.deepEqual(fadeBreakpoints(0, 1), fadeBreakpoints(0, 1, 32, 'scurve'), 'defaults to scurve');
  assert.throws(() => fadeBreakpoints(0, 1, 8, 'bounce'), RangeError);
});

test('equal-power pairs satisfy a² + b² = 1, as curves and as breakpoints', () => {
  for (let i = 0; i <= 20; i++) {
    const { fadeIn, fadeOut } = equalPower(i / 20);
    near(fadeIn ** 2 + fadeOut ** 2, 1, 1e-12);
  }
  assert.deepEqual(equalPower(0), { fadeIn: 0, fadeOut: 1 });
  near(equalPower(1).fadeIn, 1, 1e-15);
  near(equalPower(1).fadeOut, 0, 1e-15);
  assert.deepEqual(equalPower(2), equalPower(1), 'progress is clamped');
  const fadeIn = fadeBreakpoints(0, 1, 16, 'equalPowerIn');
  const fadeOut = fadeBreakpoints(1, 0, 16, 'equalPowerOut');
  for (let i = 0; i <= 16; i++) near(fadeIn[i] ** 2 + fadeOut[i] ** 2, 1, 1e-6, `breakpoint ${i}`);
});

test('bedGainDb: rain -14 + 14s, rumble -36 + 20s², surf -14 + 6i', () => {
  assert.equal(bedGainDb('rain', 0), -14);
  assert.equal(bedGainDb('rain', 1), 0);
  near(bedGainDb('rain', 0.45), -7.7, 1e-12);
  assert.equal(bedGainDb('rumble', 0), -36);
  assert.equal(bedGainDb('rumble', 1), -16);
  assert.equal(bedGainDb('rumble', 0.5), -31);
  assert.equal(bedGainDb('surf', 0), -14);
  assert.equal(bedGainDb('surf', 1), -8);
  near(bedGainDb('surf', 0.35), -11.9, 1e-12);
  assert.throws(() => bedGainDb('thunder', 0.5), RangeError);
});

test('limiterOutputDb: -1 dB below threshold, 20:1 above, monotone', () => {
  near(limiterOutputDb(-10), -11, 1e-9);
  near(limiterOutputDb(-30), -31, 1e-9);
  near(limiterOutputDb(LIMITER.threshold), -4, 1e-9);
  near(limiterOutputDb(0), -3.85, 1e-9);
  near(limiterOutputDb(7), -3.5, 1e-9);
  near(limiterOutputDb(10) - limiterOutputDb(0), 0.5, 1e-9, 'slope above threshold');
  assert.equal(limiterOutputDb(-Infinity), -Infinity);
  let prev = -Infinity;
  for (let inDb = -60; inDb <= 20; inDb += 0.5) {
    assert.ok(limiterOutputDb(inDb) >= prev);
    prev = limiterOutputDb(inDb);
  }
});

test('levelBudget reproduces the §6.6 table for Calm and Cat nap', () => {
  const calm = levelBudget({
    mix: { master: 0.7, tone: 0.55, rain: 0.8, ocean: 0.55, purr: 0 },
    carrierHz: 256, rainIntensity: 0.45, oceanIntensity: 0.35,
  });
  near(calm.toneDbfsPeak, -22.6, 0.5, 'tone peak');
  near(calm.rainDbfsRms, -32.9, 0.1, 'rain RMS');
  near(calm.oceanBedDbfsRms, -43.6, 0.1, 'ocean bed RMS');
  near(calm.oceanCrestDbfsPeak, -25, 1, 'ocean crest');
  assert.equal(calm.purrDbfsRms, -Infinity);
  assert.ok(calm.sumPeakDbfs <= -12);
  const catnap = levelBudget({
    mix: { master: 0.7, tone: 0.5, rain: 0.65, ocean: 0, purr: 0.55 },
    carrierHz: 220, rainIntensity: 0.4, oceanIntensity: 0.35,
  });
  near(catnap.purrDbfsRms, -32.7, 0.1, 'purr RMS');
  assert.equal(catnap.oceanBedDbfsRms, -Infinity);
  assert.equal(catnap.oceanCrestDbfsPeak, -Infinity);
});

test('levelBudget: muted or missing layers add nothing, missing master is full, timbre only moves the sum', () => {
  const base = { carrierHz: 256, rainIntensity: 0.45, oceanIntensity: 0.35 };
  const withRain = levelBudget({ ...base, mix: { master: 0.7, tone: 0.55, rain: 0.8 } });
  const noRain = levelBudget({ ...base, mix: { master: 0.7, tone: 0.55, rain: 0 } });
  const rainless = levelBudget({ ...base, mix: { master: 0.7, tone: 0.55 } });
  assert.ok(withRain.sumPeakDbfs > noRain.sumPeakDbfs);
  assert.deepEqual(noRain, rainless);
  assert.equal(noRain.rainDbfsRms, -Infinity);
  assert.equal(levelBudget({ ...base, mix: { master: 0.7 } }).sumPeakDbfs, -Infinity);
  assert.deepEqual(levelBudget({ ...base, mix: { tone: 0.5 } }), levelBudget({ ...base, mix: { tone: 0.5, master: 1 } }));
  const sine = levelBudget({ ...base, mix: { master: 0.7, tone: 0.55 }, timbre: 'sine' });
  const warm = levelBudget({ ...base, mix: { master: 0.7, tone: 0.55 }, timbre: 'warm' });
  const glass = levelBudget({ ...base, mix: { master: 0.7, tone: 0.55 }, timbre: 'glass' });
  assert.equal(warm.toneDbfsPeak, sine.toneDbfsPeak);
  assert.ok(warm.sumPeakDbfs > sine.sumPeakDbfs, 'warm has a higher crest than a sine');
  assert.ok(glass.sumPeakDbfs < sine.sumPeakDbfs, 'glass has a lower crest than a sine');
});

test('every preset at its quiet v2 defaults sits inside the windows (§6.6 shifted −8 dB) on headphones and speakers, phone and desktop', () => {
  for (const preset of PRESETS) {
    for (const listening of LISTENINGS) {
      for (const device of DEVICES) {
        const b = budgetFor(preset, listening, device);
        const where = `${preset.id} / ${listening} / ${device}`;
        assert.ok(b.toneDbfsPeak >= -36 && b.toneDbfsPeak <= -26, `${where} tone peak ${b.toneDbfsPeak}`);
        if (preset.mix.rain > 0) assert.ok(b.rainDbfsRms >= -48 && b.rainDbfsRms <= -32, `${where} rain ${b.rainDbfsRms}`);
        if (preset.mix.ocean > 0) {
          assert.ok(b.oceanCrestDbfsPeak >= -40 && b.oceanCrestDbfsPeak <= -26, `${where} ocean crest ${b.oceanCrestDbfsPeak}`);
          assert.ok(b.oceanBedDbfsRms >= -58 && b.oceanBedDbfsRms <= -38, `${where} ocean bed ${b.oceanBedDbfsRms}`);
        }
        if (preset.mix.purr > 0) assert.ok(b.purrDbfsRms >= -48 && b.purrDbfsRms <= -32, `${where} purr ${b.purrDbfsRms}`);
        assert.ok(b.sumPeakDbfs <= -19, `${where} summed peak ${b.sumPeakDbfs}`);
      }
    }
  }
});

test('every slider at 1 with all four layers on stays at or below -1 dBFS with the limiter engaged', () => {
  for (const preset of PRESETS) {
    for (const listening of LISTENINGS) {
      for (const device of DEVICES) {
        const b = budgetFor(preset, listening, device, {
          mix: { master: 1, tone: 1, rain: 1, ocean: 1, purr: 1 },
          rainIntensity: 1,
          oceanIntensity: 1,
        });
        const where = `${preset.id} / ${listening} / ${device}`;
        assert.ok(b.sumPeakDbfs <= -1, `${where} summed peak ${b.sumPeakDbfs} would clip`);
        assert.ok(b.sumPeakDbfs > limiterOutputDb(LIMITER.threshold), `${where} limiter not engaged at ${b.sumPeakDbfs}`);
      }
    }
  }
});
