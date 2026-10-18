// Canvas ocean and rain scene (plan §7.6, v0.4 §4). Full canvas: sky, sun or moon, horizon glows, stars, a tinted
// vignette. In the stage rect: wave bands with aerial perspective and foam, a mist on the horizon seam, rain, the light's
// pillar and horizon touch, the 1/f glitter path (core/shimmer.js), ripples and haze. Inputs: a palette, two 0–1
// sliders, wave crashes, slow texture values (pad, gust, set) and quality/motion settings; nothing from the beat.
// Visual-rate contract (§7.9): the only periodic luminance change is the 10–18 s star twinkle; texture values arrive
// ≤ 1/s and glide (aperiodic, swings < 0.01); glints are aperiodic one-shots (≥ 1.6 s, ≤ 3/s); the rest is
// translational motion (waves, rain) or one-shots (ripple, crossfade, wave roll).
import { bandPalette, hexToRgb, mixOklab, relativeLuminance, smoothstep, vignetteTint } from '../core/palette.js';
import { mulberry32 } from '../core/rng.js';
import {
  QUALITY_TIERS, createRainParticles, makeStars, makeWaveBands, starAlpha, waveHeight, wavePhase,
} from '../core/scene-model.js';
import { SHIMMER, createSparkleField, glintColor, sparklesAt, spreadScale } from '../core/shimmer.js';

const COLOR_KEYS = ['skyTop', 'skyMid', 'glow', 'seaFar', 'seaNear', 'foam'];
const SCALAR_KEYS = ['light', 'stars'];
const TEXTURE_KEYS = ['pad', 'gust', 'set'];
const STAR_BANDS = new Set(['delta', 'theta', 'alpha']);
const NO_GLINTS = Object.freeze([]);
const FADE_MS = 2500;
const STILL_T_S = 1234; // the one frame drawn in Still mode / tier off
const STILL_FPS = 10; // colour-only interpolation rate while static
const STILL_RAIN_SCALE = 0.5;
const MAX_DT_S = 0.1;
const FRAME_TOLERANCE_MS = 2;
const RESIZE_DEBOUNCE_MS = 150;
const HEIGHT_TOLERANCE_PX = 80;
const SLIDER_TAU_S = 0.5; // rain/ocean sliders ease into the picture
const TEXTURE_MIN_S = 0.05; // a texture value lands at its time, never faster than over 50 ms
const TRACE_FPS = 10;
const TRACE_SIZE = 32;
const TRACE_EPS = 1e-3;
const WAVE_STEP_PX = 6;
const FOAM_SEGMENT_PX = 24;
const FOAM_WIDTH_PX = 1.25;
const FOAM_ALPHA = [[0.18, 0.22], [0.1, 0.16]]; // dark, light: base + span·max(0, sin φ)
const FOAM_LEVELS = 3; // max(0, sin φ) in thirds: four alpha buckets, one stroke each per band
const FOAM_BAND = [0.6, 0.75, 0.9, 1]; // farther foam is fainter
const SEA_DEPTH_PX = 120; // crest colour → sea-near this far below the crest
const CREST_MIX = 0.12; // mix(sea-far, foam, .12)
const AERIAL = [[0.35, 0.25], [0.18, 0.12], [0.07, 0.04], [0, 0]]; // per band: crest, deep colour toward the horizon sky
const HORIZON_MIX = [0.4, 0.45]; // horizon sky: mix(sky-mid, glow, .4); light sky stop: mix(sky-mid, white, .45)
const OCEAN_AMP = [0.6, 0.7]; // amplitude × (0.6 + 0.7·ocean)
const ROLL_MIN_S = 3;
const ROLL_AMP = 0.25;
const ROLL_FOAM = 0.2;
const ROLL_STRENGTH = [0.6, 0.4]; // a roll lifts × (0.6 + 0.4·strength)
const SET_AMP = 0.12; // band 3 amplitude × (1 + .12·set)
const SET_FOAM = 0.04;
const GLOW_ALPHA = [0.35, 0.5]; // dark, light
const PAD_GLOW = 0.03; // glow alpha × (1 + .03·pad)
const WASH = { at: [0.5, 0.5], radii: [0.7, 0.22], alpha: 0.6 };
const SOURCE = { radii: [0.26, 0.1], alpha: 0.7 };
const MIST_MIX = 0.3;
const MIST_ALPHA = [0.14, 0.2];
const MIST_HALF = 0.08; // of h, either side of the horizon
const PILLAR = { halfWidth: 0.09, drop: 0.12, reach: 0.6, alpha: [0.09, 0.14] }; // of w; of h − horizon
const TOUCH = { radii: [0.14, 0.035], alpha: [0.16, 0.22] };
const VIGNETTE_INNER = 0.62;
const VIGNETTE_RADIUS = 0.78;
const HAZE_ALPHA = 0.06;
const HAZE_GUST = 0.25; // haze alpha × (1 + .25·gust)
const HAZE_FROM = 0.3; // haze fades in above this density over HAZE_RAMP
const HAZE_RAMP = 0.1;
const RAIN_ALPHA_MIN = 0.12;
const RAIN_ALPHA_STEP = 0.045; // 0.12–0.30 drawn in four alpha buckets, one stroke each
const RAIN_BUCKETS = 4;
const RIPPLE_R_PX = 8;
const RIPPLE_SQUASH = 0.35;
const STAR_COUNT = [40, 80];
const STAR_AREA_PX2 = 7000; // one star per this many stage px² between the bounds
const MOON_R = 0.05; // of min(stage w, h)
const MOON_AT = [0.78, 0.14];
const MOON_Y_PORTRAIT = 0.2; // portrait stages: below the header chip (plan §7.3 wireframe)
const MOON_HALO = 3;
const MOON_CORONA = [6, 0.35]; // radius × r, alpha
const MOON_ALPHA = 0.9;
const MOON_LIMB = 0.45; // the limb shades toward sky-mid
const SUN = { core: 0.9, color: '#FFFBF2', alpha: 0.92, coronaMix: 0.55 };
const SUN_CORONAS = [[5.5, 0.3], [2.4, 0.55]]; // outer (glow), inner (glow toward white): radius × r, alpha
const GLINT_BINS = 3;

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function rgba(hex, a) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Palette + flags → the crossfadable visual state (six colours plus two 0/1 scalars). */
function visualState(palette, { light, stars }) {
  const state = { light: light ? 1 : 0, stars: stars ? 1 : 0 };
  for (const key of COLOR_KEYS) state[key] = palette[key];
  return state;
}

