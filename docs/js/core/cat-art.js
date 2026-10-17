// Inline SVG cats (§7.8): four poses × four coats. Presentation attributes only (CSP: no style=""). Pure.

/** Pose names in display order. */
export const POSES = Object.freeze(['sit', 'loaf', 'walk', 'sleep']);

/** Coat colour sets; `markings` is optional and calico adds a dark `patch`. */
export const COATS = Object.freeze({
  black: Object.freeze({ coat: '#23202B', ear: '#3A2F3A', eye: '#E8C547', nose: '#3A3340' }),
  orangeTabby: Object.freeze({ coat: '#E0893B', ear: '#F0B7A2', eye: '#7BB661', nose: '#E59AA0', markings: '#B5632A' }),
  grey: Object.freeze({ coat: '#8B8E99', ear: '#D9A5A8', eye: '#D6B24C', nose: '#D98B92', markings: '#6E7280' }),
  calico: Object.freeze({ coat: '#F3EEE6', ear: '#EFB6B2', eye: '#C9A34A', nose: '#E59AA0', markings: '#E0893B', patch: '#2B2630' }),
});

const SVG_NS = 'http://www.w3.org/2000/svg';
const PUPIL = '#1A1A1E';
const HIGHLIGHT = '#FFFFFF';
const COAT = 'var(--coat)';
const EAR = 'var(--ear)';
const EYE = 'var(--eye)';
const NOSE = 'var(--nose)';
const MARKINGS = 'var(--markings)';
const FLIP_TRANSFORM = 'translate(120 0) scale(-1 1)';

// Per-pose geometry in the 120×100 viewBox. Paws/patches are [cx, cy, rx, ry]; rings are short segments across the tail.
const POSE_GEOMETRY = {
  sit: {
    head: { cx: 60, cy: 30, r: 18 },
    body: { tag: 'ellipse', cx: 60, cy: 62, rx: 26, ry: 34 },
    paws: [[48, 96, 9, 4], [72, 96, 9, 4]],
    tail: { d: 'M84 82C96 86 94 94 72 94Q56 94 46 89', width: 8, behind: false },
    stripes: { xs: [50, 60, 70], y: 52 },
    rings: ['M87.3 88.1L93.3 82.9', 'M56.7 96.7L58.3 88.8'],
    patches: [[50, 56, 10, 12], [72, 80, 9, 9]],
  },
  loaf: {
    head: { cx: 40, cy: 44, r: 17 },
    body: { tag: 'rect', x: 24, y: 46, width: 72, height: 40, rx: 20 },
    paws: [[34, 86, 7, 3.5], [52, 86, 7, 3.5]],
    tail: { d: 'M94 70Q106 80 92 88Q80 92 64 88', width: 8, behind: false },
    stripes: { xs: [66, 76, 86], y: 52 },
    rings: ['M95.5 79.1L103.5 79.9', 'M79 86L79 94'],
    patches: [[70, 56, 12, 8], [50, 76, 10, 7]],
  },
  walk: {
    head: { cx: 96, cy: 44, r: 15 },
    body: { tag: 'rect', x: 32, y: 43, width: 60, height: 30, rx: 15 },
    legs: { y: 66, width: 8, height: 22, xs: { br: 46, fr: 82, bl: 36, fl: 72 } },
    tail: { d: 'M34 50Q16 44 20 24', width: 7, behind: true },
    stripes: { xs: [50, 60, 70], y: 47 },
    rings: ['M18.4 42.1L24.6 38.9', 'M15.8 31.5L22.8 31.3'],
    patches: [[56, 52, 10, 6], [76, 64, 8, 6]],
  },
  sleep: {
    head: { cx: 84, cy: 56, r: 16 },
    body: { tag: 'path', d: 'M26 78A30 30 0 1 1 86 78Q56 92 26 78Z' },
    paws: [[64, 86, 8, 4]],
    tail: { d: 'M30 84Q54 98 76 90Q94 86 92 68', width: 8, behind: false },
    stripes: { xs: [44, 54, 64], y: 56 },
    rings: ['M54 88.5L53 96.5', 'M84.4 81.7L90 87.5'],
    patches: [[46, 62, 11, 8], [40, 76, 9, 6]],
    eyesClosed: true,
  },
};

const fmt = (v) => String(Math.round(v * 100) / 100);
const seg = (...parts) => parts.map((p) => (typeof p === 'number' ? fmt(p) : p)).join(' ');

function el(tag, attributes, children = '') {
  const attrs = Object.entries(attributes)
    .map(([k, v]) => ` ${k}="${typeof v === 'number' ? fmt(v) : v}"`)
    .join('');
  return `<${tag}${attrs}>${children}</${tag}>`;
}

