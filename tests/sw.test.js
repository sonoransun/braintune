// docs/sw.js in the vm harness: precache, activation, fetch routing, offline fallback and SKIP_WAITING.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SW_URL, SwRequest, loadServiceWorker } from './helpers/sw-host.js';

const SW_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'sw.js');
const ROOT_URL = new URL('./', SW_URL).href; // https://user.github.io/braintune/
const OFFLINE_TEXT = 'Brain Tune is offline and this file is not cached.';

/** Worker metadata with SHELL copied into a host-realm array (vm arrays fail deepStrictEqual on prototype). */
const meta = (host) => {
  const { VERSION, CACHE, SHELL } = host.self.__BRAINTUNE_SW;
  return { VERSION, CACHE, SHELL: [...SHELL] };
};
const bodyFor = (url) => `contents of ${url}`;
const navigate = (url) => new SwRequest(url, { mode: 'navigate' });

/** A fake network holding every SHELL file (optionally minus one) plus any extras. */
function shellFiles({ omit, extra = {} } = {}) {
  const files = new Map();
  for (const url of meta(loadServiceWorker(SW_PATH)).SHELL) {
    if (url !== omit) files.set(url, { status: 200, body: bodyFor(url) });
  }
  for (const [url, body] of Object.entries(extra)) files.set(url, { status: 200, body });
  return files;
}

async function installedHost(options = {}) {
  const host = loadServiceWorker(SW_PATH, { files: shellFiles(options), online: true });
  await host.trigger('install');
  return host;
}

describe('sw.js metadata', () => {
  test('CACHE is braintune-v + VERSION and SHELL is a clean list of relative paths', () => {
    const { VERSION, CACHE, SHELL } = meta(loadServiceWorker(SW_PATH));
    assert.match(VERSION, /^\d+\.\d+\.\d+/);
    assert.equal(CACHE, `braintune-v${VERSION}`);
    assert.ok(SHELL.length > 0, 'SHELL is empty');
    assert.equal(new Set(SHELL).size, SHELL.length, 'SHELL contains duplicates');
    assert.ok(SHELL.includes('./index.html'), 'SHELL must include ./index.html');
    assert.ok(!SHELL.includes('./sw.js'), 'the worker must not precache itself');
    for (const url of SHELL) {
      assert.match(url, /^\.\/[^?#]+$/, `${url}: SHELL entries are ./relative paths without query or hash`);
      assert.ok(!url.includes('..'), `${url}: SHELL entries stay inside docs/`);
    }
  });
});

describe('install', () => {
  test('precaches exactly SHELL, every request with cache: "reload"', async () => {
    const host = await installedHost();
    const { CACHE, SHELL } = meta(host);
    assert.deepEqual(await host.caches.keys(), [CACHE]);
    const cache = await host.caches.open(CACHE);
    const cached = (await cache.keys()).map((request) => request.url).sort();
    const expected = SHELL.map((url) => new URL(url, SW_URL).href).sort();
    assert.deepEqual(cached, expected);
    assert.equal(host.fetchCalls.length, SHELL.length);
    for (const call of host.fetchCalls) {
      assert.equal(call.cache, 'reload', `${call.url} was not fetched with cache: 'reload'`);
    }
  });

  test('is atomic: one 404 rejects the install and nothing is cached', async () => {
    const { SHELL, CACHE } = meta(loadServiceWorker(SW_PATH));
    const omit = SHELL.find((url) => url !== './index.html');
    const host = loadServiceWorker(SW_PATH, { files: shellFiles({ omit }) });
    await assert.rejects(host.trigger('install'), /404/);
    const cache = await host.caches.open(CACHE);
    assert.equal((await cache.keys()).length, 0);
  });

  test('rejects while offline', async () => {
    const host = loadServiceWorker(SW_PATH, { files: shellFiles(), online: false });
    await assert.rejects(host.trigger('install'));
  });
});

describe('activate', () => {
  test('deletes only braintune-* caches other than the current one, then claims clients', async () => {
    const host = await installedHost();
    const { CACHE } = meta(host);
    await host.caches.open('braintune-v0.0.1');
    await host.caches.open('braintune-v9.9.9');
    await host.caches.open('other-project-v3');
    await host.trigger('activate');
    assert.deepEqual((await host.caches.keys()).sort(), [CACHE, 'other-project-v3'].sort());
    assert.equal(host.claimCalls.length, 1);
  });
});

describe('fetch', () => {
  test('ignores non-GET and cross-origin requests', async () => {
    const host = await installedHost();
    const before = host.fetchCalls.length;
    assert.equal(await host.trigger('fetch', { request: new SwRequest('./index.html', { method: 'POST' }) }), undefined);
    assert.equal(await host.trigger('fetch', { request: new SwRequest('https://cdn.example.com/lib.js') }), undefined);
    assert.equal(await host.trigger('fetch', { request: navigate('https://example.com/braintune/') }), undefined);
    assert.equal(host.fetchCalls.length, before, 'ignored requests must not be fetched by the worker');
  });

  test('root navigations get the cached index.html, with or without a query, even offline', async () => {
    const host = await installedHost();
    host.setOnline(false);
    for (const url of [ROOT_URL, `${ROOT_URL}index.html`, `${ROOT_URL}?gallery=cats`, `${ROOT_URL}index.html?v=2`]) {
      const response = await host.trigger('fetch', { request: navigate(url) });
      assert.ok(response, `${url} was not handled`);
      assert.equal(response.status, 200, `${url} status`);
      assert.equal(await response.text(), bodyFor('./index.html'), `${url} body`);
    }
  });

  test('deep navigations are left to the network', async () => {
    const host = await installedHost();
    assert.equal(await host.trigger('fetch', { request: navigate(`${ROOT_URL}guide/`) }), undefined);
    assert.equal(await host.trigger('fetch', { request: navigate(`${ROOT_URL}index.htm`) }), undefined);
    assert.equal(await host.trigger('fetch', { request: navigate('https://user.github.io/other-site/') }), undefined);
  });

  test('cached assets come from the cache, ignoring the query string', async () => {
    const host = await installedHost();
    const asset = meta(host).SHELL.find((url) => url.endsWith('.css')) ?? meta(host).SHELL[1];
    host.setOnline(false);
    const before = host.fetchCalls.length;
    for (const url of [asset, `${asset}?v=2`]) {
      const response = await host.trigger('fetch', { request: new SwRequest(url) });
      assert.equal(response.status, 200, `${url} status`);
      assert.equal(await response.text(), bodyFor(asset), `${url} body`);
    }
    assert.equal(host.fetchCalls.length, before, 'cache hits must not touch the network');
  });

  test('uncached requests go to the network when online', async () => {
    const host = await installedHost({ extra: { './extra.json': '{"ok":true}' } });
    const response = await host.trigger('fetch', { request: new SwRequest('./extra.json') });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), '{"ok":true}');
    assert.ok(host.fetchCalls.some((call) => call.url === `${ROOT_URL}extra.json`));
  });

  test('offline miss answers 503 with a plain-text explanation', async () => {
    const host = await installedHost();
    host.setOnline(false);
    const response = await host.trigger('fetch', { request: new SwRequest('./missing.txt') });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('content-type'), 'text/plain');
    assert.equal(await response.text(), OFFLINE_TEXT);
  });
});