function interpolateState(a, b, p) {
  const out = {};
  for (const key of COLOR_KEYS) out[key] = mixOklab(a[key], b[key], p);
  for (const key of SCALAR_KEYS) out[key] = lerp(a[key], b[key], p);
  return out;
}

/** Raised-cosine envelope (0–1, scaled by each roll's strength) of the strongest live wave roll at scene time tS. */
function rollEnvelope(rolls, tS) {
  let env = 0;
  for (const roll of rolls) {
    const p = (tS - roll.at) / roll.dur;
    if (p > 0 && p < 1) env = Math.max(env, roll.k * (0.5 - 0.5 * Math.cos(2 * Math.PI * p)));
  }
  return env;
}

/** Max |ΔL| between consecutive samples and sign reversals per second (deltas under TRACE_EPS ignored). */
function summariseTrace(samples) {
  let maxDelta = 0;
  let reversals = 0;
  let lastSign = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const d = samples[i] - samples[i - 1];
    maxDelta = Math.max(maxDelta, Math.abs(d));
    if (Math.abs(d) < TRACE_EPS) continue;
    const sign = Math.sign(d);
    if (lastSign && sign !== lastSign) reversals += 1;
    lastSign = sign;
  }
  const spanS = Math.max(1 / TRACE_FPS, (samples.length - 1) / TRACE_FPS);
  return { maxDelta, reversalsPerSecond: reversals / spanS, samples };
}

function meanLuminance(source, scratchCtx) {
  if (!source.width || !source.height) return 0;
  scratchCtx.drawImage(source, 0, 0, TRACE_SIZE, TRACE_SIZE);
  const { data } = scratchCtx.getImageData(0, 0, TRACE_SIZE, TRACE_SIZE);
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += relativeLuminance({ r: data[i], g: data[i + 1], b: data[i + 2] });
  return sum / (data.length / 4);
}

function starCount(w, h) {
  return Math.round(Math.min(STAR_COUNT[1], Math.max(STAR_COUNT[0], (w * h) / STAR_AREA_PX2)));
}

function rainBucket(alpha) {
  return Math.min(RAIN_BUCKETS - 1, Math.max(0, Math.floor((alpha - RAIN_ALPHA_MIN) / RAIN_ALPHA_STEP)));
}

/** Where the moon or sun sits on a stage → { x, y, r }; x is also the axis of the pillar and the glitter path. */
function lightOf(s) {
  return { x: MOON_AT[0] * s.w, y: (s.h > s.w ? MOON_Y_PORTRAIT : MOON_AT[1]) * s.h, r: MOON_R * Math.min(s.w, s.h) };
}

function get2d(canvas, options) {
  try {
    return canvas?.getContext?.('2d', options) ?? null;
  } catch {
    return null;
  }
}

/** The same API with no drawing, for a missing canvas or a browser without 2D canvas (the CSS sky shows instead). */
function inertScene() {
  const noop = () => {};
  return {
    start: noop, stop: noop, setPalette: noop, setRain: noop, setOcean: noop, setTexture: noop, setStageRect: noop,
    rollWave: noop, setQuality: noop, setStill: noop, resize: noop, renderFrame: noop, frameRate: () => 0, destroy: noop,
    luminanceTrace: () => Promise.resolve({ maxDelta: 0, reversalsPerSecond: 0, samples: [] }),
  };
}

/**
 * Scene on a canvas → { start, stop, setPalette, setRain, setOcean, setTexture, setStageRect, rollWave, setQuality,
 * setStill, resize, renderFrame, luminanceTrace, frameRate, destroy }. quality from pickQuality(); rng and now are injectable.
 */
