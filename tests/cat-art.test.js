import test from 'node:test';
import assert from 'node:assert/strict';
import { POSES, COATS, catSvg, coatVars, catLabel } from '../docs/js/core/cat-art.js';
import { STRINGS } from '../docs/js/core/microcopy.js';

const TAGS = ['svg', 'g', 'path', 'rect', 'ellipse', 'circle', 'line'];
const HEAD_CLASSES = ['cat__head', 'cat__ear--l', 'cat__ear--r', 'cat__eye--l', 'cat__eye--r', 'cat__nose', 'cat__mouth', 'cat__whiskers'];
const PART_CLASSES = {
  sit: [...HEAD_CLASSES, 'cat__body', 'cat__tail', 'cat__markings', 'cat__legs', 'cat__paw'],
  loaf: [...HEAD_CLASSES, 'cat__body', 'cat__tail', 'cat__markings', 'cat__legs', 'cat__paw'],
  walk: [...HEAD_CLASSES, 'cat__body', 'cat__tail', 'cat__markings', 'cat__legs', 'cat__leg--fl'],
  sleep: [...HEAD_CLASSES, 'cat__body', 'cat__tail', 'cat__markings', 'cat__legs', 'cat__paw'],
  peek: [...HEAD_CLASSES, 'cat__markings', 'cat__legs', 'cat__paw'],
};
const HEX6 = /^#[0-9A-F]{6}$/;

const count = (svg, re) => (svg.match(re) ?? []).length;
const opens = (svg, tag) => count(svg, new RegExp(`<${tag}[\\s>]`, 'g'));
const closes = (svg, tag) => count(svg, new RegExp(`</${tag}>`, 'g'));

test('POSES and COATS follow §7.8 and v0.4 §V12 (peek pose, tuxedo coat)', () => {
  assert.deepEqual(POSES, ['sit', 'loaf', 'walk', 'sleep', 'peek']);
  assert.deepEqual(Object.keys(COATS), ['black', 'orangeTabby', 'grey', 'calico', 'tuxedo']);
  assert.deepEqual(COATS.black, { coat: '#23202B', ear: '#3A2F3A', eye: '#E8C547', nose: '#3A3340' });
  assert.deepEqual(COATS.orangeTabby, { coat: '#E0893B', ear: '#F0B7A2', eye: '#7BB661', nose: '#E59AA0', markings: '#B5632A' });
  assert.deepEqual(COATS.grey, { coat: '#8B8E99', ear: '#D9A5A8', eye: '#D6B24C', nose: '#D98B92', markings: '#6E7280' });
  assert.deepEqual(COATS.calico, { coat: '#F3EEE6', ear: '#EFB6B2', eye: '#C9A34A', nose: '#E59AA0', markings: '#E0893B', patch: '#2B2630' });
  assert.deepEqual(COATS.tuxedo, { coat: '#1F1B26', ear: '#3A2F3A', eye: '#7CCB63', nose: '#E7A1A8', markings: '#F4F1EA' });
  for (const c of Object.values(COATS)) for (const v of Object.values(c)) assert.match(v, HEX6);
  assert.ok(Object.isFrozen(POSES) && Object.isFrozen(COATS) && Object.isFrozen(COATS.tuxedo));
});

