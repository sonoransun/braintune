import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BAND_PALETTES, NEUTRALS, SCRIM_BY_BAND, bandPalette, hexToRgb, rgbToHex, parseColor, blend,
  relativeLuminance, contrastRatio, mixOklab, smoothstep, scrimFor, vignetteTint,
} from '../docs/js/core/palette.js';
import { SHIMMER, glintColor } from '../docs/js/core/shimmer.js';

const BANDS = ['delta', 'theta', 'alpha', 'beta', 'gamma'];
const THEMES = ['dark', 'light'];
const PALETTE_KEYS = ['skyTop', 'skyMid', 'glow', 'seaFar', 'seaNear', 'foam', 'accent', 'accentInk', 'orbCore'];
const NEUTRAL_KEYS = ['text', 'text2', 'surface', 'surfaceOpaque', 'surface2', 'border', 'borderStrong', 'track', 'thumb', 'focus', 'focusInner', 'scrim'];
const HEX6 = /^#[0-9A-F]{6}$/;

const uiSurface = (theme, band) => blend(NEUTRALS[theme].surfaceOpaque, BAND_PALETTES[theme][band].skyMid);
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const css = (name) => readFileSync(new URL(`../docs/css/${name}.css`, import.meta.url), 'utf8');
const escapeRe = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The text of `@media (<query>) { … }` in tokens.css, braces matched. */
function mediaBlock(query) {
  const tokens = css('tokens');
  const start = tokens.indexOf(`@media (${query})`);
  assert.ok(start >= 0, `tokens.css has no @media (${query})`);
  let depth = 0;
  for (let i = tokens.indexOf('{', start); i < tokens.length; i += 1) {
    if (tokens[i] === '{') depth += 1;
    else if (tokens[i] === '}' && (depth -= 1) === 0) return tokens.slice(start, i + 1);
  }
  return '';
}