export function createScene(canvas, { quality, rng = mulberry32(0x5ce0e), now = () => performance.now() } = {}) {
  const ctx = get2d(canvas);
  if (!ctx) return inertScene();

  let tier = { ...QUALITY_TIERS.medium, ...quality };
  let still = false;
  let running = false;
  let destroyed = false;
  let hasDrawn = false;
  let needsFrame = false;
  let rafId = 0;
  let resizeTimer = 0;
  let sceneT = 0; // seconds of motion accumulated while animating; frozen while hidden or stopped
  let lastTick = 0;
  let lastDraw = -Infinity;
  let band = 'alpha';
  let stage = null; // { x, y, w, h } in CSS px; null → the whole canvas
  let geom = null; // wave bands, stars, particle pools and the glitter layout for the current stage size and tier
  let grads = null; // gradients and derived colours for the current look and canvas geometry
  let backdrop = null; // offscreen sky + light source, blitted while its inputs hold still: { canvas, ctx, key }
  let backdropNext = ''; // the key seen on the previous frame; the backdrop is cached once a key repeats
  let field = null; // live glitter field for the current tier and band
  let fieldKey = '';
  let rolls = [];
  let scratchCtx = null;
  const glintSeed = Math.floor(rng() * 2 ** 32) >>> 0;
  const glintRng = mulberry32(glintSeed);
  const view = { w: 0, h: 0, dpr: 1 };
  const frameTimes = [];
  const sliders = { rain: { cur: 0, target: 0 }, ocean: { cur: 0.5, target: 0.5 } };
  const texture = Object.fromEntries(TEXTURE_KEYS.map((key) => [key, { cur: 0, target: 0, at: 0 }]));
  const traces = new Set();
  const initial = visualState(bandPalette(band, 'dark'), { light: false, stars: tier.stars });
  const fade = { from: initial, to: initial, start: 0, dur: 0 };

  const isStatic = () => still || tier.tier === 'off';
  const isFading = (t) => t < fade.start + fade.dur;
  const starsOn = (light) => !light && Boolean(tier.stars) && STAR_BANDS.has(band);
  const stageRect = () => stage ?? { x: 0, y: 0, w: view.w, h: view.h };
  const currentLook = (t) => (isFading(t) ? interpolateState(fade.from, fade.to, smoothstep((t - fade.start) / fade.dur)) : fade.to);

  function ensureGeometry(s) {
    const key = `${s.w}x${s.h}|${tier.maxDrops}`;
    if (geom?.key === key) return geom;
    const bands = makeWaveBands(s.w, s.h);
    const samples = Math.ceil(s.w / WAVE_STEP_PX) + 3;
    const segments = Math.ceil((samples - 1) / (FOAM_SEGMENT_PX / WAVE_STEP_PX));
    const stillRain = createRainParticles({ rng, w: s.w, h: s.h, maxDrops: QUALITY_TIERS.low.maxDrops });
    stillRain.step(0, 1, (x) => bands[3].base + waveHeight(bands[3], x, STILL_T_S, OCEAN_AMP[0]));
    const light = lightOf(s);
    geom = {
      key,
      bands,
      // stars are drawn over the cached sky and light, so none may sit on the moon's disc
      stars: makeStars(rng, s.w, s.h, starCount(s.w, s.h)).filter((star) => Math.hypot(star.x - light.x, star.y - light.y) > light.r + 2),
      particles: createRainParticles({ rng, w: s.w, h: s.h, maxDrops: tier.maxDrops }),
      stillRain,
      points: bands.map(() => ({ xs: new Float32Array(samples), ys: new Float32Array(samples), buckets: new Uint8Array(segments) })),
      layout: { w: s.w, h: s.h, horizonY: bands[0].base, lightX: light.x },
    };
    field?.reset(geom.layout);
    return geom;
  }

  /** The live glitter field for this tier and band, re-created on a change; null on tiers without glints. */
  function ensureField(g) {
    if (!(tier.glints > 0)) return null;
    const key = `${tier.tier}|${band}`;
    if (fieldKey !== key) {
      fieldKey = key;
      field = createSparkleField({ rng: glintRng, tier: tier.tier, band });
      field.reset(g.layout);
    }
    return field;
  }

  /** Band amplitude scale for this frame: the ocean slider; band 3 adds the roll lift and the set (texture). */
  function ampOf(index, roll) {
    const amp = OCEAN_AMP[0] + OCEAN_AMP[1] * sliders.ocean.cur;
    return index === 3 ? amp * (1 + ROLL_AMP * roll) * (1 + SET_AMP * texture.set.cur) : amp;
  }

  function samplePoints(g, index, tS, amp) {
    const spec = g.bands[index];
    const { xs, ys } = g.points[index];
    for (let i = 0; i < xs.length; i += 1) {
      const x = (i - 1) * WAVE_STEP_PX;
      xs[i] = x;
      ys[i] = spec.base + waveHeight(spec, x, tS, amp);
    }
    return g.points[index];
  }

  function radial(stops, x = 0, y = 0, r = 1) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    for (const [offset, color] of stops) grad.addColorStop(offset, color);
    return grad;
  }

  function linear(y1, stops) {
    const grad = ctx.createLinearGradient(0, 0, 0, y1);
    for (const [offset, color] of stops) grad.addColorStop(offset, color);
    return grad;
  }

  function skyGradient(look, s, horizon) {
    const at = (frac) => clamp01((s.y + frac * s.h) / view.h);
    const horizonStop = mixOklab(horizon, mixOklab(look.skyMid, '#FFFFFF', HORIZON_MIX[1]), look.light);
    return linear(view.h, [[0, look.skyTop], [at(0.3), look.skyMid], [at(0.44), horizonStop], [at(0.6), look.seaFar], [1, look.seaNear]]);
  }

  /** Every gradient and derived colour for a look and geometry, rebuilt only when one of them changes. */
  function ensureGradients(look, s) {
    const key = `${view.w}x${view.h}|${s.x},${s.y},${s.w},${s.h}|${COLOR_KEYS.map((k) => look[k]).join('')}|${look.light}`;
    if (grads?.key === key) return grads;
    const horizon = mixOklab(look.skyMid, look.glow, HORIZON_MIX[0]);
    const crest = mixOklab(look.seaFar, look.foam, CREST_MIX);
    const mist = mixOklab(look.skyMid, look.foam, MIST_MIX);
    const corona = mixOklab(look.glow, '#FFFFFF', SUN.coronaMix);
    const vignette = vignetteTint(look, look.light);
    const fadeOut = (color, peak, mid) => [[0, rgba(color, 1)], [mid, rgba(color, peak)], [1, rgba(color, 0)]];
    grads = {
      key,
      sky: skyGradient(look, s, horizon),
      seas: AERIAL.map(([top, deep]) => linear(SEA_DEPTH_PX, [[0, mixOklab(crest, horizon, top)], [1, mixOklab(look.seaNear, horizon, deep)]])),
      mist: linear(1, [[0, rgba(mist, 0)], [0.5, rgba(mist, 1)], [1, rgba(mist, 0)]]),
      haze: linear(1, [[0, rgba(look.foam, 1)], [1, rgba(look.foam, 0)]]),
      glow: radial(fadeOut(look.glow, 0.4, 0.45)),
      halo: radial([[0, rgba(look.foam, 0.3)], [0.35, rgba(look.foam, 0.12)], [1, rgba(look.foam, 0)]]),
      moon: radial([[0, look.foam], [0.6, look.foam], [1, mixOklab(look.foam, look.skyMid, MOON_LIMB)]], -0.3, -0.3, 1.3),
      sun: radial(fadeOut(look.glow, 0.35, 0.4)),
      corona: radial(fadeOut(corona, 0.35, 0.45)),
      pillar: radial(fadeOut(look.foam, 0.35, 0.5)),
      vignette: radial([[0, rgba(vignette.color, 0)], [VIGNETTE_INNER, rgba(vignette.color, 0)], [1, rgba(vignette.color, 1)]]),
      vignetteAlpha: vignette.alpha,
      glint: glintColor(look, look.light),
    };
    return grads;
  }

  /** Fills a unit-space gradient as an ellipse (rx, ry) at (cx, cy); the unit rect spans ±pad, from `top` down. */
  function fillUnit(c, grad, cx, cy, rx, ry, alpha, pad = 1, top = -pad) {
    c.save();
    c.translate(cx, cy);
    c.scale(rx, ry);
    c.globalAlpha = alpha;
    c.fillStyle = grad;
    c.fillRect(-pad, top, 2 * pad, pad - top);
    c.restore();
  }

  function disc(c, fill, cx, cy, r, alpha) {
    c.save();
    c.translate(cx, cy);
    c.scale(r, r);
    c.globalAlpha = alpha;
    c.fillStyle = fill;
    c.beginPath();
    c.arc(0, 0, 1, 0, 2 * Math.PI);
    c.fill();
    c.restore();
  }

  /** Moon (dark): a wide corona, the halo and a limb-shaded disc. Sun (light): two coronas and a warm white core. */
  function drawLight(c, gr, look, s) {
    const { x, y, r } = lightOf(s);
    const dark = 1 - look.light;
    if (dark > 0.001) {
      fillUnit(c, gr.halo, x, y, MOON_CORONA[0] * r, MOON_CORONA[0] * r, MOON_CORONA[1] * dark);
      fillUnit(c, gr.halo, x, y, MOON_HALO * r, MOON_HALO * r, dark);
      disc(c, gr.moon, x, y, r, MOON_ALPHA * dark);
    }
    if (look.light > 0.001) {
      SUN_CORONAS.forEach(([k, alpha], i) => fillUnit(c, i ? gr.corona : gr.sun, x, y, k * r, k * r, alpha * look.light));
      disc(c, SUN.color, x, y, SUN.core * r, SUN.alpha * look.light);
    }
  }

  function paintBackdrop(c, gr, look, s) {
    c.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    c.globalAlpha = 1;
    c.fillStyle = gr.sky;
    c.fillRect(0, 0, view.w, view.h);
    c.save();
    c.translate(s.x, s.y);
    drawLight(c, gr, look, s);
    c.restore();
  }

  /** Sky and light source: drawn directly while their inputs change (crossfade, resize, scroll), else one cached blit. */
  function drawBackdrop(gr, look, s) {
    const key = `${gr.key}|${view.dpr}`;
    if (backdrop?.key !== key) {
      const stable = backdropNext === key;
      backdropNext = key;
      if (stable && !backdrop) {
        const offscreen = document.createElement('canvas');
        const c = get2d(offscreen, { alpha: false });
        if (c) backdrop = { canvas: offscreen, ctx: c, key: '' };
      }
      if (!stable || !backdrop) {
        paintBackdrop(ctx, gr, look, s);
        return;
      }
      backdrop.canvas.width = canvas.width;
      backdrop.canvas.height = canvas.height;
      paintBackdrop(backdrop.ctx, gr, look, s);
      backdrop.key = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.drawImage(backdrop.canvas, 0, 0);
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }

  /** A wide wash over the horizon and a source glow under the light; both follow the pad (± 3 %). */
  function drawGlow(gr, look, s, g) {
    const base = lerp(GLOW_ALPHA[0], GLOW_ALPHA[1], look.light) * (1 + PAD_GLOW * texture.pad.cur);
    fillUnit(ctx, gr.glow, WASH.at[0] * s.w, WASH.at[1] * s.h, WASH.radii[0] * s.w, WASH.radii[1] * s.h, base * WASH.alpha);
    fillUnit(ctx, gr.glow, g.layout.lightX, g.layout.horizonY, SOURCE.radii[0] * s.w, SOURCE.radii[1] * s.h, base * SOURCE.alpha);
  }

  function drawStars(stars, look, tS) {
    if (look.stars < 0.001) return;
    ctx.fillStyle = look.foam;
    for (const star of stars) {
      ctx.globalAlpha = look.stars * starAlpha(star, tS);
      ctx.beginPath();
      ctx.arc(star.x, star.y, star.r, 0, 2 * Math.PI);
      ctx.fill();
    }
  }

  function fillBand(spec, pts, grad, s, amp) {
    const crest = spec.base - spec.amp * amp;
    const last = pts.xs.length - 1;
    ctx.save();
    ctx.translate(0, crest);
    ctx.globalAlpha = 1;
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(pts.xs[0], pts.ys[0] - crest);
    for (let i = 1; i <= last; i += 1) ctx.lineTo(pts.xs[i], pts.ys[i] - crest);
    ctx.lineTo(pts.xs[last], s.h - crest);
    ctx.lineTo(pts.xs[0], s.h - crest);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /** Foam along a crest: 24 px segments whose alpha follows the phase, batched into four alpha buckets (one stroke each). */
  function strokeFoam(spec, pts, tS, look, extra, depth) {
    const per = FOAM_SEGMENT_PX / WAVE_STEP_PX;
    const last = pts.xs.length - 1;
    const base = lerp(FOAM_ALPHA[0][0], FOAM_ALPHA[1][0], look.light);
    const span = lerp(FOAM_ALPHA[0][1], FOAM_ALPHA[1][1], look.light);
    for (let i0 = 0, n = 0; i0 < last; i0 += per, n += 1) {
      const phase = wavePhase(spec, (pts.xs[i0] + pts.xs[Math.min(i0 + per, last)]) / 2, tS);
      pts.buckets[n] = Math.round(FOAM_LEVELS * Math.max(0, Math.sin(phase)));
    }
    ctx.strokeStyle = look.foam;
    ctx.lineWidth = FOAM_WIDTH_PX;
    ctx.lineCap = 'butt';
    for (let level = 0; level <= FOAM_LEVELS; level += 1) {
      let any = false;
      ctx.beginPath();
      for (let i0 = 0, n = 0; i0 < last; i0 += per, n += 1) {
        if (pts.buckets[n] !== level) continue;
        any = true;
        ctx.moveTo(pts.xs[i0], pts.ys[i0]);
        for (let i = i0 + 1, i1 = Math.min(i0 + per, last); i <= i1; i += 1) ctx.lineTo(pts.xs[i], pts.ys[i]);
      }
      if (!any) continue;
      ctx.globalAlpha = Math.max(0, (base + (span * level) / FOAM_LEVELS + extra) * depth);
      ctx.stroke();
    }
  }

  function drawBand(g, gr, look, s, index, tS, roll) {
    const amp = ampOf(index, roll);
    const pts = samplePoints(g, index, tS, amp);
    fillBand(g.bands[index], pts, gr.seas[index], s, amp);
    const extra = index === 3 ? ROLL_FOAM * roll + SET_FOAM * texture.set.cur : 0;
    strokeFoam(g.bands[index], pts, tS, look, extra, FOAM_BAND[index]);
  }

  /** A thin static mist over the horizon seam, drawn after band 0. */
  function drawMist(gr, look, g, s) {
    ctx.save();
    ctx.translate(0, g.layout.horizonY - MIST_HALF * s.h);
    ctx.scale(1, 2 * MIST_HALF * s.h);
    ctx.globalAlpha = lerp(MIST_ALPHA[0], MIST_ALPHA[1], look.light);
    ctx.fillStyle = gr.mist;
    ctx.fillRect(0, 0, s.w, 1);
    ctx.restore();
  }

  function drawHaze(gr, s, density) {
    const alpha = HAZE_ALPHA * density * clamp01((density - HAZE_FROM) / HAZE_RAMP) * (1 + HAZE_GUST * texture.gust.cur);
    if (alpha <= 0) return;
    ctx.save();
    ctx.scale(1, s.h);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = gr.haze;
    ctx.fillRect(0, 0, s.w, 1);
    ctx.restore();
  }

  function drawRain(drops, foam) {
    if (drops.length === 0) return;
    ctx.strokeStyle = foam;
    ctx.lineWidth = 1;
    ctx.lineCap = 'butt';
    for (let b = 0; b < RAIN_BUCKETS; b += 1) {
      ctx.globalAlpha = RAIN_ALPHA_MIN + RAIN_ALPHA_STEP * (b + 0.5);
      ctx.beginPath();
      for (const d of drops) {
        if (rainBucket(d.alpha) !== b) continue;
        const k = d.len / d.speed;
        ctx.moveTo(d.x - d.vx * k, d.y - d.vy * k);
        ctx.lineTo(d.x, d.y);
      }
      ctx.stroke();
    }
  }

  /** The light on the water: a pillar below the horizon that widens with the sea, and a touch where it meets the horizon. */
  function drawReflection(gr, look, g, s) {
    const { horizonY, lightX } = g.layout;
    const depth = s.h - horizonY;
    const halfWidth = PILLAR.halfWidth * s.w * spreadScale(sliders.ocean.cur);
    const pillarAlpha = lerp(PILLAR.alpha[0], PILLAR.alpha[1], look.light);
    fillUnit(ctx, gr.pillar, lightX, horizonY + PILLAR.drop * depth, halfWidth, PILLAR.reach * depth, pillarAlpha, 1, -PILLAR.drop / PILLAR.reach);
    fillUnit(ctx, gr.pillar, lightX, horizonY, TOUCH.radii[0] * s.w, TOUCH.radii[1] * s.h, lerp(TOUCH.alpha[0], TOUCH.alpha[1], look.light));
  }

  /** Glints as short horizontal ellipses in three alpha bins of the theme's peak, one fill each. */
  function drawGlitter(sparkles, color, light) {
    const peak = lerp(SHIMMER.peakAlpha.dark[1], SHIMMER.peakAlpha.light[1], light);
    ctx.fillStyle = color;
    for (let bin = 0; bin < GLINT_BINS; bin += 1) {
      let any = false;
      ctx.beginPath();
      for (const sp of sparkles) {
        if (!(sp.alpha > 0) || Math.min(GLINT_BINS - 1, Math.floor((GLINT_BINS * sp.alpha) / peak)) !== bin) continue;
        any = true;
        ctx.moveTo(sp.x + sp.len / 2, sp.y);
        ctx.ellipse(sp.x, sp.y, sp.len / 2, sp.thick / 2, 0, 0, 2 * Math.PI);
      }
      if (!any) continue;
      ctx.globalAlpha = (peak * (bin + 0.5)) / GLINT_BINS;
      ctx.fill();
    }
  }

  function drawRipples(ripples, foam) {
    ctx.strokeStyle = foam;
    ctx.lineWidth = 1;
    for (const ripple of ripples) {
      const p = ripple.age / ripple.life;
      ctx.globalAlpha = 0.5 * (1 - p);
      ctx.beginPath();
      ctx.ellipse(ripple.x, ripple.y, RIPPLE_R_PX * p, RIPPLE_R_PX * p * RIPPLE_SQUASH, 0, 0, 2 * Math.PI);
      ctx.stroke();
    }
  }

  function drawVignette(gr) {
    fillUnit(ctx, gr.vignette, view.w / 2, view.h / 2, VIGNETTE_RADIUS * view.w, VIGNETTE_RADIUS * view.h, gr.vignetteAlpha);
  }

  /** Still frames show a sparse, frozen subset of a dedicated pool at half the slider density. */
  function stillDrops(g) {
    return g.stillRain.drops.slice(0, Math.round(STILL_RAIN_SCALE * sliders.rain.target * QUALITY_TIERS.low.maxDrops));
  }

  /** One frame at scene time tS; glintsOf(geometry) supplies the glitter (the live field, or a rebuilt one for renderFrame). */
  function draw(tS, glintsOf = () => field?.sparkles ?? NO_GLINTS) {
    const s = stageRect();
    if (view.w < 2 || view.h < 2 || s.w < 2 || s.h < 2) return;
    const look = currentLook(now());
    const g = ensureGeometry(s);
    const gr = ensureGradients(look, s);
    const roll = rollEnvelope(rolls, tS);
    const frozen = isStatic();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawBackdrop(gr, look, s);
    ctx.save();
    ctx.translate(s.x, s.y);
    drawGlow(gr, look, s, g);
    drawStars(g.stars, look, tS);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, s.w, s.h);
    ctx.clip();
    drawBand(g, gr, look, s, 0, tS, roll);
    drawMist(gr, look, g, s);
    for (let i = 1; i < 3; i += 1) drawBand(g, gr, look, s, i, tS, roll);
    drawHaze(gr, s, sliders.rain.cur);
    drawRain(frozen ? stillDrops(g) : g.particles.drops, look.foam);
    drawBand(g, gr, look, s, 3, tS, roll);
    drawReflection(gr, look, g, s);
    if (!frozen && tier.glints > 0) drawGlitter(glintsOf(g), gr.glint, look.light);
    if (tier.ripples && !frozen) drawRipples(g.particles.ripples, look.foam);
    ctx.restore();
    ctx.restore();
    drawVignette(gr);
    ctx.globalAlpha = 1;
    hasDrawn = true;
  }

  function ease(slider, dt) {
    slider.cur += (slider.target - slider.cur) * (1 - Math.exp(-dt / SLIDER_TAU_S));
    if (Math.abs(slider.target - slider.cur) < 1e-3) slider.cur = slider.target;
  }

  /** Texture values move linearly so each lands on its target at the target's time. */
  function approachTexture(dt) {
    const t = now();
    for (const key of TEXTURE_KEYS) {
      const value = texture[key];
      value.cur += (value.target - value.cur) * Math.min(1, dt / Math.max(TEXTURE_MIN_S, (value.at - t) / 1000));
    }
  }

  /** Moves the picture on by dt seconds: eased sliders and texture, expired rolls, the rain pool and the glitter. */
  function advance(dt) {
    sceneT += dt;
    ease(sliders.rain, dt);
    ease(sliders.ocean, dt);
    approachTexture(dt);
    rolls = liveRolls(sceneT);
    const g = ensureGeometry(stageRect());
    const amp = ampOf(3, rollEnvelope(rolls, sceneT));
    g.particles.step(dt, sliders.rain.cur, (x) => g.bands[3].base + waveHeight(g.bands[3], x, sceneT, amp));
    ensureField(g)?.step(dt, sceneT, { spread01: sliders.ocean.cur, light01: fade.to.light });
  }

  /** Drops frame timestamps older than one second and returns how many remain. */
  function pruneFrames(t) {
    while (frameTimes.length && frameTimes[0] <= t - 1000) frameTimes.shift();
    return frameTimes.length;
  }

  const shouldAnimate = () => running && !destroyed && !document.hidden && (!isStatic() || needsFrame);

  function frame() {
    rafId = 0;
    if (!shouldAnimate()) return;
    const t = now();
    const interval = 1000 / (isStatic() ? STILL_FPS : tier.fps);
    if (t - lastDraw >= interval - FRAME_TOLERANCE_MS) {
      const dt = Math.min(MAX_DT_S, Math.max(0, (t - lastTick) / 1000));
      lastTick = t;
      lastDraw = t;
      if (isStatic()) {
        draw(STILL_T_S);
        needsFrame = isFading(t); // keep interpolating colours at 10 fps until the crossfade has settled
      } else {
        advance(dt);
        draw(sceneT);
      }
      frameTimes.push(t);
      pruneFrames(t);
    }
    if (shouldAnimate()) rafId = requestAnimationFrame(frame);
  }

  /** Starts the loop if it should run and is not already scheduled; time resumes from the accumulated scene clock. */
  function kick() {
    if (rafId || !shouldAnimate()) return;
    lastTick = now();
    lastDraw = -Infinity;
    rafId = requestAnimationFrame(frame);
  }

  function cancelLoop() {
    if (!rafId) return;
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function requestFrame() {
    needsFrame = true;
    kick();
  }

  /** Re-creates the backing store only when the CSS width, the DPR cap or the height by more than 80 px changed. */
  function measure() {
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dprCap);
    if (cssW === view.w && dpr === view.dpr && Math.abs(cssH - view.h) <= HEIGHT_TOLERANCE_PX) return;
    view.w = cssW;
    view.h = cssH;
    view.dpr = dpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    requestFrame();
  }

  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = 0;
      if (!destroyed) measure();
    }, RESIZE_DEBOUNCE_MS);
  }

  function onVisibility() {
    if (document.hidden) cancelLoop();
    else kick();
  }

  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', onVisibility);

  /** Crossfades every colour and scalar to `next` over ms (instant before the first frame or with ms ≤ 0). */
  function fadeTo(next, ms) {
    const t = now();
    const instant = !(ms > 0) || !hasDrawn;
    fade.from = instant ? next : currentLook(t);
    fade.to = next;
    fade.start = t;
    fade.dur = instant ? 0 : ms;
    requestFrame();
  }

  function setPalette(palette, fadeMs = FADE_MS, { band: nextBand = band, theme } = {}) {
    band = nextBand;
    const light = theme ? theme === 'light' : relativeLuminance(palette.skyTop) > 0.4;
    fadeTo(visualState(palette, { light, stars: starsOn(light) }), fadeMs);
  }

  function setSlider(slider, x01) {
    slider.target = clamp01(Number(x01) || 0);
    if (!hasDrawn || isStatic()) slider.cur = slider.target;
    if (isStatic()) requestFrame();
  }

  /** Texture targets in [−1, 1], each to be reached at performance.now() time atMs; ignored while static. */
  function setTexture(values, atMs) {
    if (isStatic()) return;
    const at = Number.isFinite(atMs) ? atMs : now();
    for (const key of TEXTURE_KEYS) {
      const value = values?.[key];
      if (Number.isFinite(value)) Object.assign(texture[key], { target: Math.min(1, Math.max(-1, value)), at });
    }
  }

  /** Static frames rest every texture value at 0. */
  function restTexture() {
    if (!isStatic()) return;
    for (const key of TEXTURE_KEYS) Object.assign(texture[key], { cur: 0, target: 0 });
  }

  function setStageRect(rect) {
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) return;
    if (stage && stage.x === rect.x && stage.y === rect.y && stage.w === rect.w && stage.h === rect.h) return;
    stage = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    requestFrame();
  }

  const liveRolls = (tS) => rolls.filter((roll) => tS < roll.at + roll.dur);

  function rollWave(atPerfMs, durationS, strength = 1) {
    const at = Number.isFinite(atPerfMs) ? sceneT + (atPerfMs - now()) / 1000 : sceneT;
    const k = ROLL_STRENGTH[0] + ROLL_STRENGTH[1] * clamp01(Number.isFinite(strength) ? strength : 1);
    rolls = [...liveRolls(sceneT), { at, dur: Math.max(ROLL_MIN_S, Number(durationS) || 0), k }];
  }

  function setQuality(next) {
    tier = { ...tier, ...next };
    measure();
    restTexture();
    const stars = starsOn(fade.to.light === 1) ? 1 : 0;
    if (stars !== fade.to.stars) fadeTo({ ...fade.to, stars }, FADE_MS);
    requestFrame();
  }

  function setStill(flag) {
    still = Boolean(flag);
    restTexture();
    requestFrame();
  }

  function start() {
    if (destroyed || running) return;
    running = true;
    canvas.setAttribute('data-live', '');
    measure();
    requestFrame();
  }

  function stop() {
    running = false;
    cancelLoop();
  }

  function renderFrame(tMs) {
    if (!view.w) measure();
    const tS = (Number(tMs) || 0) / 1000;
    draw(tS, (g) => sparklesAt(glintSeed, {
      tier: tier.tier, band, layout: g.layout, tS, spread01: sliders.ocean.cur, light01: fade.to.light,
    }));
  }

  const frameRate = () => pruneFrames(now());

  /** Samples the drawn canvas at 10 fps through a 32×32 downscale → { maxDelta, reversalsPerSecond, samples }. */
  function luminanceTrace(seconds = 5) {
    const total = Math.max(2, Math.round(seconds * TRACE_FPS));
    if (!scratchCtx) {
      const scratch = document.createElement('canvas');
      scratch.width = TRACE_SIZE;
      scratch.height = TRACE_SIZE;
      scratchCtx = scratch.getContext('2d', { willReadFrequently: true });
    }
    return new Promise((resolve) => {
      const samples = [];
      let timer = 0;
      const finish = () => {
        clearTimeout(timer);
        traces.delete(finish);
        resolve(summariseTrace(samples));
      };
      const tick = () => {
        samples.push(meanLuminance(canvas, scratchCtx));
        if (samples.length >= total) finish();
        else timer = setTimeout(tick, 1000 / TRACE_FPS);
      };
      traces.add(finish);
      tick();
    });
  }

  function destroy() {
    stop();
    destroyed = true;
    clearTimeout(resizeTimer);
    window.removeEventListener('resize', onResize);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const finish of [...traces]) finish();
    canvas.removeAttribute('data-live');
    if (backdrop) backdrop.canvas.width = 0;
    backdrop = null;
  }

  return {
    /** Marks the canvas live and runs the loop (or draws the one still frame). */
    start,
    /** Pauses the loop; the scene clock keeps its value for a seamless resume. */
    stop,
    /** Crossfades to a bandPalette() object; band picks stars and glint rate, theme picks moon or sun and glow strength. */
    setPalette,
    /** Rain density 0–1. */
    setRain: (x01) => setSlider(sliders.rain, x01),
    /** Ocean energy 0–1 (wave amplitude × (0.6 + 0.7·x); also widens the pillar and the glitter path). */
    setOcean: (x01) => setSlider(sliders.ocean, x01),
    /** Slow texture { pad, gust, set } in [−1, 1] reached at performance.now() time atMs: glows, haze and near swell. */
    setTexture,
    /** Viewport-px rect the water, rain and glow centre are composed in. */
    setStageRect,
    /** A wave crash at performance.now() time atPerfMs lasting durationS (≥ 3 s), lifted × (0.6 + 0.4·strength 0–1). */
    rollWave,
    /** New pickQuality() tier: DPR cap, fps, drop count, stars, ripples and glints. */
    setQuality,
    /** Still mode: one frozen frame, palette changes as colour-only interpolation. */
    setStill,
    /** Debounced re-measure of the canvas (150 ms). */
    resize: onResize,
    /** Draws one deterministic frame at scene time tMs without advancing anything. */
    renderFrame,
    /** Frames drawn in the last second. */
    frameRate,
    luminanceTrace,
    /** Stops the loop and removes the resize and visibilitychange listeners. */
    destroy,
  };
}
