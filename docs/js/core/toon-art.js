// Cell-shaded background cats (v2): flat base fills, one hard-edged ink shadow band, a rim light and thick ink
// outlines. Each moving part is its own group with its own clip so it can rotate without its shading sliding off.
// Pure: returns SVG strings with presentation attributes only (no style attributes; CSP style-src 'self').
import { COATS } from './cat-art.js';

/** The background poses, in the order the layer cycles through them. */
export const TOON_VARIANTS = Object.freeze(['play', 'sit', 'lie']);

const INK = '#1B1626';
const OUTLINE = 4;
const SHADE_OPACITY = 0.28;
const RIM_OPACITY = 0.24;
const BLUSH = '#FF9FB2';
const YARN = '#E86A8E';

// Shared head (sit and play): ears, face circle, inner ears, happy closed eyes (a purring cat), nose, mouth, whiskers.
const HEAD = (dx = 0) => ({
  cls: 'toon__head',
  origin: [100 + dx, 112],
  parts: [
    { tag: 'polygon', points: pts([[62, 62], [70, 16], [98, 46]], dx) },
    { tag: 'polygon', points: pts([[138, 62], [130, 16], [102, 46]], dx) },
    { tag: 'circle', cx: 100 + dx, cy: 78, r: 42 },
  ],
  deco: [
    { tag: 'polygon', points: pts([[71, 52], [75, 28], [89, 45]], dx), fill: 'ear' },
    { tag: 'polygon', points: pts([[129, 52], [125, 28], [111, 45]], dx), fill: 'ear' },
  ],
  shade: { cx: 150 + dx, cy: 104, rx: 56, ry: 52 },
  rim: { cx: 76 + dx, cy: 54, rx: 16, ry: 9 },
  face: faceAt(100 + dx, 78, 1),
});

function pts(list, dx = 0) {
  return list.map(([x, y]) => `${x + dx},${y}`).join(' ');
}

