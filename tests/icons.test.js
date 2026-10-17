// tools/make-icons.mjs: rasteriser geometry and colours at 32 px, PNG encoding, and the committed docs/icons/*.png.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, inflateSync } from 'node:zlib';
import { encodePng, renderIcon } from '../tools/make-icons.mjs';

const ICON_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'icons');
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const COMMITTED = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 };
const SIZE = 32;

// Motif geometry in favicon.svg space: rings around (256, 290); the inner ring crosses (256, 220).
const MOTIF_CENTRE_Y = 290;
const INNER_RING_Y = 220;
const MASKABLE_SCALE = 0.8;

const pixel = (rgba, size, x, y) => {
  const i = (y * size + x) * 4;
  return { r: rgba[i], g: rgba[i + 1], b: rgba[i + 2], a: rgba[i + 3] };
};
/** Pixel coordinate of a favicon-space y (0..512) at the given render size, optionally through the maskable scale. */
const atY = (size, y, maskable = false) => Math.floor((size * (maskable ? 256 + (y - 256) * MASKABLE_SCALE : y)) / 512);
const near = (value, target, tolerance = 4) => Math.abs(value - target) <= tolerance;

function assertNavy(p, what) {
  assert.ok(p.a === 255 && near(p.r, 0x0b) && near(p.g, 0x1b) && near(p.b, 0x2b), `${what} should be opaque navy, got ${JSON.stringify(p)}`);
}
function assertTeal(p, what) {
  assert.ok(p.a === 255 && p.g > p.r && p.g >= 90, `${what} should be teal-ish (g > r, g >= 90), got ${JSON.stringify(p)}`);
}

/** Walks the chunks, verifies CRCs and returns the header fields plus the inflated scanlines. */
function parsePng(buffer) {
  assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), 'PNG signature');
  const chunks = [];
  for (let offset = 8; offset < buffer.length; ) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    assert.equal(buffer.readUInt32BE(offset + 8 + length), crc32(data, crc32(Buffer.from(type, 'latin1'))), `${type} CRC`);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  const [ihdr] = chunks;
  assert.equal(ihdr.type, 'IHDR');
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    chunkTypes: chunks.map((chunk) => chunk.type),
    raw: inflateSync(Buffer.concat(chunks.filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data))),
  };
}

/** Straight RGBA bytes of a filter-0 PNG (the only filter make-icons writes). */
function pixelsOf(png) {
  const stride = png.width * 4;
  assert.equal(png.raw.length, (stride + 1) * png.height, 'inflated scanline length');
  const out = new Uint8Array(stride * png.height);
  for (let y = 0; y < png.height; y += 1) {
    assert.equal(png.raw[y * (stride + 1)], 0, `scanline ${y} uses filter type 0`);
    out.set(png.raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), y * stride);
  }
  return out;
}

describe('renderIcon at 32 px', () => {
  test('returns size * size * 4 straight-alpha bytes', () => {
    assert.equal(renderIcon(SIZE).length, SIZE * SIZE * 4);
    assert.ok(renderIcon(SIZE) instanceof Uint8Array);
  });

  test('standard icon: transparent corner, navy square, teal dot at the motif centre, teal inner ring', () => {
    const rgba = renderIcon(SIZE);
    assert.equal(pixel(rgba, SIZE, 0, 0).a, 0, 'corner pixel must be transparent');
    assert.equal(pixel(rgba, SIZE, SIZE - 1, SIZE - 1).a, 0, 'opposite corner must be transparent');
    assertNavy(pixel(rgba, SIZE, SIZE / 2, 0), 'top edge midpoint');
    assertNavy(pixel(rgba, SIZE, SIZE / 2, SIZE / 2), 'image centre (between dot and inner ring)');
    assertTeal(pixel(rgba, SIZE, SIZE / 2, atY(SIZE, MOTIF_CENTRE_Y)), 'motif centre (dot)');
    assertTeal(pixel(rgba, SIZE, SIZE / 2, atY(SIZE, INNER_RING_Y)), 'inner ring');
  });

  test('maskable icon: navy corner (full bleed) with the artwork scaled to the central 80 %', () => {
    const rgba = renderIcon(SIZE, { maskable: true });
    assertNavy(pixel(rgba, SIZE, 0, 0), 'corner pixel');
    assertNavy(pixel(rgba, SIZE, SIZE / 2, SIZE / 2), 'image centre');
    assertTeal(pixel(rgba, SIZE, SIZE / 2, atY(SIZE, MOTIF_CENTRE_Y, true)), 'scaled motif centre (dot)');
    assertTeal(pixel(rgba, SIZE, SIZE / 2, atY(SIZE, INNER_RING_Y, true)), 'scaled inner ring');
  });

  test('opaque icon (apple-touch-icon): navy corners, full-size artwork', () => {
    const rgba = renderIcon(SIZE, { opaque: true });
    assertNavy(pixel(rgba, SIZE, 0, 0), 'corner pixel');
    assertTeal(pixel(rgba, SIZE, SIZE / 2, atY(SIZE, MOTIF_CENTRE_Y)), 'motif centre (dot)');
  });
});

describe('encodePng', () => {
  test('writes signature, 8-bit RGBA IHDR, filter-0 IDAT and IEND with valid CRCs, round-tripping the pixels', () => {
    const rgba = renderIcon(SIZE);
    const png = parsePng(encodePng(SIZE, SIZE, rgba));
    assert.equal(png.width, SIZE);
    assert.equal(png.height, SIZE);
    assert.equal(png.bitDepth, 8);
    assert.equal(png.colorType, 6);
    assert.equal(png.chunkTypes[0], 'IHDR');
    assert.equal(png.chunkTypes.at(-1), 'IEND');
    assert.ok(png.chunkTypes.includes('IDAT'));
    assert.deepEqual(pixelsOf(png), rgba);
  });

  test('rejects a buffer that does not match the dimensions', () => {
    assert.throws(() => encodePng(4, 4, new Uint8Array(10)), RangeError);
  });
});

describe('committed docs/icons', () => {
  for (const [file, size] of Object.entries(COMMITTED)) {
    test(`${file} exists and is a ${size}x${size} RGBA PNG`, () => {
      const path = join(ICON_DIR, file);
      assert.ok(existsSync(path), `docs/icons/${file} is missing (run: node tools/make-icons.mjs)`);
      const png = parsePng(readFileSync(path));
      assert.equal(png.width, size, `${file} width`);
      assert.equal(png.height, size, `${file} height`);
      assert.equal(png.colorType, 6, `${file} colour type`);
    });
  }

  test('icon-512.png has transparent corners; maskable and apple icons are navy to the edge', () => {
    const corner = (file) => {
      const png = parsePng(readFileSync(join(ICON_DIR, file)));
      return pixel(pixelsOf(png), png.width, 0, 0);
    };
    assert.equal(corner('icon-512.png').a, 0, 'icon-512.png corner must be transparent');
    assert.equal(corner('icon-192.png').a, 0, 'icon-192.png corner must be transparent');
    assertNavy(corner('icon-maskable-512.png'), 'icon-maskable-512.png corner');
    assertNavy(corner('apple-touch-icon.png'), 'apple-touch-icon.png corner');
  });
});