/** The value the first rule for `selector` inside `text` that declares `prop` gives it, or undefined. */
function declared(text, selector, prop) {
  for (const [, body] of text.matchAll(new RegExp(`(?:^|[\\s}])${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'g'))) {
    const value = body.match(new RegExp(`${escapeRe(prop)}\\s*:\\s*([^;]+);`))?.[1].trim();
    if (value) return value;
  }
  return undefined;
}

test('every band × theme has all keys as valid uppercase hex', () => {
  for (const theme of THEMES) {
    assert.deepEqual(Object.keys(BAND_PALETTES[theme]), BANDS);
    for (const band of BANDS) {
      const p = BAND_PALETTES[theme][band];
      assert.deepEqual(Object.keys(p), PALETTE_KEYS, `${theme}/${band} keys`);
      for (const key of PALETTE_KEYS) assert.match(p[key], HEX6, `${theme}/${band}/${key}`);
    }
  }
});

test('theme-specific palette rules: dark accentInk = accent; light foam white and orbCore = accent', () => {
  for (const band of BANDS) {
    assert.equal(BAND_PALETTES.dark[band].accentInk, BAND_PALETTES.dark[band].accent);
    assert.equal(BAND_PALETTES.light[band].foam, '#FFFFFF');
    assert.equal(BAND_PALETTES.light[band].orbCore, BAND_PALETTES.light[band].accent);
  }
});

test('neutrals carry every token in both themes and all parse as colours', () => {
  for (const theme of THEMES) {
    assert.deepEqual(Object.keys(NEUTRALS[theme]), NEUTRAL_KEYS);
    for (const key of NEUTRAL_KEYS) {
      const c = parseColor(NEUTRALS[theme][key]);
      for (const ch of ['r', 'g', 'b']) assert.ok(c[ch] >= 0 && c[ch] <= 255);
      assert.ok(c.a > 0 && c.a <= 1);
    }
  }
  assert.equal(parseColor(NEUTRALS.dark.surfaceOpaque).a, 0.94);
  assert.equal(parseColor(NEUTRALS.light.track).a, 0.52);
});

test('bandPalette returns the table entry, defaults to dark and throws on unknown input', () => {
  assert.equal(bandPalette('alpha'), BAND_PALETTES.dark.alpha);
  assert.equal(bandPalette('gamma', 'light'), BAND_PALETTES.light.gamma);
  assert.throws(() => bandPalette('omega'), RangeError);
  assert.throws(() => bandPalette('alpha', 'sepia'), RangeError);
});

test('hexToRgb / rgbToHex / parseColor round-trip and accept short, long and functional forms', () => {
  assert.deepEqual(hexToRgb('#10164A'), { r: 16, g: 22, b: 74 });
  assert.deepEqual(hexToRgb('#fff'), { r: 255, g: 255, b: 255 });
  assert.equal(rgbToHex({ r: 16, g: 22, b: 74 }), '#10164A');
  assert.equal(rgbToHex({ r: 300, g: -4, b: 12.6 }), '#FF000D');
  assert.deepEqual(parseColor('rgb(10 14 32 / 0.82)'), { r: 10, g: 14, b: 32, a: 0.82 });
  assert.deepEqual(parseColor('rgb(10 14 32/.82)'), { r: 10, g: 14, b: 32, a: 0.82 });
  assert.deepEqual(parseColor('rgba(255, 255, 255, 40%)'), { r: 255, g: 255, b: 255, a: 0.4 });
  assert.deepEqual(parseColor('#FFFFFF80').a.toFixed(3), '0.502');
  assert.throws(() => hexToRgb('blue'), TypeError);
  assert.throws(() => parseColor('hsl(0 0% 0%)'), TypeError);
});

test('blend composites alpha over an opaque background', () => {
  assert.deepEqual(blend({ r: 255, g: 255, b: 255, a: 0.5 }, { r: 0, g: 0, b: 0 }), { r: 127.5, g: 127.5, b: 127.5 });
  assert.deepEqual(blend('rgb(0 0 0 / 1)', '#FFFFFF'), { r: 0, g: 0, b: 0 });
  assert.deepEqual(blend('#FF000000', '#00FF00'), { r: 0, g: 255, b: 0 });
});

test('relativeLuminance: white = 1, black = 0, mid grey per sRGB curve', () => {
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(relativeLuminance('#000000'), 0);
  near(relativeLuminance('#808080'), 0.2158605, 1e-6);
  near(relativeLuminance({ r: 255, g: 255, b: 255 }), 1);
});

test('contrastRatio is symmetric and spans 1–21', () => {
  near(contrastRatio('#000000', '#FFFFFF'), 21);
  near(contrastRatio('#FFFFFF', '#000000'), 21);
  near(contrastRatio('#123456', '#123456'), 1);
});

test('mixOklab: identity, endpoints, clamping of t and perceptual midpoint', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      const p = BAND_PALETTES[theme][band];
      for (const t of [0, 0.25, 0.5, 0.75, 1]) assert.equal(mixOklab(p.accent, p.accent, t), p.accent);
      assert.equal(mixOklab(p.skyTop, p.foam, 0), p.skyTop);
      assert.equal(mixOklab(p.skyTop, p.foam, 1), p.foam);
      assert.equal(mixOklab(p.skyTop, p.foam, -3), p.skyTop);
      assert.equal(mixOklab(p.skyTop, p.foam, 7), p.foam);
    }
  }
  const mid = mixOklab('#000000', '#FFFFFF', 0.5);
  assert.match(mid, HEX6);
  const l = relativeLuminance(mid);
  assert.ok(l > 0.1 && l < 0.3, `OKLab midpoint of black/white should be perceptually mid (L≈0.18), got ${l}`);
  const between = relativeLuminance(mixOklab('#10164A', '#B8C0FF', 0.5));
  assert.ok(between > relativeLuminance('#10164A') && between < relativeLuminance('#B8C0FF'));
});

test('smoothstep endpoints, midpoint, clamping and monotonicity', () => {
  assert.equal(smoothstep(0), 0);
  assert.equal(smoothstep(1), 1);
  assert.equal(smoothstep(0.5), 0.5);
  assert.equal(smoothstep(-1), 0);
  assert.equal(smoothstep(2), 1);
  let prev = 0;
  for (let t = 0; t <= 1; t += 0.01) {
    const v = smoothstep(t);
    assert.ok(v >= prev);
    prev = v;
  }
});

test('dark: text and text2 over the opaque surface blended on skyMid ≥ 4.5 for every band', () => {
  for (const band of BANDS) {
    const surface = uiSurface('dark', band);
    assert.ok(contrastRatio(NEUTRALS.dark.text, surface) >= 4.5, `text/${band}`);
    assert.ok(contrastRatio(NEUTRALS.dark.text2, surface) >= 4.5, `text2/${band}`);
  }
});

test('dark: accent and the 40 % white track over the blended surface ≥ 3 (UI contrast)', () => {
  for (const band of BANDS) {
    const surface = uiSurface('dark', band);
    assert.ok(contrastRatio(BAND_PALETTES.dark[band].accent, surface) >= 3, `accent/${band}`);
    const track = blend(NEUTRALS.dark.track, surface);
    assert.ok(contrastRatio(track, surface) >= 3, `track/${band}`);
  }
});

test('light: text and accentInk ≥ 4.5, accent and track ≥ 3 over the blended surface', () => {
  for (const band of BANDS) {
    const surface = uiSurface('light', band);
    const p = BAND_PALETTES.light[band];
    assert.ok(contrastRatio(NEUTRALS.light.text, surface) >= 4.5, `text/${band}`);
    assert.ok(contrastRatio(NEUTRALS.light.text2, surface) >= 4.5, `text2/${band}`);
    assert.ok(contrastRatio(p.accentInk, surface) >= 4.5, `accentInk/${band}`);
    assert.ok(contrastRatio(p.accent, surface) >= 3, `accent/${band}: ${contrastRatio(p.accent, surface)}`);
    const track = blend(NEUTRALS.light.track, surface);
    assert.ok(contrastRatio(track, surface) >= 3, `track/${band}`);
  }
});

test('scrimFor: the dark gamma override, the theme scrim elsewhere, a RangeError for an unknown theme', () => {
  assert.equal(scrimFor('dark', 'gamma'), 'rgb(10 14 32 / 0.66)');
  assert.equal(scrimFor('light', 'gamma'), NEUTRALS.light.scrim);
  for (const band of ['delta', 'theta', 'alpha', 'beta']) assert.equal(scrimFor('dark', band), NEUTRALS.dark.scrim);
  assert.throws(() => scrimFor('sepia', 'alpha'), RangeError);
  assert.ok(Object.isFrozen(SCRIM_BY_BAND) && Object.isFrozen(SCRIM_BY_BAND.dark));
  assert.equal(declared(css('tokens'), 'html[data-band="gamma"]', '--scrim'), SCRIM_BY_BAND.dark.gamma, 'tokens.css carries the same override');
});

test('status pill: text and text2 over scrimFor(theme, band) on the glow ≥ 4.5 in all 10 cases', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      const pill = blend(scrimFor(theme, band), BAND_PALETTES[theme][band].glow);
      assert.ok(contrastRatio(NEUTRALS[theme].text, pill) >= 4.5, `text ${theme}/${band}`);
      const ratio = contrastRatio(NEUTRALS[theme].text2, pill);
      assert.ok(ratio >= 4.5, `text2 ${theme}/${band}: ${ratio.toFixed(2)}`);
    }
  }
  near(contrastRatio(NEUTRALS.dark.text2, blend(scrimFor('dark', 'gamma'), BAND_PALETTES.dark.gamma.glow)), 5.17, 0.01);
});

test('status pill under prefers-contrast (.80) and reduced transparency (.85) keeps text2 ≥ 4.5 (values from tokens.css)', () => {
  const cases = [
    ['prefers-contrast: more', (block, theme) => declared(block, theme === 'light' ? 'html[data-theme="light"]' : ':root', '--text-2')],
    ['prefers-reduced-transparency: reduce', (block, theme) => NEUTRALS[theme].text2],
  ];
  for (const [query, text2Of] of cases) {
    const block = mediaBlock(query);
    for (const theme of THEMES) {
      for (const band of BANDS) {
        const selector = theme === 'light' ? 'html[data-theme="light"]' : band === 'gamma' ? 'html[data-band="gamma"]' : ':root';
        const scrim = declared(block, selector, '--scrim');
        const text2 = text2Of(block, theme);
        assert.ok(scrim && text2, `${query}: ${selector} declares --scrim and text-2`);
        const ratio = contrastRatio(text2, blend(scrim, BAND_PALETTES[theme][band].glow));
        assert.ok(ratio >= 4.5, `${query} ${theme}/${band}: ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.equal(declared(mediaBlock('prefers-contrast: more'), 'html[data-band="gamma"]', '--scrim'), 'rgb(10 14 32 / 0.80)');
  assert.equal(declared(mediaBlock('prefers-reduced-transparency: reduce'), 'html[data-band="gamma"]', '--scrim'), 'rgb(10 14 32 / 0.85)');
});

test('orb halo swing from idle (0.30) to the largest declared halo alpha keeps |ΔL| < 0.10 (glow and core colours)', () => {
  const alphas = [...css('components').matchAll(/--halo-[ab]\s*:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const largest = Math.max(...alphas);
  assert.equal(largest, 0.45, 'waiting and playing share the largest halo alpha');
  for (const theme of THEMES) {
    for (const band of BANDS) {
      const p = BAND_PALETTES[theme][band];
      for (const color of [p.glow, p.orbCore]) {
        const halo = (a) => relativeLuminance(blend({ ...parseColor(color), a }, p.skyMid));
        assert.ok(Math.abs(halo(largest) - halo(0.3)) < 0.1, `${theme}/${band} ${color}`);
      }
    }
  }
});

test('glints at the largest peak alpha of each theme over sea-near and sea-far swing < 0.10 (dark ≤ 0.056, light ≤ 0.081)', () => {
  for (const theme of THEMES) {
    const peak = SHIMMER.peakAlpha[theme][1];
    const limit = theme === 'dark' ? 0.056 : 0.081;
    for (const band of BANDS) {
      const p = BAND_PALETTES[theme][band];
      const glint = { ...parseColor(glintColor(p, theme === 'light' ? 1 : 0)), a: peak };
      for (const under of [p.seaNear, p.seaFar]) {
        const swing = Math.abs(relativeLuminance(blend(glint, under)) - relativeLuminance(under));
        assert.ok(swing < 0.1 && swing <= limit + 5e-4, `${theme}/${band}: ${swing.toFixed(4)}`);
      }
    }
  }
  assert.equal(glintColor(BAND_PALETTES.dark.alpha, 0), mixOklab(BAND_PALETTES.dark.alpha.seaFar, BAND_PALETTES.dark.alpha.foam, 0.6));
  assert.equal(glintColor(BAND_PALETTES.light.alpha, 1), mixOklab(BAND_PALETTES.light.alpha.seaFar, '#FFFFFF', 0.55));
});

test('vignette tints darken the corners in both themes (sky and sea), at .24 dark and .10 light', () => {
  for (const theme of THEMES) {
    const light = theme === 'light' ? 1 : 0;
    for (const band of BANDS) {
      const p = BAND_PALETTES[theme][band];
      const { color, alpha } = vignetteTint(p, light);
      near(alpha, theme === 'light' ? 0.1 : 0.24, 1e-12);
      for (const key of ['skyTop', 'skyMid', 'seaFar', 'seaNear']) {
        const tinted = relativeLuminance(blend({ ...parseColor(color), a: alpha }, p[key]));
        assert.ok(tinted < relativeLuminance(p[key]), `${theme}/${band}/${key}`);
      }
    }
  }
  assert.equal(vignetteTint(BAND_PALETTES.dark.delta).color, mixOklab(BAND_PALETTES.dark.delta.skyTop, '#000000', 0.5));
  assert.equal(vignetteTint(BAND_PALETTES.light.delta, 1).color, mixOklab(BAND_PALETTES.light.delta.seaNear, '#000000', 0.35));
});
