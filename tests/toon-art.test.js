// docs/js/core/toon-art.js: the cell-shaded background cats are well-formed, CSP-safe SVG with cel-shading passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOON_VARIANTS, toonCatSvg, toonAspect } from '../docs/js/core/toon-art.js';
import { COATS } from '../docs/js/core/cat-art.js';

const count = (s, re) => (s.match(re) ?? []).length;
const INK = '#1B1626';

/** { 'toon__head': '<part markup>…', … } for one SVG (part groups are siblings, so each chunk runs to the next one). */
function partsOf(svg) {
  return Object.fromEntries(svg.split('<g class="toon__part ').slice(1).map((chunk) => [chunk.slice(0, chunk.indexOf('"')), chunk]));
}

/** [cx, cy, rx, ry] of the ink ellipse drawn at the given fill-opacity. */
function inkEllipse(part, opacity) {
  const m = new RegExp(`<ellipse cx="([\\d.]+)" cy="([\\d.]+)" rx="([\\d.]+)" ry="([\\d.]+)" fill="${INK}" fill-opacity="${opacity}"/>`).exec(part);
  return m ? m.slice(1).map(Number) : null;
}

test('every variant × coat is balanced SVG with a view box, no style attributes, no NaN', () => {
  for (const variant of TOON_VARIANTS) {
    for (const coat of Object.keys(COATS)) {
      const svg = toonCatSvg({ variant, coat, id: 'x' });
      assert.match(svg, /^<svg [^>]*viewBox="0 0 \d+ \d+"/, `${variant}/${coat} view box`);
      assert.equal(count(svg, /<g[ >]/g), count(svg, /<\/g>/g), `${variant}/${coat} balanced groups`);
      assert.equal(count(svg, /<clipPath /g), count(svg, /<\/clipPath>/g));
      assert.doesNotMatch(svg, /style=|NaN|undefined/, `${variant}/${coat} clean`);
      assert.match(svg, /aria-hidden="true"/);
    }
  }
});