describe('message', () => {
  test('SKIP_WAITING calls skipWaiting(); other messages are ignored', async () => {
    const host = loadServiceWorker(SW_PATH);
    await host.trigger('message', { data: { type: 'PING' } });
    await host.trigger('message', { data: null });
    await host.trigger('message', {});
    assert.equal(host.skipWaitingCalls.length, 0);
    await host.trigger('message', { data: { type: 'SKIP_WAITING' } });
    assert.equal(host.skipWaitingCalls.length, 1);
  });
});

describe('self-healing cache (a settings Reset must never cost offline support)', () => {
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  test('a shell asset missing from the cache is served from the network and re-cached while online', async () => {
    const host = await installedHost();
    const { CACHE, SHELL } = meta(host);
    const asset = SHELL.find((url) => url.endsWith('.css'));
    const cache = await host.caches.open(CACHE);
    assert.ok(await cache.delete(asset), 'precondition: entry removed from the cache');
    const response = await host.trigger('fetch', { request: new SwRequest(asset) });
    assert.equal(response.status, 200);
    assert.equal(await response.text(), bodyFor(asset));
    await tick();
    assert.ok(await cache.match(asset), 'asset re-cached after the network hit');
    host.setOnline(false);
    const offline = await host.trigger('fetch', { request: new SwRequest(asset) });
    assert.equal(offline.status, 200, 'served from the refilled cache while offline');
  });

  test('a root navigation with an empty cache re-fills index.html while online', async () => {
    const host = await installedHost();
    const { CACHE } = meta(host);
    const cache = await host.caches.open(CACHE);
    assert.ok(await cache.delete('./index.html'), 'precondition: index.html removed');
    const response = await host.trigger('fetch', { request: navigate(ROOT_URL) });
    assert.equal(response.status, 200);
    await tick();
    assert.ok(await cache.match('./index.html'), 'index.html re-cached');
  });

  test('files outside the shell are never added to the cache', async () => {
    const host = await installedHost({ extra: { './extra.json': '{"ok":true}' } });
    const { CACHE } = meta(host);
    await host.trigger('fetch', { request: new SwRequest('./extra.json') });
    await tick();
    const cache = await host.caches.open(CACHE);
    assert.equal(await cache.match('./extra.json'), undefined);
  });
});
