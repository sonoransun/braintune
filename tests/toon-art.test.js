// docs/js/core/toon-art.js: the cell-shaded background cats are well-formed, CSP-safe SVG with cel-shading passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOON_VARIANTS, toonCatSvg, toonAspect } from '../docs/js/core/toon-art.js';
import { COATS } from '../docs/js/core/cat-art.js';

const count = (s, re) => (s.match(re) ?? []).length;

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
  assert.equal(count(svg, /fill-opacity="0.28"/g), parts, 'one hard shadow band per part');
  assert.ok(count(svg, /stroke-width="8"/g) >= parts, 'thick ink underlay outlines');
  assert.ok(svg.includes(`fill="${COATS.orangeTabby.coat}"`), 'flat coat fill');
  assert.ok(svg.includes(`stroke="${COATS.orangeTabby.markings}"`), 'tabby stripes');
  assert.match(svg, /class="toon__part toon__head" data-origin="\d+ \d+"/, 'head pivot for the tilt');
  assert.doesNotMatch(svg, /<circle [^>]*fill="#1A1A1E"/, 'no open pupils: a purring cat squints');
});

test('moving parts per variant, unique clip ids per instance, aspect ratios, and errors for unknown input', () => {
  assert.match(toonCatSvg({ variant: 'play', coat: 'grey' }), /toon__yarn[\s\S]*toon__bat/);
  assert.match(toonCatSvg({ variant: 'lie', coat: 'calico' }), /toon__paw/);
  const a = toonCatSvg({ variant: 'sit', coat: 'black', id: 'one' });
  const b = toonCatSvg({ variant: 'sit', coat: 'black', id: 'two' });
  assert.ok(a.includes('id="one-head"') && b.includes('id="two-head"') && !b.includes('one-'));
  assert.ok(toonAspect('lie') > 1.5 && toonAspect('sit') < 1);
  assert.throws(() => toonCatSvg({ variant: 'dance', coat: 'black' }), RangeError);
  assert.throws(() => toonCatSvg({ variant: 'sit', coat: 'tuxedo' }), RangeError);
});