test('cel shading: each part has an ink underlay, a flat fill and a clipped shadow band; the head purrs with closed eyes', () => {
  const svg = toonCatSvg({ variant: 'sit', coat: 'orangeTabby', id: 'c' });
  const parts = count(svg, /class="toon__part /g);
  assert.ok(parts >= 3, 'tail, body and head are separate groups');
  assert.ok(svg.includes(`fill="${COATS.orangeTabby.coat}"`), 'flat coat fill');
  assert.ok(svg.includes(`stroke="${COATS.orangeTabby.markings}"`), 'tabby stripes');
  assert.match(svg, /class="toon__part toon__head" data-origin="\d+ \d+"/, 'head pivot for the tilt');
  assert.doesNotMatch(svg, /<circle [^>]*fill="#1A1A1E"/, 'no open pupils: a purring cat squints');
});

test('v0.4 shading: per part one 0.20 band and one 0.12 core at 0.7× its radii, a 0.30 foam rim, a 7 px ink underlay', () => {
  for (const variant of TOON_VARIANTS) {
    for (const coat of Object.keys(COATS)) {
      const svg = toonCatSvg({ variant, coat, id: 'c' });
      for (const [cls, part] of Object.entries(partsOf(svg))) {
        const where = `${variant}/${coat}/${cls}`;
        assert.equal(count(part, /fill-opacity="0.2"/g), 1, `${where}: one shadow band at 0.20`);
        assert.equal(count(part, /fill-opacity="0.12"/g), 1, `${where}: one core shadow at 0.12`);
        const [cx, cy, rx, ry] = inkEllipse(part, '0.2');
        const core = inkEllipse(part, '0.12');
        assert.deepEqual(core, [cx, cy, Math.round(rx * 70) / 100, Math.round(ry * 70) / 100], `${where}: concentric core at 0.7×`);
        assert.ok(part.indexOf('fill-opacity="0.2"') > part.indexOf('clip-path="url('), `${where}: shading is clipped to the silhouette`);
        const rims = count(part, /fill-opacity="0.3"/g);
        assert.ok(rims <= 1, where);
        assert.equal(count(part, /fill="var\(--foam, #FFFFFF\)" fill-opacity="0.3"\/>/g), rims, `${where}: the rim takes the foam colour`);
        const widths = [...part.matchAll(new RegExp(`fill="${INK}" stroke="${INK}" stroke-width="([\\d.]+)"`, 'g'))].map((m) => m[1]);
        assert.ok(widths.length >= 1 && widths.every((w) => w === '7'), `${where}: ink underlay 7 (outline 3.5 each side), got ${widths}`);
      }
      assert.ok(!svg.includes('fill="#FFFFFF"'), `${variant}/${coat}: no untinted rim left`);
    }
  }
  const sit = partsOf(toonCatSvg({ variant: 'sit', coat: 'grey', id: 'c' }));
  assert.ok(sit.toon__body.includes('fill="var(--foam, #FFFFFF)" fill-opacity="0.3"'), 'the body catches the rim light');
  assert.ok(sit.toon__head.includes('<ellipse cx="150" cy="104" rx="39.2" ry="36.4" fill="#1B1626" fill-opacity="0.12"/>'), 'head core');
});

test('tuxedo toons wear a white chest on the body and a muzzle on the head, under the shading', () => {
  const white = COATS.tuxedo.markings;
  for (const variant of TOON_VARIANTS) {
    const svg = toonCatSvg({ variant, coat: 'tuxedo', id: 't' });
    const parts = partsOf(svg);
    for (const cls of ['toon__body', 'toon__head']) {
      assert.equal(count(parts[cls], new RegExp(`<ellipse [^>]*fill="${white}"/>`, 'g')), 1, `${variant}: ${cls} white`);
      assert.ok(parts[cls].indexOf(white) < parts[cls].indexOf('fill-opacity="0.2"'), `${variant}: ${cls} white is shaded like the coat`);
    }
    assert.equal(count(svg, new RegExp(white, 'g')), 2, `${variant}: no other whites`);
    assert.ok(svg.includes(`fill="${COATS.tuxedo.coat}"`), `${variant}: dark coat`);
  }
  const sitHead = partsOf(toonCatSvg({ variant: 'sit', coat: 'tuxedo', id: 't' })).toon__head;
  assert.ok(sitHead.includes(`<ellipse cx="100" cy="89.76" rx="16.8" ry="10.92" fill="${white}"/>`), 'muzzle (cx, cy + 0.28r, 0.40r, 0.26r) of the r 42 head');
  for (const coat of ['black', 'orangeTabby', 'grey', 'calico']) {
    for (const variant of TOON_VARIANTS) assert.ok(!toonCatSvg({ variant, coat }).includes(white), `${variant}/${coat}: no tuxedo whites`);
  }
});

test('moving parts per variant, unique clip ids per instance, aspect ratios, and errors for unknown input', () => {
  assert.match(toonCatSvg({ variant: 'play', coat: 'grey' }), /toon__yarn[\s\S]*toon__bat/);
  assert.match(toonCatSvg({ variant: 'lie', coat: 'calico' }), /toon__paw/);
  const a = toonCatSvg({ variant: 'sit', coat: 'black', id: 'one' });
  const b = toonCatSvg({ variant: 'sit', coat: 'black', id: 'two' });
  assert.ok(a.includes('id="one-head"') && b.includes('id="two-head"') && !b.includes('one-'));
  assert.ok(toonAspect('lie') > 1.5 && toonAspect('sit') < 1);
  assert.throws(() => toonCatSvg({ variant: 'dance', coat: 'black' }), RangeError);
  assert.throws(() => toonCatSvg({ variant: 'sit', coat: 'tartan' }), RangeError);
});
