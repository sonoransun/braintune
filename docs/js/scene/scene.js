// Canvas ocean and rain scene (plan §7.6). Full canvas: sky gradient, horizon glow, stars, moon or sun haze and a
// vignette. Inside the stage rect: four wave bands with foam, rain streaks, ripples and haze. The scene knows nothing
// about the sound: its inputs are a palette, two 0–1 sliders, wave-crash cues and quality/motion settings.
// Visual-rate contract (§7.9): the only periodic luminance changes are the 60 s glow drift and the 10–18 s star
// twinkle; everything else is translational motion (waves, rain) or a one-shot (ripple, palette crossfade, wave roll).
import { bandPalette, hexToRgb, mixOklab, relativeLuminance, smoothstep } from '../core/palette.js';
import { mulberry32 } from '../core/rng.js';
import {
  QUALITY_TIERS, createRainParticles, makeStars, makeWaveBands, starAlpha, waveHeight, wavePhase,
} from '../core/scene-model.js';

const COLOR_KEYS = ['skyTop', 'skyMid', 'glow', 'seaFar', 'seaNear', 'foam'];
const SCALAR_KEYS = ['light', 'stars'];
const STAR_BANDS = new Set(['delta', 'theta', 'alpha']);
const FADE_MS = 2500;
const STILL_T_S = 1234; // the one frame drawn in Still mode / tier off
const STILL_FPS = 10; // colour-only interpolation rate while static
const STILL_RAIN_SCALE = 0.5;
const MAX_DT_S = 0.1;
const FRAME_TOLERANCE_MS = 2;
const RESIZE_DEBOUNCE_MS = 150;
const HEIGHT_TOLERANCE_PX = 80;
const SLIDER_TAU_S = 0.5; // rain/ocean sliders ease into the picture
const TRACE_FPS = 10;
const TRACE_SIZE = 32;
const TRACE_EPS = 1e-3;
const WAVE_STEP_PX = 6;
const FOAM_SEGMENT_PX = 24;
const FOAM_WIDTH_PX = 1.25;
const FOAM_ALPHA = [0.18, 0.22]; // .18 + .22·max(0, sin φ)
const SEA_DEPTH_PX = 120; // crest colour → sea-near this far below the crest
const CREST_MIX = 0.12; // mix(sea-far, foam, .12)
const OCEAN_AMP = [0.6, 0.7]; // amplitude × (0.6 + 0.7·ocean)
const ROLL_MIN_S = 3;
const ROLL_AMP = 0.25;
const ROLL_FOAM = 0.2;
const GLOW_ALPHA = [0.35, 0.5]; // dark, light
const GLOW_DRIFT = 0.03;
const GLOW_PERIOD_S = 60;
const GLOW_AT = [0.5, 0.46];
const GLOW_RADII = [0.55, 0.28]; // of stage w, h
const VIGNETTE_ALPHA = [0.35, 0.15]; // dark, light
const HAZE_ALPHA = 0.06;
const HAZE_FROM = 0.3; // haze appears above this density, ramped in over HAZE_RAMP to avoid a pop
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
const SUN_HAZE = 4.5;
const SUN_ALPHA = 0.6;
const MOON_ALPHA = 0.9;

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

