#!/usr/bin/env node
// Brain Tune icon rasteriser: renders the favicon.svg ring motif to PNG with nothing but node:zlib.
// Usage: node tools/make-icons.mjs   (writes docs/icons/*.png; the PNGs are committed)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

// Geometry in the 512 x 512 space of docs/favicon.svg.
const ART_SIZE = 512;
const CORNER_RADIUS = 112; // about 22 % of the side
const RING_CENTRE = { x: 256, y: 290 }; // a little below the middle: a ripple
const DOT_RADIUS = 12;
const MASKABLE_SCALE = 0.8; // the artwork fits the central 80 % circle of a maskable icon
const SUPERSAMPLE = 4; // 4 x 4 subsamples per pixel

const NAVY = [0x0b, 0x1b, 0x2b];
const TEAL = [0x5f, 0xd4, 0xc8];
const LILAC = [0xc4, 0x9d, 0xff];

/** Rings from the outside in: radius, stroke width, colour and opacity, exactly as in favicon.svg. */
const RINGS = [
  { r: 170, width: 9, rgb: TEAL, alpha: 0.5 },
  { r: 120, width: 11, rgb: LILAC, alpha: 0.75 },
  { r: 70, width: 14, rgb: TEAL, alpha: 0.95 },
];

/** The committed files; apple-touch-icon has no transparency because iOS fills corners with black. */
const ICONS = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, opaque: true },
];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Renders the icon motif as straight-alpha RGBA bytes (size * size * 4) with 4 x 4 supersampling.
 * Default: rounded navy square with transparent corners. maskable: full-bleed navy, artwork scaled to 80 %.
 * opaque: full-bleed navy behind the full-size artwork (apple-touch-icon); implied by maskable.
 */
export function renderIcon(size, { maskable = false, opaque = maskable } = {}) {
  const out = new Uint8Array(size * size * 4);
  const scale = ART_SIZE / size;
  const options = { maskable, opaque };
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      const sum = [0, 0, 0, 0];
      for (let j = 0; j < SUPERSAMPLE; j += 1) {
        for (let i = 0; i < SUPERSAMPLE; i += 1) {
          const x = (px + (i + 0.5) / SUPERSAMPLE) * scale;
          const y = (py + (j + 0.5) / SUPERSAMPLE) * scale;
          accumulate(sum, shade(x, y, options));
        }
      }
      writePixel(out, (py * size + px) * 4, sum, SUPERSAMPLE * SUPERSAMPLE);
    }
  }
  return out;
}

/** Encodes straight-alpha RGBA bytes as an 8-bit RGBA PNG: IHDR, one IDAT of filter-0 scanlines, IEND. */
export function encodePng(width, height, rgba) {
  const expected = width * height * 4;
  if (rgba.length !== expected) throw new RangeError(`encodePng: expected ${expected} bytes, got ${rgba.length}`);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr(width, height)),
    pngChunk('IDAT', deflateSync(scanlines(width, height, rgba), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Straight-alpha colour of one subsample in 512-space: [rgb, alpha]. */
function shade(x, y, { maskable, opaque }) {
  const background = opaque || insideRoundedSquare(x, y) ? 1 : 0;
  const art = maskable ? artAt(toArtSpace(x), toArtSpace(y)) : artAt(x, y);
  return art ? over(NAVY, background, art.rgb, art.alpha) : [NAVY, background];
}

function insideRoundedSquare(x, y) {
  const dx = Math.max(CORNER_RADIUS - x, 0, x - (ART_SIZE - CORNER_RADIUS));
  const dy = Math.max(CORNER_RADIUS - y, 0, y - (ART_SIZE - CORNER_RADIUS));
  return dx * dx + dy * dy <= CORNER_RADIUS * CORNER_RADIUS;
}

/** Maps a maskable-icon coordinate back into artwork space (artwork shrunk about the icon centre). */
function toArtSpace(v) {
  return ART_SIZE / 2 + (v - ART_SIZE / 2) / MASKABLE_SCALE;
}

/** The dot or ring under a point, or null. */
function artAt(x, y) {
  const d = Math.hypot(x - RING_CENTRE.x, y - RING_CENTRE.y);
  if (d <= DOT_RADIUS) return { rgb: TEAL, alpha: 1 };
  const ring = RINGS.find((candidate) => Math.abs(d - candidate.r) <= candidate.width / 2);
  return ring ? { rgb: ring.rgb, alpha: ring.alpha } : null;
}

/** Composites src over dst, both with straight alpha. */
function over(dstRgb, dstA, srcRgb, srcA) {
  const outA = srcA + dstA * (1 - srcA);
  const rgb = dstRgb.map((c, i) => (srcRgb[i] * srcA + c * dstA * (1 - srcA)) / outA);
  return [rgb, outA];
}

function accumulate(sum, [rgb, alpha]) {
  sum[0] += rgb[0] * alpha;
  sum[1] += rgb[1] * alpha;
  sum[2] += rgb[2] * alpha;
  sum[3] += alpha;
}

/** Averages premultiplied sums back to straight-alpha bytes. */
function writePixel(out, offset, sum, samples) {
  out[offset + 3] = Math.round((sum[3] / samples) * 255);
  for (let c = 0; c < 3; c += 1) out[offset + c] = sum[3] === 0 ? 0 : Math.round(sum[c] / sum[3]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13); // compression, filter and interlace bytes stay 0
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8; // bit depth
  data[9] = 6; // colour type: RGBA
  return data;
}

function scanlines(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height); // byte 0 of every row is filter type 0
  for (let y = 0; y < height; y += 1) raw.set(rgba.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return raw;
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(data, crc32(typeBytes)), 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

/** Writes the four committed PNGs into docs/icons/. */
function main() {
  const dir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'icons');
  mkdirSync(dir, { recursive: true });
  for (const { file, size, ...options } of ICONS) {
    const png = encodePng(size, size, renderIcon(size, options));
    const target = join(dir, file);
    writeFileSync(target, png);
    process.stdout.write(`${relative(process.cwd(), target)}  ${size}x${size}  ${png.length} bytes\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
