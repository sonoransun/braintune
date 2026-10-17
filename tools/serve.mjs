#!/usr/bin/env node
// Zero-dependency static dev server for Brain Tune.
// Usage: node tools/serve.mjs --dir docs --port 8080 [--base /braintune/]
// Serves with Cache-Control: no-store so service-worker and HTTP caches never confuse development.
import { createServer } from 'node:http';
import { stat, readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';

const args = parseArgs(process.argv.slice(2));
const ROOT = resolve(args.dir ?? 'docs');
const PORT = Number(args.port ?? 8080);
const BASE = normalizeBase(args.base ?? '/');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = 'true';
    }
  }
  return out;
}

function normalizeBase(base) {
  let s = base.startsWith('/') ? base : `/${base}`;
  if (!s.endsWith('/')) s += '/';
  return s;
}

function send(res, status, type, text) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed');
    }
    const url = new URL(req.url, 'http://localhost');
    let pathname = decodeURIComponent(url.pathname);
    if (BASE !== '/') {
      if (pathname === BASE.slice(0, -1)) {
        res.writeHead(302, { Location: BASE });
        return res.end();
      }
      if (!pathname.startsWith(BASE)) {
        return send(res, 404, 'text/plain; charset=utf-8', `Not found. This server mounts the site at ${BASE}`);
      }
      pathname = `/${pathname.slice(BASE.length)}`;
    }
    let filePath = normalize(join(ROOT, pathname));
    if (filePath !== ROOT && !filePath.startsWith(ROOT + sep)) {
      return send(res, 403, 'text/plain; charset=utf-8', 'Forbidden');
    }
    let info = await stat(filePath).catch(() => null);
    if (info && info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const prefix = BASE === '/' ? '' : BASE.slice(0, -1);
        res.writeHead(302, { Location: `${prefix}${pathname}/` });
        return res.end();
      }
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info || !info.isFile()) {
      return send(res, 404, 'text/plain; charset=utf-8', 'Not found');
    }
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    send(res, 500, 'text/plain; charset=utf-8', `Server error: ${err.message}`);
  }
});

server.listen(PORT, () => {
  console.log(`Brain Tune dev server: http://localhost:${PORT}${BASE}  (serving ${ROOT}, Cache-Control: no-store)`);
});
