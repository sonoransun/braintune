// Site-level checks over docs/, the GitHub Pages publishing source: relative URLs only, the precache list versus
// the real files, one version everywhere, manifest validity, the index.html head, the CSS motion contract and
// size budgets. Each failing assertion names exactly what is missing or wrong.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadServiceWorker } from './helpers/sw-host.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');
const KB = 1024;
const TEXT_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.json', '.webmanifest', '.svg', '.txt', '.md']);
const NOT_PRECACHED = new Set(['sw.js', 'CNAME']); // dotfiles such as .nojekyll are skipped by listFiles
const KEYFRAMES_ALLOWED = new Set(['css/scene.css', 'css/cats.css']);
const STYLESHEET_ORDER = ['tokens', 'base', 'layout', 'components', 'scene', 'cats'].map((name) => `css/${name}.css`);
const CSP_DIRECTIVES = [
  "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data: blob:", "media-src 'self'",
  "connect-src 'self'", "manifest-src 'self'", "worker-src 'self'", "object-src 'none'", "base-uri 'none'", "form-action 'none'",
];
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICON_DIMENSIONS = { 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512, 'apple-touch-icon.png': 180 };
const ROOT_ABSOLUTE_URL = [
  { re: /\bhref\s*=\s*["']\//, why: 'href="/..."' },
  { re: /\bsrc\s*=\s*["']\//, why: 'src="/..."' },
  { re: /\burl\(\s*["']?\//, why: 'url(/...)' },
  { re: /\bfrom\s+["']\//, why: 'import ... from "/..."' },
  { re: /\bimport\(\s*["']\//, why: 'import("/...")' },
  { re: /\bregister\(\s*["']\//, why: 'register("/...")' },
  { re: /"(?:src|start_url|scope)"\s*:\s*"\//, why: 'manifest "/..." path' },
];

/** Regular files under dir as posix paths relative to dir; dotfiles and dot-directories skipped. */
function listFiles(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) =>
      entry.isDirectory() ? listFiles(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`],
    );
}
const docsFiles = () => listFiles(DOCS);
const exists = (rel) => existsSync(join(DOCS, rel));
const read = (rel) => readFileSync(join(DOCS, rel), 'utf8');
const sizeOf = (rel) => statSync(join(DOCS, rel)).size;
const isText = (rel) => TEXT_EXTENSIONS.has(extname(rel).toLowerCase());
const requireFile = (rel) => assert.ok(exists(rel), `docs/${rel} is missing`);
const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** VERSION, CACHE and SHELL from docs/sw.js (SHELL copied into a host-realm array). */
function swMeta() {
  requireFile('sw.js');
  const { VERSION, CACHE, SHELL } = loadServiceWorker(join(DOCS, 'sw.js')).self.__BRAINTUNE_SW;
  return { VERSION, CACHE, SHELL: [...SHELL] };
}

describe('relative URLs (the site is served from https://<user>.github.io/braintune/)', () => {
  test('no root-absolute URL anywhere under docs/', () => {
    const offenders = [];
    for (const rel of docsFiles().filter(isText)) {
      read(rel).split('\n').forEach((line, i) => {
        const hit = ROOT_ABSOLUTE_URL.find(({ re }) => re.test(line));
        if (hit) offenders.push(`docs/${rel}:${i + 1}: ${hit.why}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, [], `Root-absolute URLs break the /braintune/ subpath:\n${offenders.join('\n')}`);
  });
});

describe('sw.js precache list', () => {
  test('SHELL equals the real file set under docs/ (minus sw.js, .nojekyll, CNAME)', () => {
    const shell = swMeta().SHELL.sort();
    const onDisk = docsFiles()
      .filter((rel) => !NOT_PRECACHED.has(rel))
      .map((rel) => `./${rel}`)
      .sort();
    const missing = shell.filter((url) => !onDisk.includes(url));
    const extra = onDisk.filter((url) => !shell.includes(url));
    const report = [
      'docs/sw.js SHELL and the files under docs/ differ.',
      `In SHELL but not on disk (install would 404): ${missing.length}`,
      ...missing.map((url) => `  - ${url}`),
      `On disk but not in SHELL (unavailable offline): ${extra.length}`,
      ...extra.map((url) => `  + ${url}`),
    ].join('\n');
    assert.ok(missing.length === 0 && extra.length === 0, report);
  });
});

describe('version', () => {
  test('package.json, docs/js/version.js and docs/sw.js carry the same version', async () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    requireFile('js/version.js');
    const { APP_VERSION } = await import(pathToFileURL(join(DOCS, 'js/version.js')).href);
    const { VERSION } = swMeta();
    assert.equal(APP_VERSION, pkg, `docs/js/version.js APP_VERSION is ${APP_VERSION}; package.json version is ${pkg}`);
    assert.equal(VERSION, pkg, `docs/sw.js VERSION is ${VERSION}; package.json version is ${pkg}`);
  });
});

describe('manifest.webmanifest', () => {
  const manifest = () => {
    requireFile('manifest.webmanifest');
    return JSON.parse(read('manifest.webmanifest'));
  };

  test('has the planned identity fields', () => {
    const m = manifest();
    assert.ok(m.name, 'manifest.name missing');
    assert.equal(m.short_name, 'Brain Tune');
    assert.equal(m.start_url, './');
    assert.equal(m.scope, './');
    assert.equal(m.display, 'standalone');
    assert.equal(m.lang, 'en');
    assert.match(m.background_color ?? '', /^#[0-9a-f]{6}$/i, 'background_color must be a #rrggbb colour');
    assert.match(m.theme_color ?? '', /^#[0-9a-f]{6}$/i, 'theme_color must be a #rrggbb colour');
  });

  test('has no id and no display_override', () => {
    const m = manifest();
    assert.equal('id' in m, false, 'manifest must not set "id"');
    assert.equal('display_override' in m, false, 'manifest must not set "display_override"');
  });

  test('icons: 192 png, 512 png and 512 maskable png; every src relative and present on disk', () => {
    const icons = manifest().icons ?? [];
    const purposes = (icon) => (icon.purpose ?? 'any').split(/\s+/);
    const find = (sizes, purpose) => icons.find((icon) => icon.sizes === sizes && purposes(icon).includes(purpose));
    assert.ok(find('192x192', 'any'), 'manifest needs a 192x192 icon');
    assert.ok(find('512x512', 'any'), 'manifest needs a 512x512 icon with purpose any');
    assert.ok(find('512x512', 'maskable'), 'manifest needs a 512x512 icon with purpose maskable');
    for (const icon of icons) {
      assert.ok(typeof icon.src === 'string' && !icon.src.startsWith('/'), `icon src must be relative: ${icon.src}`);
      assert.ok(exists(icon.src), `manifest icon is missing on disk: docs/${icon.src}`);
    }
  });
});

describe('index.html', () => {
  const html = () => {
    requireFile('index.html');
    return read('index.html');
  };
  const head = () => html().match(/<head\b[\s\S]*?<\/head>/i)?.[0] ?? '';
  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
    return m ? (m[1] ?? m[2]) : undefined;
  };
  const tags = (name) => [...head().matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((m) => m[0]);
  const metaNamed = (name) => tags('meta').find((m) => (attr(m, 'name') ?? '').toLowerCase() === name);
  const metaEquiv = (name) => tags('meta').find((m) => (attr(m, 'http-equiv') ?? '').toLowerCase() === name);
  const linksRel = (rel) => tags('link').filter((l) => (attr(l, 'rel') ?? '').toLowerCase().split(/\s+/).includes(rel));
  const scripts = () => [...html().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].map((m) => ({ tag: m[0], attrs: m[1], body: m[2] }));
  const isModule = (attrs) => /\btype\s*=\s*["']module["']/i.test(attrs);
  const stripDotSlash = (href) => (href ?? '').replace(/^\.\//, '');

  test('<html> declares lang', () => {
    assert.match(html(), /<html\b[^>]*\slang=["'][a-z]{2}/i, 'index.html: <html lang="en"> missing');
  });

  test('charset meta is the first element in <head>', () => {
    const first = head().match(/<head\b[^>]*>\s*(<[^>]+>)/i)?.[1] ?? '(nothing)';
    assert.match(first, /<meta\s+charset=["']?utf-8/i, `first element in <head> must be <meta charset="utf-8">, found ${first}`);
  });

  test('viewport meta includes viewport-fit=cover', () => {
    const m = metaNamed('viewport');
    assert.ok(m, 'index.html: <meta name="viewport"> missing');
    assert.match(attr(m, 'content') ?? '', /viewport-fit=cover/, `viewport content lacks viewport-fit=cover: ${m}`);
  });

  test('CSP meta carries the planned directives and precedes every <link> and <script>', () => {
    const m = metaEquiv('content-security-policy');
    assert.ok(m, 'index.html: <meta http-equiv="Content-Security-Policy"> missing');
    const content = attr(m, 'content') ?? '';
    const lacking = CSP_DIRECTIVES.filter((directive) => !content.includes(directive));
    assert.deepEqual(lacking, [], `CSP lacks: ${lacking.join('; ')} (content: ${content})`);
    const h = head();
    const firstExternal = h.search(/<(?:link|script)\b/i);
    assert.ok(firstExternal === -1 || h.indexOf(m) < firstExternal, 'CSP meta must come before the first <link>/<script> in <head>');
  });

  test('theme-color and color-scheme metas', () => {
    assert.ok(metaNamed('theme-color'), 'index.html: <meta name="theme-color"> missing');
    const scheme = metaNamed('color-scheme');
    assert.ok(scheme, 'index.html: <meta name="color-scheme" content="dark light"> missing');
    assert.equal(attr(scheme, 'content'), 'dark light');
  });

  test('manifest link', () => {
    const [link] = linksRel('manifest');
    assert.ok(link, 'index.html: <link rel="manifest"> missing');
    assert.equal(stripDotSlash(attr(link, 'href')), 'manifest.webmanifest', `manifest href must be relative: ${link}`);
  });

  test('svg icon plus png icon fallback, both present on disk', () => {
    const icons = linksRel('icon');
    const svg = icons.find((l) => /\.svg$/i.test(attr(l, 'href') ?? ''));
    const png = icons.find((l) => /\.png$/i.test(attr(l, 'href') ?? ''));
    assert.ok(svg, 'index.html: <link rel="icon" href="favicon.svg" type="image/svg+xml"> missing');
    assert.ok(png, 'index.html: png <link rel="icon"> fallback (icons/icon-192.png) missing');
    for (const link of icons) assert.ok(exists(stripDotSlash(attr(link, 'href'))), `icon file missing on disk: ${link}`);
  });

  test('apple-touch-icon link present on disk', () => {
    const [link] = linksRel('apple-touch-icon');
    assert.ok(link, 'index.html: <link rel="apple-touch-icon"> missing');
    assert.ok(exists(stripDotSlash(attr(link, 'href'))), `apple-touch-icon file missing on disk: ${link}`);
  });

  test('apple-mobile-web-app-title and mobile-web-app-capable metas', () => {
    assert.ok(metaNamed('apple-mobile-web-app-title'), 'index.html: <meta name="apple-mobile-web-app-title"> missing');
    assert.ok(metaNamed('mobile-web-app-capable'), 'index.html: <meta name="mobile-web-app-capable"> missing');
  });

  test('six stylesheets in the order tokens, base, layout, components, scene, cats', () => {
    const hrefs = linksRel('stylesheet').map((l) => stripDotSlash(attr(l, 'href')));
    assert.deepEqual(hrefs, STYLESHEET_ORDER, `stylesheets must be exactly [${STYLESHEET_ORDER.join(', ')}] in order; found [${hrefs.join(', ')}]`);
  });

  test('js/boot.js classic script, then exactly one module script loading js/app.js', () => {
    const list = scripts();
    const modules = list.filter((s) => isModule(s.attrs));
    assert.equal(modules.length, 1, `expected exactly one <script type="module">, found ${modules.length}`);
    assert.equal(stripDotSlash(attr(modules[0].tag, 'src')), 'js/app.js', `the module script must load js/app.js: ${modules[0].tag}`);
    const boot = list.find((s) => stripDotSlash(attr(s.tag, 'src')) === 'js/boot.js');
    assert.ok(boot, 'index.html: <script src="js/boot.js"> (classic, before first paint) missing');
    assert.ok(!isModule(boot.attrs), 'js/boot.js must be a classic script, not type="module"');
    assert.ok(html().indexOf(boot.tag) < html().indexOf(modules[0].tag), 'js/boot.js must come before the module script');
  });

  test('no inline script bodies (every <script> has a src and an empty body)', () => {
    const inline = scripts().filter((s) => s.body.trim() !== '' || !attr(s.tag, 'src'));
    assert.deepEqual(inline.map((s) => s.tag.slice(0, 80)), [], 'CSP script-src self forbids inline scripts');
  });

  test('no style attributes and no <style> element', () => {
    const offenders = [];
    html().split('\n').forEach((line, i) => {
      if (/<[^>]*\sstyle\s*=/i.test(line)) offenders.push(`index.html:${i + 1}: ${line.trim()}`);
    });
    assert.deepEqual(offenders, [], `CSP style-src self forbids style attributes:\n${offenders.join('\n')}`);
    assert.ok(!/<style\b/i.test(html()), 'index.html must not contain a <style> element');
  });

  test('has a <noscript> message', () => {
    assert.match(html(), /<noscript>\s*\S[\s\S]*?<\/noscript>/i, 'index.html: <noscript> message missing');
  });
});

// --- CSS motion contract helpers ---------------------------------------------------------------------------------

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Splits on a separator outside parentheses. */
function splitTopLevel(value, separator) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    const isSeparator = separator === ' ' ? /\s/.test(ch) : ch === separator;
    if (isSeparator && depth === 0) {
      parts.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Every custom property declared anywhere: name -> all values. */
function customProperties(cssSources) {
  const vars = new Map();
  for (const css of cssSources) {
    for (const m of css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)) {
      if (!vars.has(m[1])) vars.set(m[1], []);
      vars.get(m[1]).push(m[2].trim());
    }
  }
  return vars;
}

function parseSeconds(token) {
  const m = /^\+?(\d*\.?\d+)(ms|s)$/i.exec(token);
  if (!m) return null;
  return m[2].toLowerCase() === 's' ? Number(m[1]) : Number(m[1]) / 1000;
}

/** Seconds a token can stand for: a literal time, or every time value a var(--x[, fallback]) resolves to. */
function durationsOf(token, vars, depth = 0) {
  const literal = parseSeconds(token);
  if (literal !== null) return [literal];
  const ref = /^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/.exec(token);
  if (!ref || depth > 4) return [];
  const values = vars.get(ref[1]) ?? (ref[2] ? [ref[2]] : []);
  return values.flatMap((value) => durationsOf(value.trim(), vars, depth + 1));
}

/** Innermost `selector { declarations }` blocks with the line of their opening brace. */
function ruleBlocks(css) {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)].map((m) => ({
    selector: m[1].trim().replace(/\s+/g, ' '),
    body: m[2],
    line: lineOf(css, m.index + m[1].length),
  }));
}

function declarations(body) {
  return splitTopLevel(body, ';')
    .map((d) => {
      const i = d.indexOf(':');
      return i < 0 ? null : { prop: d.slice(0, i).trim().toLowerCase(), value: d.slice(i + 1).trim() };
    })
    .filter(Boolean);
}

function checkDuration(issues, where, decl, seconds) {
  if (seconds.length === 0) {
    issues.push(`${where}: ${decl} -> duration unknown (use a literal time or a --token declared in docs/css/)`);
  }
  for (const s of seconds) if (s < 10) issues.push(`${where}: ${decl} -> ${s} s is shorter than 10 s`);
}

/** Infinite animations shorter than 10 s (plan 7.9: any periodic visual change has a period >= 10 s). */
const TRANSFORM_ONLY_PROPS = new Set([
  'transform', 'translate', 'rotate', 'scale', 'transform-origin', 'offset', 'offset-distance', 'offset-path', 'offset-rotate',
]);
const ANIMATION_KEYWORDS = new Set([
  'infinite', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'none', 'forwards', 'backwards', 'both', 'running', 'paused',
  'ease', 'linear', 'ease-in', 'ease-out', 'ease-in-out', 'step-start', 'step-end', 'initial', 'inherit', 'unset',
]);

/** Names of @keyframes whose declarations are all transform-family: translational motion, exempt from the 10 s floor (plan 7.9). */
function transformOnlyKeyframes(cssSources) {
  const names = new Set();
  for (const css of cssSources) {
    for (const m of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
      let depth = 1;
      let i = m.index + m[0].length;
      const start = i;
      while (i < css.length && depth > 0) {
        if (css[i] === '{') depth += 1;
        else if (css[i] === '}') depth -= 1;
        i += 1;
      }
      const props = [...css.slice(start, i - 1).matchAll(/([a-z-]+)\s*:/gi)].map((d) => d[1].toLowerCase());
      if (props.length > 0 && props.every((prop) => TRANSFORM_ONLY_PROPS.has(prop))) names.add(m[1]);
    }
  }
  return names;
}

/** The animation-name inside an `animation:` shorthand (the identifier that is not a time, keyword, function or number). */
function animationName(single, vars) {
  return (
    splitTopLevel(single, ' ').find(
      (t) => !ANIMATION_KEYWORDS.has(t.toLowerCase()) && durationsOf(t, vars).length === 0 && !/^[\w-]+\(/.test(t) && !/^[\d.+-]/.test(t),
    ) ?? null
  );
}

function infiniteAnimationIssues(rel, css, vars, exempt = new Set()) {
  const issues = [];
  for (const { selector, body, line } of ruleBlocks(css)) {
    const decls = declarations(body);
    const where = `docs/${rel}:${line} (${selector})`;
    for (const { prop, value } of decls) {
      if (prop === 'animation') {
        for (const single of splitTopLevel(value, ',')) {
          if (!/\binfinite\b/.test(single)) continue;
          const name = animationName(single, vars);
          if (name && exempt.has(name)) continue;
          const token = splitTopLevel(single, ' ').find((t) => durationsOf(t, vars).length > 0);
          checkDuration(issues, where, `animation: ${single}`, token ? durationsOf(token, vars) : []);
        }
      } else if (prop === 'animation-iteration-count' && /\binfinite\b/.test(value)) {
        const nameDecl = decls.find((d) => d.prop === 'animation-name');
        const names = nameDecl ? splitTopLevel(nameDecl.value, ',') : [];
        if (names.length > 0 && names.every((n) => exempt.has(n))) continue;
        const duration = decls.find((d) => d.prop === 'animation-duration');
        const seconds = duration ? splitTopLevel(duration.value, ',').flatMap((t) => durationsOf(t, vars)) : [];
        checkDuration(issues, where, 'animation-iteration-count: infinite', seconds);
      }
    }
  }
  return issues;
}

describe('CSS motion contract (WCAG 2.3.1, plan 7.9)', () => {
  const cssFiles = () => docsFiles().filter((rel) => rel.endsWith('.css'));

  test('@keyframes appear only in css/scene.css and css/cats.css', () => {
    const offenders = [];
    for (const rel of cssFiles().filter((rel) => !KEYFRAMES_ALLOWED.has(rel))) {
      stripComments(read(rel)).split('\n').forEach((line, i) => {
        if (/@keyframes\b/.test(line)) offenders.push(`docs/${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    assert.deepEqual(offenders, [], `@keyframes outside scene.css/cats.css:\n${offenders.join('\n')}`);
  });

  test('every infinite animation has a period of at least 10 s (transform-only keyframes exempt)', () => {
    const sources = cssFiles().map((rel) => [rel, stripComments(read(rel))]);
    const vars = customProperties(sources.map(([, css]) => css));
    const exempt = transformOnlyKeyframes(sources.map(([, css]) => css));
    const issues = sources.flatMap(([rel, css]) => infiniteAnimationIssues(rel, css, vars, exempt));
    assert.deepEqual(
      issues,
      [],
      `Infinite animations must run >= 10 s per cycle unless their @keyframes only move (transform family):\n${issues.join('\n')}`,
    );
  });

  test('prefers-reduced-motion is honoured somewhere under docs/', () => {
    const hits = docsFiles().filter((rel) => /\.(css|js)$/.test(rel) && read(rel).includes('prefers-reduced-motion'));
    assert.ok(hits.length > 0, 'no CSS or JS file under docs/ mentions prefers-reduced-motion (Still mode must follow it)');
  });
});

describe('size budgets', () => {
  const total = (files) => files.reduce((sum, rel) => sum + sizeOf(rel), 0);
  const largest = (files, n = 5) =>
    files
      .map((rel) => [rel, sizeOf(rel)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([rel, size]) => `${rel} (${size} B)`)
      .join(', ');

  test('docs/ without icons stays under 450 KB', () => {
    const files = docsFiles().filter((rel) => !rel.startsWith('icons/'));
    const bytes = total(files);
    assert.ok(bytes < 450 * KB, `docs/ minus icons is ${bytes} bytes (budget ${450 * KB}); largest: ${largest(files)}`);
  });

  test('no text file exceeds 48 KB', () => {
    const over = docsFiles().filter((rel) => isText(rel) && sizeOf(rel) > 48 * KB).map((rel) => `${rel} (${sizeOf(rel)} B)`);
    assert.deepEqual(over, [], `text files over ${48 * KB} bytes: ${over.join(', ')}`);
  });

  test('docs/icons/ stays under 100 KB in total', () => {
    const files = docsFiles().filter((rel) => rel.startsWith('icons/'));
    const bytes = total(files);
    assert.ok(bytes < 100 * KB, `docs/icons/ is ${bytes} bytes (budget ${100 * KB}); ${largest(files)}`);
  });

  test('committed PNG icons carry the PNG signature and the planned dimensions', () => {
    for (const [file, size] of Object.entries(ICON_DIMENSIONS)) {
      const rel = `icons/${file}`;
      assert.ok(exists(rel), `docs/${rel} is missing (run: node tools/make-icons.mjs)`);
      const buffer = readFileSync(join(DOCS, rel));
      assert.ok(buffer.subarray(0, 8).equals(PNG_SIGNATURE), `docs/${rel} is not a PNG`);
      assert.equal(buffer.readUInt32BE(16), size, `docs/${rel} width`);
      assert.equal(buffer.readUInt32BE(20), size, `docs/${rel} height`);
    }
  });
});