const STROKE_ROUND = { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };

function ellipse(cls, [cx, cy, rx, ry], fill) {
  return el('ellipse', { class: cls, cx, cy, rx, ry, fill });
}

function body(geo) {
  const { tag, ...shape } = geo.body;
  return el(tag, { class: 'cat__body', ...shape, fill: COAT });
}

function legs(geo) {
  if (!geo.legs) return el('g', { class: 'cat__legs' }, geo.paws.map((p) => ellipse('cat__paw', p, COAT)).join(''));
  const { y, width, height, xs } = geo.legs;
  const far = new Set(['br', 'fr']);
  const rects = ['br', 'fr', 'bl', 'fl'].map((k) =>
    el('rect', { class: `cat__leg cat__leg--${k}`, x: xs[k], y, width, height, rx: 3, fill: COAT, ...(far.has(k) ? { opacity: 0.85 } : {}) }),
  );
  return el('g', { class: 'cat__legs' }, rects.join(''));
}

function tail(geo, coatName) {
  const stroke = el('path', { d: geo.tail.d, stroke: COAT, 'stroke-width': geo.tail.width, ...STROKE_ROUND });
  const rings = coatName === 'orangeTabby'
    ? el('path', { class: 'cat__tail-rings', d: geo.rings.join(''), fill: 'none', stroke: MARKINGS, 'stroke-width': 3 })
    : '';
  return el('g', { class: 'cat__tail' }, stroke + rings);
}

function ear(side, { cx, cy, r }) {
  const s = side === 'l' ? -1 : 1;
  const px = (k) => cx + s * k * r;
  const py = (k) => cy - k * r;
  const outer = seg('M', px(0.78), py(0.55), 'L', px(0.9), py(1.35), 'L', px(0.2), py(0.9), 'Z');
  const inner = seg('M', px(0.68), py(0.62), 'L', px(0.78), py(1.15), 'L', px(0.32), py(0.86), 'Z');
  return el('g', { class: `cat__ear cat__ear--${side}` }, el('path', { d: outer, fill: COAT }) + el('path', { d: inner, fill: EAR }));
}

function openEye(side, { cx, cy, r }) {
  const ex = cx + (side === 'l' ? -0.38 : 0.38) * r;
  const ey = cy - 0.1 * r;
  return el('g', { class: `cat__eye cat__eye--${side}` },
    ellipse('cat__sclera', [ex, ey, 0.22 * r, 0.26 * r], EYE)
    + ellipse('cat__pupil', [ex, ey, 0.08 * r, 0.2 * r], PUPIL)
    + el('circle', { class: 'cat__glint', cx: ex - 0.07 * r, cy: ey - 0.1 * r, r: 0.06 * r, fill: HIGHLIGHT }));
}

function closedEye(side, { cx, cy, r }) {
  const ex = cx + (side === 'l' ? -0.38 : 0.38) * r;
  const ey = cy - 0.05 * r;
  const d = seg('M', ex - 0.22 * r, ey, 'q', 0.22 * r, 0.18 * r, 0.44 * r, 0);
  return el('path', { class: `cat__eye cat__eye--${side} cat__eye--closed`, d, stroke: PUPIL, 'stroke-width': 1.5, ...STROKE_ROUND });
}

function nose({ cx, cy, r }) {
  const d = seg('M', cx - 0.12 * r, cy + 0.22 * r, 'L', cx + 0.12 * r, cy + 0.22 * r, 'L', cx, cy + 0.36 * r, 'Z');
  return el('path', { class: 'cat__nose', d, fill: NOSE });
}

function mouth({ cx, cy, r }) {
  const yEnd = cy + 0.44 * r;
  const yDip = cy + 0.56 * r;
  const d = seg('M', cx - 0.2 * r, yEnd, 'Q', cx - 0.1 * r, yDip, cx, cy + 0.4 * r, 'Q', cx + 0.1 * r, yDip, cx + 0.2 * r, yEnd);
  return el('path', { class: 'cat__mouth', d, stroke: NOSE, 'stroke-width': 1.2, ...STROKE_ROUND });
}

function whiskers({ cx, cy, r }) {
  const lines = [];
  for (const s of [-1, 1]) {
    for (const [kx, ky] of [[1.45, 0.02], [1.5, 0.3], [1.45, 0.58]]) {
      lines.push(el('line', { x1: cx + s * 0.35 * r, y1: cy + 0.32 * r, x2: cx + s * kx * r, y2: cy + ky * r }));
    }
  }
  return el('g', { class: 'cat__whiskers', stroke: 'currentColor', 'stroke-width': 1, 'stroke-linecap': 'round', opacity: 0.45 }, lines.join(''));
}

