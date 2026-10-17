// Band palettes, neutral tokens and colour maths (sRGB, WCAG, OKLab). Pure: no globals.

/** Per-theme, per-band colour tables (§7.5). Keys: skyTop skyMid glow seaFar seaNear foam accent accentInk orbCore. */
export const BAND_PALETTES = Object.freeze({
  dark: Object.freeze({
    delta: Object.freeze({ skyTop: '#070A1F', skyMid: '#10164A', glow: '#5A63E0', seaFar: '#1A2260', seaNear: '#0A0F33', foam: '#B8C0FF', accent: '#8F96FF', accentInk: '#8F96FF', orbCore: '#6C74F5' }),
    theta: Object.freeze({ skyTop: '#0E0820', skyMid: '#24175A', glow: '#8A5CF0', seaFar: '#2A1C66', seaNear: '#130C36', foam: '#D9C6FF', accent: '#C49DFF', accentInk: '#C49DFF', orbCore: '#9D74F5' }),
    alpha: Object.freeze({ skyTop: '#05161C', skyMid: '#0E3844', glow: '#2E8F9E', seaFar: '#0F4552', seaNear: '#072029', foam: '#BFF3EC', accent: '#5FD4C8', accentInk: '#5FD4C8', orbCore: '#3FBFB2' }),
    beta: Object.freeze({ skyTop: '#061222', skyMid: '#0E2E52', glow: '#2F7FD0', seaFar: '#10396A', seaNear: '#071B33', foam: '#C9E8FF', accent: '#6CC1FF', accentInk: '#6CC1FF', orbCore: '#4BA9F0' }),
    gamma: Object.freeze({ skyTop: '#12091F', skyMid: '#3D1F4D', glow: '#FF9F6E', seaFar: '#3A1F55', seaNear: '#170D2E', foam: '#FFE1C4', accent: '#FFC46B', accentInk: '#FFC46B', orbCore: '#F2A65A' }),
  }),
  light: Object.freeze({
    delta: Object.freeze({ skyTop: '#E9ECFF', skyMid: '#C9CFFF', glow: '#B7BEFF', seaFar: '#8C96F0', seaNear: '#6A74D8', foam: '#FFFFFF', accent: '#5B63E6', accentInk: '#3F48C9', orbCore: '#5B63E6' }),
    theta: Object.freeze({ skyTop: '#F3EBFF', skyMid: '#DCCBFF', glow: '#CDB8FF', seaFar: '#A58CF0', seaNear: '#8468D8', foam: '#FFFFFF', accent: '#8B64F0', accentInk: '#6A3FD0', orbCore: '#8B64F0' }),
    alpha: Object.freeze({ skyTop: '#E4F8F5', skyMid: '#B9ECE6', glow: '#A9E6DF', seaFar: '#5FC9BE', seaNear: '#3FA99E', foam: '#FFFFFF', accent: '#1FA193', accentInk: '#0A665E', orbCore: '#1FA193' }),
    beta: Object.freeze({ skyTop: '#E6F3FF', skyMid: '#C2DFFF', glow: '#B4DAFF', seaFar: '#6BB4F2', seaNear: '#4A93D6', foam: '#FFFFFF', accent: '#2E8AE0', accentInk: '#0B5FAE', orbCore: '#2E8AE0' }),
    gamma: Object.freeze({ skyTop: '#FFF3E6', skyMid: '#FFDDBE', glow: '#FFB07A', seaFar: '#F0A878', seaNear: '#D98A5A', foam: '#FFFFFF', accent: '#DD782D', accentInk: '#9C4710', orbCore: '#DD782D' }),
  }),
});

/** Neutral tokens per theme as CSS colour strings (§7.5). */
export const NEUTRALS = Object.freeze({
  dark: Object.freeze({
    text: '#EEF1FF',
    text2: '#B9C0DA',
    surface: 'rgb(10 14 32 / 0.82)',
    surfaceOpaque: 'rgb(10 14 32 / 0.94)',
    surface2: 'rgb(255 255 255 / 0.06)',
    border: 'rgb(255 255 255 / 0.12)',
    borderStrong: 'rgb(255 255 255 / 0.40)',
    track: 'rgb(255 255 255 / 0.40)',
    thumb: '#FFFFFF',
    focus: '#FFFFFF',
    focusInner: '#0A0E20',
    scrim: 'rgb(10 14 32 / 0.55)',
  }),
  light: Object.freeze({
    text: '#141A2E',
    text2: '#4A5068',
    surface: 'rgb(255 255 255 / 0.78)',
    surfaceOpaque: 'rgb(255 255 255 / 0.94)',
    surface2: 'rgb(20 26 46 / 0.06)',
    border: 'rgb(20 26 46 / 0.14)',
    borderStrong: 'rgb(20 26 46 / 0.52)',
    track: 'rgb(20 26 46 / 0.52)',
    thumb: '#FFFFFF',
    focus: '#141A2E',
    focusInner: '#FFFFFF',
    scrim: 'rgb(255 255 255 / 0.55)',
  }),
});