test('every pose × coat × flip renders a balanced SVG with viewBox, its part classes, no NaN, no style=, var(--coat)', () => {
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
        assert.ok(svg.includes(`class="cat__svg cat__svg--${pose}"`), label);
        for (const cls of PART_CLASSES[pose]) assert.ok(svg.includes(cls), `${label}: missing .${cls}`);
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

test('peek is a head and two paws on the ledge line: no body, no tail', () => {
  for (const coat of Object.keys(COATS)) {
    const svg = catSvg({ pose: 'peek', coat });
    assert.ok(!svg.includes('cat__body') && !svg.includes('cat__tail'), `${coat}: nothing below the ledge`);
    assert.equal(count(svg, /<ellipse class="cat__paw"/g), 2, coat);
  }
  const peek = catSvg({ pose: 'peek', coat: 'grey' });
  assert.ok(peek.includes('class="cat__face" cx="60" cy="70" r="22"'));
  assert.ok(peek.includes('class="cat__paw" cx="42" cy="96" rx="10" ry="4.5"'));
  assert.ok(peek.includes('class="cat__paw" cx="78" cy="96" rx="10" ry="4.5"'));
  assert.equal(count(peek, /class="cat__ear cat__ear--[lr]"/g), 2, 'both ears');
});

test('open-eyed poses carry sclera, pupil and highlight; the sleep pose uses closed-eye arcs only', () => {
  for (const pose of ['sit', 'loaf', 'walk', 'peek']) {
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
  for (const pose of ['sit', 'loaf', 'sleep', 'peek']) {
    const svg = catSvg({ pose, coat: 'black' });
    assert.ok(!svg.includes('cat__leg--'), pose);
    assert.ok(svg.includes('cat__paw'), pose);
  }
});

test('markings follow the coat: tabby M + stripes + tail rings, grey stripes, calico patches, black none', () => {
  for (const pose of POSES) {
    const hasBody = pose !== 'peek';
    const tabby = catSvg({ pose, coat: 'orangeTabby' });
    assert.ok(tabby.includes('stroke="var(--markings)"'), `${pose}: tabby stripes or M`);
    assert.equal(tabby.includes('cat__tail-rings'), hasBody, `${pose}: tail rings only where there is a tail`);
    assert.ok(tabby.includes('cat__markings--head'), `${pose}: forehead M`);
    const grey = catSvg({ pose, coat: 'grey' });
    assert.equal(grey.includes('stroke="var(--markings)"'), hasBody, `${pose}: grey stripes on the body only`);
    assert.ok(!grey.includes('cat__tail-rings'), `${pose}: grey`);
    const calico = catSvg({ pose, coat: 'calico' });
    assert.ok(calico.includes('fill="#2B2630"'), `${pose}: calico dark patch`);
    assert.equal(calico.includes('fill="var(--markings)"'), hasBody, `${pose}: calico light patch on the body`);
    assert.equal(count(calico, /cat__patch/g), hasBody ? 3 : 1, `${pose}: calico patch count`);
    const black = catSvg({ pose, coat: 'black' });
    assert.ok(!black.includes('var(--markings)'), `${pose}: black has no markings`);
    assert.ok(black.includes('<g class="cat__markings"></g>'), `${pose}: empty markings group kept`);
    for (const coat of ['black', 'orangeTabby', 'grey', 'calico']) {
      assert.ok(!/cat__(bib|sock|muzzle)/.test(catSvg({ pose, coat })), `${pose}/${coat}: tuxedo whites only on tuxedos`);
    }
  }
});

test('tuxedo: a white bib on every body, socks over the paws at 0.9×, a muzzle under the nose', () => {
  const expected = { sit: [1, 2], loaf: [1, 2], walk: [1, 0], sleep: [1, 1], peek: [0, 2] }; // [bibs, socks]
  for (const pose of POSES) {
    const svg = catSvg({ pose, coat: 'tuxedo' });
    const [bibs, socks] = expected[pose];
    assert.equal(count(svg, /<ellipse class="cat__bib"[^>]*fill="var\(--markings\)"/g), bibs, `${pose}: bib`);
    assert.equal(count(svg, /<ellipse class="cat__sock"[^>]*fill="var\(--markings\)"/g), socks, `${pose}: socks`);
    assert.equal(count(svg, /<ellipse class="cat__muzzle"[^>]*fill="var\(--markings\)"/g), 1, `${pose}: muzzle`);
    const headGroup = svg.slice(svg.indexOf('<g class="cat__head">'));
    assert.ok(headGroup.includes('cat__muzzle'), `${pose}: the muzzle tilts with the head`);
    assert.ok(svg.indexOf('cat__muzzle') < svg.indexOf('cat__nose') && svg.indexOf('cat__muzzle') < svg.indexOf('cat__mouth'), `${pose}: muzzle before nose and mouth`);
    assert.ok(!svg.includes('cat__tail-rings') && !svg.includes('cat__patch'), pose);
  }
  const sit = catSvg({ pose: 'sit', coat: 'tuxedo' });
  assert.ok(sit.includes('class="cat__bib" cx="60" cy="58" rx="11" ry="14"'));
  assert.ok(sit.includes('class="cat__sock" cx="48" cy="96" rx="8.1" ry="3.6"'), 'sit paw [48, 96, 9, 4] at 0.9×');
  assert.ok(sit.includes('class="cat__muzzle" cx="60" cy="35.04" rx="7.2" ry="4.68"'), 'head (60, 30, 18): (cx, cy + 0.28r, 0.40r, 0.26r)');
  assert.ok(catSvg({ pose: 'loaf', coat: 'tuxedo' }).includes('class="cat__bib" cx="36" cy="66" rx="10" ry="9"'));
  assert.ok(catSvg({ pose: 'walk', coat: 'tuxedo' }).includes('class="cat__bib" cx="84" cy="58" rx="8" ry="9"'));
  assert.ok(catSvg({ pose: 'sleep', coat: 'tuxedo' }).includes('class="cat__bib" cx="70" cy="72" rx="10" ry="8"'));
  assert.ok(catSvg({ pose: 'peek', coat: 'tuxedo' }).includes('class="cat__sock" cx="78" cy="96" rx="9" ry="4.05"'));
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
  assert.equal(coatVars('tuxedo')['--markings'], '#F4F1EA');
  for (const coat of Object.keys(COATS)) for (const v of Object.values(coatVars(coat))) assert.match(v, HEX6);
  assert.throws(() => coatVars('tartan'), RangeError);
});

test('catLabel phrases; the 0.4 pose and coat come from STRINGS', () => {
  assert.equal(catLabel('sit', 'calico'), 'A calico cat sitting nearby');
  assert.equal(catLabel('loaf', 'grey'), 'A grey cat loafing nearby');
  assert.equal(catLabel('walk', 'orangeTabby'), 'An orange tabby cat walking by');
  assert.equal(catLabel('sleep', 'black'), 'A black cat asleep nearby');
  assert.equal(catLabel('peek', 'tuxedo'), 'A tuxedo cat peeking in');
  assert.equal(catLabel('peek', 'orangeTabby'), 'An orange tabby cat peeking in');
  assert.equal(catLabel('walk', 'tuxedo'), `A ${STRINGS.cats.coats.tuxedo} cat walking by`);
  assert.equal(catLabel('peek', 'grey'), `A grey cat ${STRINGS.cats.poses.peek}`);
  for (const pose of POSES) for (const coat of Object.keys(COATS)) assert.match(catLabel(pose, coat), /^An? [a-z ]+ cat [a-z ]+$/);
  assert.throws(() => catLabel('sit', 'tartan'), RangeError);
  assert.throws(() => catLabel('fly', 'grey'), RangeError);
});