function foreheadM({ cx, cy, r }) {
  const d = seg('M', cx - 0.3 * r, cy - 0.7 * r, 'l', 0.1 * r, 0.3 * r, 'M', cx, cy - 0.75 * r, 'l', 0, 0.3 * r, 'M', cx + 0.3 * r, cy - 0.7 * r, 'l', -0.1 * r, 0.3 * r);
  return el('path', { d, stroke: MARKINGS, 'stroke-width': 1.8, ...STROKE_ROUND });
}

function flankStripes({ xs, y }) {
  const d = xs.map((x) => seg('M', x, y, 'q', 1.5, 6, 0, 12)).join('');
  return el('path', { d, stroke: MARKINGS, 'stroke-width': 3, ...STROKE_ROUND });
}

function headPatch({ cx, cy, r }, fill) {
  return ellipse('cat__patch', [cx + 0.4 * r, cy - 0.45 * r, 0.34 * r, 0.3 * r], fill);
}

/** Markings split into body and head parts so the head group can tilt as one. */
function markingsFor(geo, coatName) {
  const dark = COATS.calico.patch;
  const [lightPatch, darkPatch] = geo.patches;
  const byCoat = {
    black: { body: '', head: '' },
    orangeTabby: { body: flankStripes(geo.stripes), head: foreheadM(geo.head) },
    grey: { body: flankStripes(geo.stripes), head: '' },
    calico: { body: ellipse('cat__patch', lightPatch, MARKINGS) + ellipse('cat__patch', darkPatch, dark), head: headPatch(geo.head, dark) },
  };
  return byCoat[coatName];
}

function head(geo, headMarkings) {
  const h = geo.head;
  const eyes = geo.eyesClosed ? closedEye('l', h) + closedEye('r', h) : openEye('l', h) + openEye('r', h);
  const face = el('circle', { class: 'cat__face', cx: h.cx, cy: h.cy, r: h.r, fill: COAT });
  const extra = headMarkings ? el('g', { class: 'cat__markings cat__markings--head' }, headMarkings) : '';
  return el('g', { class: 'cat__head' }, ear('l', h) + ear('r', h) + face + extra + eyes + nose(h) + mouth(h) + whiskers(h));
}

/** SVG markup for one cat; colours come from --coat/--ear/--eye/--nose/--markings on the host element. */
export function catSvg({ pose, coat, flip = false }) {
  const geo = POSE_GEOMETRY[pose];
  if (!geo) throw new RangeError(`Unknown pose: ${pose}`);
  if (!COATS[coat]) throw new RangeError(`Unknown coat: ${coat}`);
  const marks = markingsFor(geo, coat);
  const tailPart = tail(geo, coat);
  const torso = geo.legs ? legs(geo) + body(geo) : body(geo) + legs(geo);
  const parts = [
    geo.tail.behind ? tailPart : '',
    torso,
    el('g', { class: 'cat__markings' }, marks.body),
    head(geo, marks.head),
    geo.tail.behind ? '' : tailPart,
  ].join('');
  const root = el('g', { class: 'cat__root', ...(flip ? { transform: FLIP_TRANSFORM } : {}) }, parts);
  return el('svg', {
    xmlns: SVG_NS,
    viewBox: '0 0 120 100',
    width: '100%',
    height: '100%',
    'aria-hidden': 'true',
    focusable: 'false',
    class: `cat__svg cat__svg--${pose}`,
  }, root);
}

/** CSS custom properties for a coat → { '--coat', '--ear', '--eye', '--nose', '--markings' } (markings default to the coat). */
export function coatVars(coatName) {
  const c = COATS[coatName];
  if (!c) throw new RangeError(`Unknown coat: ${coatName}`);
  return { '--coat': c.coat, '--ear': c.ear, '--eye': c.eye, '--nose': c.nose, '--markings': c.markings ?? c.coat };
}

const COAT_PHRASES = { black: 'black', orangeTabby: 'orange tabby', grey: 'grey', calico: 'calico' };
const POSE_PHRASES = { sit: 'sitting nearby', loaf: 'loafing nearby', walk: 'walking by', sleep: 'asleep nearby' };

/** Accessible label, e.g. 'A calico cat sitting nearby' or 'An orange tabby cat walking by'. */
export function catLabel(pose, coat) {
  const coatPhrase = COAT_PHRASES[coat];
  const posePhrase = POSE_PHRASES[pose];
  if (!coatPhrase || !posePhrase) throw new RangeError(`Unknown cat: ${pose} / ${coat}`);
  const article = /^[aeiou]/.test(coatPhrase) ? 'An' : 'A';
  return `${article} ${coatPhrase} cat ${posePhrase}`;
}