/** Closed happy eyes, nose, a small ω mouth, whiskers and blush for a head centred at (cx, cy), scaled by k. */
function faceAt(cx, cy, k) {
  const p = (x, y) => `${(cx + x * k).toFixed(1)} ${(cy + y * k).toFixed(1)}`;
  return [
    { tag: 'ellipse', cx: cx - 26 * k, cy: cy + 16 * k, rx: 7 * k, ry: 4 * k, fill: BLUSH, opacity: 0.45 },
    { tag: 'ellipse', cx: cx + 26 * k, cy: cy + 16 * k, rx: 7 * k, ry: 4 * k, fill: BLUSH, opacity: 0.45 },
    { tag: 'path', d: `M${p(-26, 2)} Q${p(-18, -8)} ${p(-10, 2)}`, stroke: INK, 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round' },
    { tag: 'path', d: `M${p(10, 2)} Q${p(18, -8)} ${p(26, 2)}`, stroke: INK, 'stroke-width': 3.5, fill: 'none', 'stroke-linecap': 'round' },
    { tag: 'path', d: `M${p(-5, 12)} L${p(5, 12)} L${p(0, 17)} Z`, fill: 'nose', stroke: INK, 'stroke-width': 2, 'stroke-linejoin': 'round' },
    { tag: 'path', d: `M${p(0, 17)} Q${p(-5, 24)} ${p(-10, 21)} M${p(0, 17)} Q${p(5, 24)} ${p(10, 21)}`, stroke: INK, 'stroke-width': 2.5, fill: 'none', 'stroke-linecap': 'round' },
    { tag: 'path', d: `M${p(-20, 14)} L${p(-44, 10)} M${p(-20, 18)} L${p(-44, 22)} M${p(20, 14)} L${p(44, 10)} M${p(20, 18)} L${p(44, 22)}`, stroke: INK, 'stroke-width': 1.8, fill: 'none', 'stroke-linecap': 'round', opacity: 0.7 },
  ];
}

/** Stripes or patches on a part, per coat: tabby and grey get stripes, calico gets two patches, black nothing. */
function coatDeco(coat, stripes, patches) {
  if (coat === 'calico') return patches;
  if (coat === 'orangeTabby' || coat === 'grey') return stripes;
  return [];
}

const stripe = (d) => ({ tag: 'path', d, stroke: 'markings', 'stroke-width': 6, fill: 'none', 'stroke-linecap': 'round' });

function sitGroups(coat, dx = 0, { batting = false } = {}) {
  const groups = [
    {
      cls: 'toon__tail',
      origin: [132 + dx, 176],
      parts: [{ tag: 'path', d: shift('M128 186 C176 192 198 152 184 118 C178 104 162 108 167 122 C178 150 162 170 128 170 Z', dx) }],
      deco: coatDeco(coat, [stripe(shift('M176 132 l12 4 M180 150 l13 1', dx))], [{ tag: 'ellipse', cx: 182 + dx, cy: 140, rx: 10, ry: 14, fill: 'patch' }]),
      shade: { cx: 196 + dx, cy: 172, rx: 30, ry: 62 },
    },
    {
      cls: 'toon__body',
      origin: [100 + dx, 212],
      parts: [
        { tag: 'ellipse', cx: 100 + dx, cy: 150, rx: 54, ry: 58 },
        { tag: 'ellipse', cx: 120 + dx, cy: 204, rx: 16, ry: 10 },
        ...(batting ? [] : [{ tag: 'ellipse', cx: 80 + dx, cy: 204, rx: 16, ry: 10 }]),
      ],
      deco: coatDeco(
        coat,
        [stripe(shift('M58 136 q12 6 22 0 M56 158 q12 6 22 0 M122 136 q12 6 22 0 M124 158 q12 6 22 0', dx))],
        [{ tag: 'ellipse', cx: 76 + dx, cy: 132, rx: 22, ry: 18, fill: 'markings' }, { tag: 'ellipse', cx: 128 + dx, cy: 170, rx: 18, ry: 22, fill: 'patch' }],
      ),
      shade: { cx: 156 + dx, cy: 182, rx: 62, ry: 78 },
      rim: { cx: 72 + dx, cy: 112, rx: 14, ry: 22 },
    },
  ];
  if (batting) {
    groups.push({
      cls: 'toon__bat',
      origin: [86 + dx, 160],
      parts: [{ tag: 'ellipse', cx: 64 + dx, cy: 156, rx: 16, ry: 10 }],
      deco: [],
      shade: { cx: 70 + dx, cy: 170, rx: 18, ry: 8 },
    });
  }
  groups.push({
    ...HEAD(dx),
    deco: [...HEAD(dx).deco, ...coatDeco(coat, [stripe(shift('M90 44 l2 12 M100 40 l0 14 M110 44 l-2 12', dx))], [{ tag: 'ellipse', cx: 120 + dx, cy: 62, rx: 16, ry: 14, fill: 'patch' }])],
  });
  return groups;
}

function shift(d, dx) {
  if (!dx) return d;
  let index = 0;
  // Absolute commands only shift x; relative ones (lower case) are left alone. The paths above use absolute x/y pairs
  // after M/C/L/Q and relative pairs after l/q, so every even number following an upper-case command is an x.
  return d.replace(/([MCLQZmclqz])([^MCLQZmclqz]*)/g, (_, cmd, args) => {
    if (cmd !== cmd.toUpperCase() || cmd === 'Z') return cmd + args;
    index = 0;
    return cmd + args.replace(/-?\d+(\.\d+)?/g, (n) => (index++ % 2 === 0 ? String(Number(n) + dx) : n));
  });
}

const VARIANTS = {
  sit: (coat) => ({ viewBox: '0 0 210 222', groups: sitGroups(coat) }),
  play: (coat) => ({
    viewBox: '0 0 250 222',
    groups: [
      {
        cls: 'toon__yarn',
        origin: [30, 196],
        parts: [{ tag: 'circle', cx: 30, cy: 196, r: 18 }],
        deco: [{ tag: 'path', d: 'M16 188 Q30 200 44 186 M14 200 Q30 210 46 198 M24 180 Q34 196 26 212', stroke: INK, 'stroke-width': 1.8, fill: 'none', opacity: 0.5 }],
        shade: { cx: 44, cy: 210, rx: 18, ry: 14 },
        rim: { cx: 22, cy: 188, rx: 6, ry: 4 },
        fill: YARN,
      },
      ...sitGroups(coat, 40, { batting: true }),
    ],
  }),
  lie: (coat) => ({
    viewBox: '0 0 286 160',
    groups: [
      {
        cls: 'toon__tail',
        origin: [228, 112],
        parts: [{ tag: 'path', d: 'M226 120 C262 122 280 96 268 72 C262 62 248 68 253 80 C260 96 250 106 226 104 Z' }],
        deco: coatDeco(coat, [stripe('M258 80 l10 2 M262 96 l9 -2')], [{ tag: 'ellipse', cx: 262, cy: 86, rx: 8, ry: 12, fill: 'patch' }]),
        shade: { cx: 276, cy: 110, rx: 22, ry: 44 },
      },
      {
        cls: 'toon__body',
        origin: [150, 148],
        parts: [
          { tag: 'ellipse', cx: 150, cy: 116, rx: 88, ry: 34 },
          { tag: 'ellipse', cx: 206, cy: 144, rx: 18, ry: 8 },
        ],
        deco: coatDeco(
          coat,
          [stripe('M120 88 q4 12 0 22 M146 84 q4 12 0 24 M172 86 q4 12 0 22')],
          [{ tag: 'ellipse', cx: 128, cy: 104, rx: 26, ry: 16, fill: 'markings' }, { tag: 'ellipse', cx: 190, cy: 118, rx: 20, ry: 14, fill: 'patch' }],
        ),
        shade: { cx: 176, cy: 160, rx: 112, ry: 36 },
        rim: { cx: 112, cy: 88, rx: 26, ry: 6 },
      },
      {
        cls: 'toon__paw',
        origin: [74, 138],
        parts: [{ tag: 'ellipse', cx: 52, cy: 144, rx: 20, ry: 9 }],
        deco: [],
        shade: { cx: 60, cy: 154, rx: 22, ry: 6 },
      },
      {
        cls: 'toon__head',
        origin: [70, 118],
        parts: [
          { tag: 'polygon', points: '36,66 42,30 62,56' },
          { tag: 'polygon', points: '96,64 94,28 74,54' },
          { tag: 'circle', cx: 66, cy: 86, r: 34 },
        ],
        deco: [
          { tag: 'polygon', points: '43,57 46,38 57,53', fill: 'ear' },
          { tag: 'polygon', points: '89,56 88,37 78,52', fill: 'ear' },
          ...coatDeco(coat, [stripe('M58 58 l2 10 M68 56 l0 11 M78 58 l-2 10')], [{ tag: 'ellipse', cx: 82, cy: 70, rx: 13, ry: 11, fill: 'patch' }]),
        ],
        shade: { cx: 106, cy: 108, rx: 46, ry: 42 },
        rim: { cx: 48, cy: 66, rx: 12, ry: 7 },
        face: faceAt(66, 86, 0.8),
      },
    ],
  }),
};

/** Resolves a named colour slot ('coat', 'ear', 'nose', 'markings', 'patch') against a coat; anything else passes through. */
function paint(value, colours) {
  return Object.hasOwn(colours, value) ? colours[value] : value;
}

function attrs(part, colours, skip = []) {
  return Object.entries(part)
    .filter(([key]) => key !== 'tag' && !skip.includes(key))
    .map(([key, value]) => `${key}="${typeof value === 'number' ? +value.toFixed(2) : paint(value, colours)}"`)
    .join(' ');
}

function geometry(part) {
  const { tag, fill, stroke, opacity, ...rest } = part; // drop paint so fills, clips and outlines each set their own
  return rest;
}

/**
 * One part group, drawn the cel way: a thick ink underlay of the silhouette (only its outer half shows, so parts of
 * one group merge without inner lines), flat fills, then coat details, a hard shadow band and a rim light clipped to
 * the silhouette, and the face on top.
 */
function renderGroup(group, colours, id) {
  const clipId = `${id}-${group.cls.replace('toon__', '')}`;
  const base = group.fill ?? colours.coat;
  const each = (extra) => group.parts.map((part) => `<${part.tag} ${attrs(geometry(part), colours)}${extra}/>`).join('');
  const deco = (group.deco ?? []).map((part) => `<${part.tag} ${attrs(part, colours)}/>`).join('');
  const shade = `<ellipse ${attrs(group.shade, colours)} fill="${INK}" fill-opacity="${SHADE_OPACITY}"/>`;
  const rim = group.rim ? `<ellipse ${attrs(group.rim, colours)} fill="#FFFFFF" fill-opacity="${RIM_OPACITY}"/>` : '';
  const face = (group.face ?? []).map((part) => `<${part.tag} ${attrs(part, colours)}/>`).join('');
  const [ox, oy] = group.origin;
  return (
    `<g class="toon__part ${group.cls}" data-origin="${ox} ${oy}">` +
    `<clipPath id="${clipId}">${each('')}</clipPath>` +
    each(` fill="${INK}" stroke="${INK}" stroke-width="${OUTLINE * 2}" stroke-linejoin="round"`) +
    each(` fill="${base}"`) +
    `<g clip-path="url(#${clipId})">${deco}${shade}${rim}</g>` +
    face +
    '</g>'
  );
}

/** A cell-shaded cat as an SVG string; `id` must be unique in the document (it prefixes the clip paths). */
export function toonCatSvg({ variant, coat, id = 'toon' }) {
  const build = VARIANTS[variant];
  if (!build) throw new RangeError(`Unknown toon variant: ${variant}`);
  const c = COATS[coat];
  if (!c) throw new RangeError(`Unknown coat: ${coat}`);
  const colours = { coat: c.coat, ear: c.ear, nose: c.nose, markings: c.markings ?? c.coat, patch: c.patch ?? c.markings ?? c.coat };
  const { viewBox, groups } = build(coat);
  // Draw order: groups listed first sit behind (tail and yarn first, head last).
  return (
    `<svg class="toon__svg toon__svg--${variant}" viewBox="${viewBox}" width="100%" height="100%" aria-hidden="true" focusable="false">` +
    groups.map((group) => renderGroup(group, colours, id)).join('') +
    '</svg>'
  );
}

/** Aspect ratio (width / height) of a variant's view box, so the layer can size each cat without distortion. */
export function toonAspect(variant) {
  const build = VARIANTS[variant];
  if (!build) throw new RangeError(`Unknown toon variant: ${variant}`);
  const [, , w, h] = build('black').viewBox.split(' ').map(Number);
  return w / h;
}
