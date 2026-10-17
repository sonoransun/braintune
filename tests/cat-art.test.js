import test from 'node:test';
import assert from 'node:assert/strict';
import { POSES, COATS, catSvg, coatVars, catLabel } from '../docs/js/core/cat-art.js';

const TAGS = ['svg', 'g', 'path', 'rect', 'ellipse', 'circle', 'line'];
const PART_CLASSES = ['cat__body', 'cat__head', 'cat__ear--l', 'cat__ear--r', 'cat__eye--l', 'cat__eye--r', 'cat__nose', 'cat__mouth', 'cat__whiskers', 'cat__tail', 'cat__markings', 'cat__legs'];
const HEX6 = /^#[0-9A-F]{6}$/;

const count = (svg, re) => (svg.match(re) ?? []).length;
const opens = (svg, tag) => count(svg, new RegExp(`<${tag}[\\s>]`, 'g'));
const closes = (svg, tag) => count(svg, new RegExp(`</${tag}>`, 'g'));

test('POSES and COATS follow §7.8', () => {
  assert.deepEqual(POSES, ['sit', 'loaf', 'walk', 'sleep']);
  assert.deepEqual(Object.keys(COATS), ['black', 'orangeTabby', 'grey', 'calico']);
  assert.deepEqual(COATS.black, { coat: '#23202B', ear: '#3A2F3A', eye: '#E8C547', nose: '#3A3340' });
  assert.deepEqual(COATS.orangeTabby, { coat: '#E0893B', ear: '#F0B7A2', eye: '#7BB661', nose: '#E59AA0', markings: '#B5632A' });
  assert.deepEqual(COATS.grey, { coat: '#8B8E99', ear: '#D9A5A8', eye: '#D6B24C', nose: '#D98B92', markings: '#6E7280' });
  assert.deepEqual(COATS.calico, { coat: '#F3EEE6', ear: '#EFB6B2', eye: '#C9A34A', nose: '#E59AA0', markings: '#E0893B', patch: '#2B2630' });
  for (const c of Object.values(COATS)) for (const v of Object.values(c)) assert.match(v, HEX6);
});

