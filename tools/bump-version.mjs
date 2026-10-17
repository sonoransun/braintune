#!/usr/bin/env node
// Writes one version into package.json, docs/js/version.js and docs/sw.js (the cache name is the cache-buster).
// Usage: node tools/bump-version.mjs 0.2.0
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// semver.org's recommended pattern.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** The files that carry the version and the pattern that locates it in each. */
const TARGETS = [
  { file: 'package.json', pattern: /("version"\s*:\s*")([^"]*)(")/ },
  { file: 'docs/js/version.js', pattern: /(export const APP_VERSION = ')([^']*)(')/ },
  { file: 'docs/sw.js', pattern: /(const VERSION = ')([^']*)(')/ },
];

/** Rewrites the version in every target under root; returns [{file, from, to}]. Throws before writing anything on bad input. */
export function bumpVersion(version, root = resolve(dirname(fileURLToPath(import.meta.url)), '..')) {
  if (typeof version !== 'string' || !SEMVER.test(version)) {
    throw new Error(`Not a semver version: ${JSON.stringify(version)} (expected e.g. 0.2.0)`);
  }
  const updates = TARGETS.map(({ file, pattern }) => {
    const path = join(root, file);
    const source = readFileSync(path, 'utf8');
    const match = source.match(pattern);
    if (!match) throw new Error(`${file}: version field not found`);
    const text = source.replace(pattern, (_m, before, _old, after) => `${before}${version}${after}`);
    return { file, path, from: match[2], to: version, text };
  });
  for (const update of updates) writeFileSync(update.path, update.text);
  return updates.map(({ file, from, to }) => ({ file, from, to }));
}

function main(argv) {
  const version = argv[0];
  if (!version) {
    process.stderr.write('Usage: node tools/bump-version.mjs <semver>\n');
    process.exit(2);
  }
  try {
    for (const { file, from, to } of bumpVersion(version)) process.stdout.write(`${file}: ${from} -> ${to}\n`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2));
