// Architecture rules for docs/js: a pure core/, folder-scoped imports, explicit ".js" relative specifiers, and
// visual modules that know nothing about the beat. Passes on the files that exist and keeps checking new ones.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const JS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'js');
const SCOPED_FOLDERS = ['audio', 'ui', 'scene', 'cats'];
const EXEMPT_FROM_FOLDER_RULE = new Set(['app.js', 'sw-register.js']);
const CORE_SPECIFIER = /^\.\/[\w.-]+\.js$/;
const SCOPED_SPECIFIER = /^(?:\.\.\/core\/|\.\/)[\w.-]+\.js$/;
const RELATIVE_JS_SPECIFIER = /^\.\.?\/.*\.js$/;
const BEAT_IDENTIFIERS = /beatHz|carrierHz|analyser/i;

const FORBIDDEN_GLOBALS = [
  'window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'indexedDB',
  'AudioContext', 'OfflineAudioContext', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'matchMedia', 'fetch', 'globalThis',
];
const FORBIDDEN_PATTERNS = [
  ...FORBIDDEN_GLOBALS.map((name) => ({ re: new RegExp(`(?<![\\w$.])${name}\\b`), what: name })),
  { re: /(?<![\w$.])Date\.now\b/, what: 'Date.now' },
  { re: /\bnew\s+Date\s*\(\s*\)/, what: 'new Date()' },
  { re: /(?<![\w$.])Math\.random\b/, what: 'Math.random' },
];

/** .js files under dir as posix paths relative to docs/js, sorted. */
function listJs(dir, prefix = '') {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      if (entry.isDirectory()) return listJs(join(dir, entry.name), `${prefix}${entry.name}/`);
      return entry.name.endsWith('.js') ? [`${prefix}${entry.name}`] : [];
    });
}
const jsFiles = () => listJs(JS_DIR);
const coreFiles = () => jsFiles().filter((rel) => rel.startsWith('core/'));
const source = (rel) => readFileSync(join(JS_DIR, rel), 'utf8');
const folderOf = (rel) => (rel.includes('/') ? rel.slice(0, rel.indexOf('/')) : '');

/** Blanks comments, keeping newlines so line numbers survive. */
function withoutComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Blanks comments plus string and template literals, keeping newlines, so scans see only code. */
function codeOnly(src) {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\[\s\S]|[^'\\\n])*'|"(?:\\[\s\S]|[^"\\\n])*"|`(?:\\[\s\S]|[^`\\])*`/g,
    (m) => m.replace(/[^\n]/g, ' '),
  );
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

/** Static, side-effect and dynamic import specifiers with 1-based line numbers. */
function importSpecifiers(src) {
  const code = withoutComments(src);
  const patterns = [
    /\b(?:import|export)\b[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...code.matchAll(re)].map((m) => ({ specifier: m[1], line: lineOf(code, m.index) })));
}

function specifierOffenders(files, allowed, describe) {
  const offenders = [];
  for (const rel of files) {
    for (const { specifier, line } of importSpecifiers(source(rel))) {
      if (!allowed(specifier, rel)) offenders.push(`docs/js/${rel}:${line}: imports '${specifier}' (${describe})`);
    }
  }
  return offenders;
}

describe('docs/js/core is pure', () => {
  test('every core module loads in Node without throwing', async (t) => {
    const files = coreFiles();
    assert.ok(files.length > 0, 'no modules found under docs/js/core/');
    for (const rel of files) {
      await t.test(rel, async () => {
        await import(pathToFileURL(join(JS_DIR, rel)).href);
      });
    }
  });

  test('core sources reference no browser, timer, clock or Math.random globals', () => {
    const offenders = [];
    for (const rel of coreFiles()) {
      codeOnly(source(rel)).split('\n').forEach((line, i) => {
        for (const { re, what } of FORBIDDEN_PATTERNS) {
          if (re.test(line)) offenders.push(`docs/js/${rel}:${i + 1}: ${what}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `core/ must stay pure (inject time, RNG, storage and timers):\n${offenders.join('\n')}`);
  });

  test('core imports only sibling core modules', () => {
    const offenders = specifierOffenders(coreFiles(), (spec) => CORE_SPECIFIER.test(spec), "core may import only './name.js'");
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });
});

describe('import discipline across docs/js', () => {
  test('audio/, ui/, scene/ and cats/ import only ../core/ or their own folder', () => {
    const files = jsFiles().filter((rel) => SCOPED_FOLDERS.includes(folderOf(rel)) && !EXEMPT_FROM_FOLDER_RULE.has(rel));
    const offenders = specifierOffenders(files, (spec) => SCOPED_SPECIFIER.test(spec), "allowed: '../core/name.js' or './name.js'");
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });

  test('every import specifier is relative and ends with .js', () => {
    const offenders = specifierOffenders(jsFiles(), (spec) => RELATIVE_JS_SPECIFIER.test(spec), "must start with './' or '../' and end with '.js'");
    assert.deepEqual(offenders, [], offenders.join('\n'));
  });
});

describe('visual modules know nothing about the beat', () => {
  test('scene/, cats/ and ui/orb.js contain no beatHz, carrierHz or analyser', () => {
    const files = jsFiles().filter((rel) => rel.startsWith('scene/') || rel.startsWith('cats/') || rel === 'ui/orb.js');
    const offenders = [];
    for (const rel of files) {
      source(rel).split('\n').forEach((line, i) => {
        const hit = line.match(BEAT_IDENTIFIERS);
        if (hit) offenders.push(`docs/js/${rel}:${i + 1}: ${hit[0]}`);
      });
    }
    assert.deepEqual(offenders, [], `nothing visual may derive from the beat or carrier (plan 7.9):\n${offenders.join('\n')}`);
  });
});