/** Raised-cosine envelope (0–1) of the strongest live wave roll at scene time tS. */
function rollEnvelope(rolls, tS) {
  let env = 0;
  for (const roll of rolls) {
    const p = (tS - roll.at) / roll.dur;
    if (p > 0 && p < 1) env = Math.max(env, 0.5 - 0.5 * Math.cos(2 * Math.PI * p));
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

function get2d(canvas) {
  try {
    return canvas?.getContext?.('2d') ?? null;
  } catch {
    return null;
  }
}

/** The same API with no drawing, for a missing canvas or a browser without 2D canvas (the CSS sky shows instead). */
function inertScene() {
  const noop = () => {};
  return {
    start: noop, stop: noop, setPalette: noop, setRain: noop, setOcean: noop, setStageRect: noop, rollWave: noop,
    setQuality: noop, setStill: noop, resize: noop, renderFrame: noop, frameRate: () => 0, destroy: noop,
    luminanceTrace: () => Promise.resolve({ maxDelta: 0, reversalsPerSecond: 0, samples: [] }),
  };
}

/**
 * Scene on a canvas → { start, stop, setPalette, setRain, setOcean, setStageRect, rollWave, setQuality, setStill,
 * resize, renderFrame, luminanceTrace, frameRate, destroy }. quality from pickQuality(); rng and now are injectable.
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
  let geom = null; // wave bands, stars and particle pools for the current stage size and tier
  let grads = null; // gradients for the current colours and canvas geometry
  let rolls = [];
  let scratchCtx = null;
  const view = { w: 0, h: 0, dpr: 1 };
  const frameTimes = [];
  const sliders = { rain: { cur: 0, target: 0 }, ocean: { cur: 0.5, target: 0.5 } };
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
    const stillRain = createRainParticles({ rng, w: s.w, h: s.h, maxDrops: QUALITY_TIERS.low.maxDrops });
    stillRain.step(0, 1, (x) => bands[3].base + waveHeight(bands[3], x, STILL_T_S, OCEAN_AMP[0]));
    geom = {
      key,
      bands,
      stars: makeStars(rng, s.w, s.h, starCount(s.w, s.h)),
      particles: createRainParticles({ rng, w: s.w, h: s.h, maxDrops: tier.maxDrops }),
      stillRain,
      points: bands.map(() => ({ xs: new Float32Array(samples), ys: new Float32Array(samples) })),
    };
    return geom;
  }

  /** Band amplitude scale for this frame: the ocean slider, plus the roll lift on band 3. */
  function ampOf(index, roll) {
    const amp = OCEAN_AMP[0] + OCEAN_AMP[1] * sliders.ocean.cur;
    return index === 3 ? amp * (1 + ROLL_AMP * roll) : amp;
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

  function radial(stops) {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    for (const [offset, color] of stops) grad.addColorStop(offset, color);
    return grad;
  }

  function skyGradient(look, s) {
    const grad = ctx.createLinearGradient(0, 0, 0, view.h);
    const at = (frac) => clamp01((s.y + frac * s.h) / view.h);
    grad.addColorStop(0, look.skyTop);
    grad.addColorStop(at(0.3), look.skyMid);
    grad.addColorStop(at(0.44), mixOklab(look.skyMid, look.glow, 0.4));
    grad.addColorStop(at(0.6), look.seaFar);
    grad.addColorStop(1, look.seaNear);
    return grad;
  }

  function ensureGradients(look, s) {
    const key = `${view.w}x${view.h}|${s.x},${s.y},${s.w},${s.h}|${COLOR_KEYS.map((k) => look[k]).join('')}`;
    if (grads?.key === key) return grads;
    const sea = ctx.createLinearGradient(0, 0, 0, SEA_DEPTH_PX);
    sea.addColorStop(0, mixOklab(look.seaFar, look.foam, CREST_MIX));
    sea.addColorStop(1, look.seaNear);
    const haze = ctx.createLinearGradient(0, 0, 0, 1);
    haze.addColorStop(0, rgba(look.foam, 1));
    haze.addColorStop(1, rgba(look.foam, 0));
    grads = {
      key,
      sky: skyGradient(look, s),
      sea,
      haze,
      glow: radial([[0, rgba(look.glow, 1)], [0.45, rgba(look.glow, 0.4)], [1, rgba(look.glow, 0)]]),
      halo: radial([[0, rgba(look.foam, 0.3)], [0.35, rgba(look.foam, 0.12)], [1, rgba(look.foam, 0)]]),
      sun: radial([[0, rgba(look.glow, 1)], [0.4, rgba(look.glow, 0.35)], [1, rgba(look.glow, 0)]]),
      vignette: radial([[0, 'rgba(0,0,0,0)'], [0.55, 'rgba(0,0,0,0)'], [1, 'rgba(0,0,0,1)']]),
    };
    return grads;
  }

  /** Fills a unit-space gradient as an ellipse (rx, ry) centred at (cx, cy) with the given alpha. */
  function fillUnit(grad, cx, cy, rx, ry, alpha, pad = 1) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grad;
    ctx.fillRect(-pad, -pad, 2 * pad, 2 * pad);
    ctx.restore();
  }

  function drawSky(gr) {
    ctx.globalAlpha = 1;
    ctx.fillStyle = gr.sky;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  function drawGlow(gr, look, s, tS) {
    const base = lerp(GLOW_ALPHA[0], GLOW_ALPHA[1], look.light);
    const alpha = base * (1 + GLOW_DRIFT * Math.sin((2 * Math.PI * tS) / GLOW_PERIOD_S));
    fillUnit(gr.glow, GLOW_AT[0] * s.w, GLOW_AT[1] * s.h, GLOW_RADII[0] * s.w, Math.max(60, GLOW_RADII[1] * s.h), alpha);
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

  function drawMoon(gr, look, s) {
    const r = MOON_R * Math.min(s.w, s.h);
    const cx = MOON_AT[0] * s.w;
    const cy = (s.h > s.w ? MOON_Y_PORTRAIT : MOON_AT[1]) * s.h;
    const dark = 1 - look.light;
    if (dark > 0.001) {
      fillUnit(gr.halo, cx, cy, MOON_HALO * r, MOON_HALO * r, dark);
      ctx.globalAlpha = MOON_ALPHA * dark;
      ctx.fillStyle = look.foam;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, 2 * Math.PI);
      ctx.fill();
    }
    if (look.light > 0.001) fillUnit(gr.sun, cx, cy, SUN_HAZE * r, SUN_HAZE * r, SUN_ALPHA * look.light);
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

  function strokeFoam(spec, pts, tS, foam, extra) {
    const per = FOAM_SEGMENT_PX / WAVE_STEP_PX;
    const last = pts.xs.length - 1;
    ctx.strokeStyle = foam;
    ctx.lineWidth = FOAM_WIDTH_PX;
    ctx.lineCap = 'butt';
    for (let i0 = 0; i0 < last; i0 += per) {
      const i1 = Math.min(i0 + per, last);
      const phase = wavePhase(spec, (pts.xs[i0] + pts.xs[i1]) / 2, tS);
      ctx.globalAlpha = FOAM_ALPHA[0] + FOAM_ALPHA[1] * Math.max(0, Math.sin(phase)) + extra;
      ctx.beginPath();
      ctx.moveTo(pts.xs[i0], pts.ys[i0]);
      for (let i = i0 + 1; i <= i1; i += 1) ctx.lineTo(pts.xs[i], pts.ys[i]);
      ctx.stroke();
    }
  }

  function drawBand(g, gr, look, s, index, tS, roll) {
    const amp = ampOf(index, roll);
    const pts = samplePoints(g, index, tS, amp);
    fillBand(g.bands[index], pts, gr.sea, s, amp);
    strokeFoam(g.bands[index], pts, tS, look.foam, index === 3 ? ROLL_FOAM * roll : 0);
  }

  function drawHaze(gr, s, density) {
    const alpha = HAZE_ALPHA * density * clamp01((density - HAZE_FROM) / HAZE_RAMP);
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

  function drawVignette(gr, look) {
    const alpha = lerp(VIGNETTE_ALPHA[0], VIGNETTE_ALPHA[1], look.light);
    fillUnit(gr.vignette, view.w / 2, view.h / 2, 0.72 * view.w, 0.72 * view.h, alpha, 2);
  }

  /** Still frames show a sparse, frozen subset of a dedicated pool at half the slider density. */
  function stillDrops(g) {
    return g.stillRain.drops.slice(0, Math.round(STILL_RAIN_SCALE * sliders.rain.target * QUALITY_TIERS.low.maxDrops));
  }

  function draw(tS) {
    const s = stageRect();
    if (view.w < 2 || view.h < 2 || s.w < 2 || s.h < 2) return;
    const look = currentLook(now());
    const g = ensureGeometry(s);
    const gr = ensureGradients(look, s);
    const roll = rollEnvelope(rolls, tS);
    const frozen = isStatic();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    drawSky(gr);
    ctx.save();
    ctx.translate(s.x, s.y);
    drawGlow(gr, look, s, tS);
    drawStars(g.stars, look, tS);
    drawMoon(gr, look, s);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, s.w, s.h);
    ctx.clip();
    for (let i = 0; i < 3; i += 1) drawBand(g, gr, look, s, i, tS, roll);
    drawHaze(gr, s, sliders.rain.cur);
    drawRain(frozen ? stillDrops(g) : g.particles.drops, look.foam);
    drawBand(g, gr, look, s, 3, tS, roll);
    if (tier.ripples && !frozen) drawRipples(g.particles.ripples, look.foam);
    ctx.restore();
    ctx.restore();
    drawVignette(gr, look);
    ctx.globalAlpha = 1;
    hasDrawn = true;
  }

  function ease(slider, dt) {
    slider.cur += (slider.target - slider.cur) * (1 - Math.exp(-dt / SLIDER_TAU_S));
    if (Math.abs(slider.target - slider.cur) < 1e-3) slider.cur = slider.target;
  }

  /** Moves the picture on by dt seconds: eased sliders, expired rolls and the rain pool. */
  function advance(dt) {
    sceneT += dt;
    ease(sliders.rain, dt);
    ease(sliders.ocean, dt);
    rolls = liveRolls(sceneT);
    const g = ensureGeometry(stageRect());
    const amp = ampOf(3, rollEnvelope(rolls, sceneT));
    g.particles.step(dt, sliders.rain.cur, (x) => g.bands[3].base + waveHeight(g.bands[3], x, sceneT, amp));
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

  function setStageRect(rect) {
    if (!rect || !(rect.w > 0) || !(rect.h > 0)) return;
    if (stage && stage.x === rect.x && stage.y === rect.y && stage.w === rect.w && stage.h === rect.h) return;
    stage = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
    requestFrame();
  }

  const liveRolls = (tS) => rolls.filter((roll) => tS < roll.at + roll.dur);

  function rollWave(atPerfMs, durationS) {
    const at = Number.isFinite(atPerfMs) ? sceneT + (atPerfMs - now()) / 1000 : sceneT;
    rolls = [...liveRolls(sceneT), { at, dur: Math.max(ROLL_MIN_S, Number(durationS) || 0) }];
  }

  function setQuality(next) {
    tier = { ...tier, ...next };
    measure();
    const stars = starsOn(fade.to.light === 1) ? 1 : 0;
    if (stars !== fade.to.stars) fadeTo({ ...fade.to, stars }, FADE_MS);
    requestFrame();
  }

  function setStill(flag) {
    still = Boolean(flag);
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
    draw((Number(tMs) || 0) / 1000);
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
  }

  return {
    /** Marks the canvas live and runs the loop (or draws the one still frame). */
    start,
    /** Pauses the loop; the scene clock keeps its value for a seamless resume. */
    stop,
    /** Crossfades to a bandPalette() object; band picks stars, theme picks moon or sun and glow/vignette strength. */
    setPalette,
    /** Rain density 0–1. */
    setRain: (x01) => setSlider(sliders.rain, x01),
    /** Ocean energy 0–1 (wave amplitude × (0.6 + 0.7·x)). */
    setOcean: (x01) => setSlider(sliders.ocean, x01),
    /** Viewport-px rect the water, rain and glow centre are composed in. */
    setStageRect,
    /** A wave crash at performance.now() time atPerfMs lasting durationS (≥ 3 s): band-3 foam and amplitude swell. */
    rollWave,
    /** New pickQuality() tier: DPR cap, fps, drop count, stars and ripples. */
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