/** Palette object for a band in a theme; throws on an unknown band or theme. */
export function bandPalette(band, theme = 'dark') {
  const table = BAND_PALETTES[theme];
  if (!table) throw new RangeError(`Unknown theme: ${theme}`);
  const palette = table[band];
  if (!palette) throw new RangeError(`Unknown band: ${band}`);
  return palette;
}

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FN_RE = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[/,]\s*([\d.]+%?))?\s*\)$/i;

/** '#rgb' | '#rrggbb' | '#rrggbbaa' → { r, g, b } integers 0–255 (alpha ignored); throws on anything else. */
export function hexToRgb(hex) {
  const m = HEX_RE.exec(String(hex).trim());
  if (!m) throw new TypeError(`Not a hex colour: ${hex}`);
  let digits = m[1];
  if (digits.length === 3) digits = digits.replace(/./g, (d) => d + d);
  const n = parseInt(digits.slice(0, 6), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** { r, g, b } (0–255, any floats; clamped and rounded) → '#RRGGBB'. */
export function rgbToHex({ r, g, b }) {
  const two = (v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${two(r)}${two(g)}${two(b)}`.toUpperCase();
}

function parseAlpha(token) {
  if (token === undefined) return 1;
  const v = token.endsWith('%') ? parseFloat(token) / 100 : parseFloat(token);
  return Math.min(1, Math.max(0, v));
}

/** CSS colour ('#rgb', '#rrggbb', '#rrggbbaa', 'rgb(r g b / a)', 'rgb(r, g, b)', 'rgba(...)') → { r, g, b, a }. */
export function parseColor(cssColor) {
  const text = String(cssColor).trim();
  const hex = HEX_RE.exec(text);
  if (hex) {
    const a = hex[1].length === 8 ? parseInt(hex[1].slice(6), 16) / 255 : 1;
    return { ...hexToRgb(text), a };
  }
  const fn = RGB_FN_RE.exec(text);
  if (!fn) throw new TypeError(`Unsupported colour: ${cssColor}`);
  return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: parseAlpha(fn[4]) };
}

function toRgba(color) {
  return typeof color === 'string' ? parseColor(color) : { a: 1, ...color };
}

/** Alpha-composite fgRgba over an opaque bgRgb (strings or objects) → { r, g, b } (unrounded). */
export function blend(fgRgba, bgRgb) {
  const fg = toRgba(fgRgba);
  const bg = toRgba(bgRgb);
  const mix = (f, b) => fg.a * f + (1 - fg.a) * b;
  return { r: mix(fg.r, bg.r), g: mix(fg.g, bg.g), b: mix(fg.b, bg.b) };
}

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(c) {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.min(1, Math.max(0, v));
}

function linearChannels(color) {
  const { r, g, b } = toRgba(color);
  return [srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255)];
}

/** WCAG 2.x relative luminance (0–1) of a hex / CSS colour string or { r, g, b } object. */
export function relativeLuminance(hexOrRgb) {
  const [r, g, b] = linearChannels(hexOrRgb);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1–21) between two colours (strings or { r, g, b }); order does not matter. */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function linearToOklab([r, g, b]) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

/** Clamp to [0, 1]. */
function clamp01(t) {
  return Math.min(1, Math.max(0, t));
}

/** Perceptual mix of two hex colours in OKLab (t = 0 → hexA, t = 1 → hexB) → '#RRGGBB'. */
export function mixOklab(hexA, hexB, t) {
  const k = clamp01(t);
  const a = linearToOklab(linearChannels(hexA));
  const b = linearToOklab(linearChannels(hexB));
  const lab = a.map((v, i) => v + (b[i] - v) * k);
  const [r, g, bl] = oklabToLinear(lab).map(linearToSrgb);
  return rgbToHex({ r: r * 255, g: g * 255, b: bl * 255 });
}

/** Hermite smoothstep of t clamped to [0, 1]. */
export function smoothstep(t) {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}