test('every pose × coat × flip renders a balanced SVG with viewBox, all part classes, no NaN, no style=, var(--coat)', () => {
  for (const pose of POSES) {
    for (const coat of Object.keys(COATS)) {
      for (const flip of [false, true]) {
        const svg = catSvg({ pose, coat, flip });
        const label = `${pose}/${coat}/${flip}`;
        assert.ok(svg.startsWith('<svg ') && svg.endsWith('</svg>'), label);
        for (const tag of TAGS) assert.equal(opens(svg, tag), closes(svg, tag), `${label}: <${tag}> balance`);
        assert.equal(opens(svg, 'svg'), 1, label);
        assert.ok(svg.includes('viewBox="0 0 120 100"'), label);
        assert.ok(svg.includes('width="100%"') && svg.includes('height="100%"'), label);
        assert.ok(svg.includes('aria-hidden="true"') && svg.includes('focusable="false"'), label);
        assert.ok(svg.includes('xmlns="http://www.w3.org/2000/svg"'), label);
        for (const cls of PART_CLASSES) assert.ok(svg.includes(cls), `${label}: missing .${cls}`);
        assert.ok(!svg.includes('NaN') && !svg.includes('undefined') && !svg.includes('null'), label);
        assert.ok(!/style\s*=/.test(svg), `${label}: inline style`);
        assert.ok(!svg.includes('<script'), label);
        assert.ok(svg.includes('fill="var(--coat)"'), label);
        assert.ok(svg.includes('fill="var(--ear)"') && svg.includes('fill="var(--nose)"'), label);
        assert.ok(svg.includes('class="cat__root"'), label);
        assert.equal(svg.includes('transform="translate(120 0) scale(-1 1)"'), flip, `${label}: flip transform`);
        const numbers = svg.replace(/#[0-9A-F]{6}/g, '').match(/[-\d.]+(?=["\s])/g) ?? [];
        for (const n of numbers) assert.ok(!Number.isNaN(Number(n)) && Math.abs(Number(n)) <= 120, `${label}: odd number ${n}`);
      }
    }
  }
});

test('open-eyed poses carry sclera, pupil and highlight; the sleep pose uses closed-eye arcs only', () => {
  for (const pose of ['sit', 'loaf', 'walk']) {
    const svg = catSvg({ pose, coat: 'grey' });
    assert.ok(svg.includes('fill="var(--eye)"'), pose);
    assert.equal(count(svg, /fill="#1A1A1E"/g), 2, `${pose}: two pupils`);
    assert.equal(count(svg, /fill="#FFFFFF"/g), 2, `${pose}: two highlights`);
    assert.ok(!svg.includes('cat__eye--closed'), pose);
  }
  const sleep = catSvg({ pose: 'sleep', coat: 'grey' });
  assert.ok(!sleep.includes('var(--eye)'), 'sleep has no open eyes');
  assert.equal(count(sleep, /cat__eye--closed/g), 2);
  assert.equal(count(sleep, /stroke="#1A1A1E"/g), 2, 'two closed-eye arcs');
  assert.ok(/<path class="cat__eye cat__eye--l cat__eye--closed" d="M[^"]*q[^"]*"/.test(sleep));
});

test('walk pose has four legs as separate rects in .cat__legs; other poses show paws', () => {
  const walk = catSvg({ pose: 'walk', coat: 'black' });
  for (const leg of ['fl', 'fr', 'bl', 'br']) assert.equal(count(walk, new RegExp(`<rect class="cat__leg cat__leg--${leg}"`, 'g')), 1, leg);
  const legsGroup = /<g class="cat__legs">(.*?)<\/g>/s.exec(walk)[1];
  assert.equal(count(legsGroup, /<rect /g), 4);
  assert.ok(legsGroup.includes('width="8"') && legsGroup.includes('height="22"'));
  for (const pose of ['sit', 'loaf', 'sleep']) {
    const svg = catSvg({ pose, coat: 'black' });
    assert.ok(!svg.includes('cat__leg--'), pose);
    assert.ok(svg.includes('cat__paw'), pose);
  }
});

test('markings follow the coat: tabby M + stripes + tail rings, grey stripes, calico patches, black none', () => {
  for (const pose of POSES) {
    const tabby = catSvg({ pose, coat: 'orangeTabby' });
    assert.ok(tabby.includes('stroke="var(--markings)"'), `${pose}: tabby stripes`);
    assert.ok(tabby.includes('cat__tail-rings'), `${pose}: tail rings`);
    assert.ok(tabby.includes('cat__markings--head'), `${pose}: forehead M`);
    const grey = catSvg({ pose, coat: 'grey' });
    assert.ok(grey.includes('stroke="var(--markings)"') && !grey.includes('cat__tail-rings'), `${pose}: grey`);
    const calico = catSvg({ pose, coat: 'calico' });
    assert.ok(calico.includes('fill="var(--markings)"') && calico.includes('fill="#2B2630"'), `${pose}: calico patches`);
    assert.equal(count(calico, /cat__patch/g), 3, `${pose}: calico patch count`);
    const black = catSvg({ pose, coat: 'black' });
    assert.ok(!black.includes('var(--markings)'), `${pose}: black has no markings`);
    assert.ok(black.includes('<g class="cat__markings"></g>'), `${pose}: empty markings group kept`);
  }
});

test('poses place the head where §7.8 says', () => {
  assert.ok(catSvg({ pose: 'sit', coat: 'grey' }).includes('class="cat__face" cx="60" cy="30" r="18"'));
  assert.ok(catSvg({ pose: 'sit', coat: 'grey' }).includes('class="cat__body" cx="60" cy="62" rx="26" ry="34"'));
  assert.ok(catSvg({ pose: 'loaf', coat: 'grey' }).includes('class="cat__face" cx="40" cy="44" r="17"'));
  assert.ok(catSvg({ pose: 'loaf', coat: 'grey' }).includes('class="cat__body" x="24" y="46" width="72" height="40" rx="20"'));
  assert.ok(catSvg({ pose: 'walk', coat: 'grey' }).includes('class="cat__face" cx="96" cy="44" r="15"'));
  assert.ok(catSvg({ pose: 'walk', coat: 'grey' }).includes('class="cat__body" x="32" y="43" width="60" height="30" rx="15"'));
  assert.ok(catSvg({ pose: 'sleep', coat: 'grey' }).includes('class="cat__face" cx="84" cy="56" r="16"'));
});

test('catSvg rejects unknown poses and coats', () => {
  assert.throws(() => catSvg({ pose: 'fly', coat: 'grey' }), RangeError);
  assert.throws(() => catSvg({ pose: 'sit', coat: 'tartan' }), RangeError);
});

test('coatVars maps coats to the five custom properties, markings defaulting to the coat colour', () => {
  assert.deepEqual(coatVars('orangeTabby'), { '--coat': '#E0893B', '--ear': '#F0B7A2', '--eye': '#7BB661', '--nose': '#E59AA0', '--markings': '#B5632A' });
  assert.deepEqual(coatVars('black'), { '--coat': '#23202B', '--ear': '#3A2F3A', '--eye': '#E8C547', '--nose': '#3A3340', '--markings': '#23202B' });
  for (const coat of Object.keys(COATS)) for (const v of Object.values(coatVars(coat))) assert.match(v, HEX6);
  assert.throws(() => coatVars('tartan'), RangeError);
});

test('catLabel phrases', () => {
  assert.equal(catLabel('sit', 'calico'), 'A calico cat sitting nearby');
  assert.equal(catLabel('loaf', 'grey'), 'A grey cat loafing nearby');
  assert.equal(catLabel('walk', 'orangeTabby'), 'An orange tabby cat walking by');
  assert.equal(catLabel('sleep', 'black'), 'A black cat asleep nearby');
  assert.throws(() => catLabel('sit', 'tartan'), RangeError);
});
