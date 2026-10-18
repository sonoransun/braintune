// Brain Tune service worker: a classic script (no imports) with a versioned, atomic precache of the app shell.
// Cache and storage names carry the braintune- prefix because every project site of one GitHub user shares an origin.
'use strict';

const VERSION = '0.4.0';
const CACHE = 'braintune-v' + VERSION;
const ROOT = new URL('./', self.location).pathname;
const OFFLINE_MESSAGE = 'Brain Tune is offline and this file is not cached.';

// Every file published from docs/ except sw.js, .nojekyll and CNAME (tests/site.test.js keeps this list honest).
const SHELL = [
  './index.html',
  './manifest.webmanifest',
  './favicon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  './css/tokens.css',
  './css/base.css',
  './css/layout.css',
  './css/components.css',
  './css/scene.css',
  './css/cats.css',
  './js/boot.js',
  './js/app.js',
  './js/version.js',
  './js/sw-register.js',
  './js/core/rng.js',
  './js/core/toon-art.js',
  './js/core/noise.js',
  './js/core/biquad.js',
  './js/core/levels.js',
  './js/core/timbres.js',
  './js/core/voicing.js',
  './js/core/gate.js',
  './js/core/entrainment.js',
  './js/core/presets.js',
  './js/core/rain-model.js',
  './js/core/ocean-model.js',
  './js/core/purr-model.js',
  './js/core/timer-core.js',
  './js/core/scheduler-core.js',
  './js/core/state.js',
  './js/core/microcopy.js',
  './js/core/keyboard-map.js',
  './js/core/toast-queue.js',
  './js/core/palette.js',
  './js/core/scene-model.js',
  './js/core/cat-model.js',
  './js/core/cat-art.js',
  './js/core/sweep.js',
  './js/core/fractal.js',
  './js/core/texture-model.js',
  './js/core/entrance.js',
  './js/core/canon.js',
  './js/core/shimmer.js',
  './js/core/dim-model.js',
  './js/audio/graph.js',
  './js/audio/automation.js',
  './js/audio/buffers.js',
  './js/audio/tone.js',
  './js/audio/rain.js',
  './js/audio/ocean.js',
  './js/audio/purr.js',
  './js/audio/texture.js',
  './js/audio/canon.js',
  './js/audio/session-timer.js',
  './js/audio/lifecycle.js',
  './js/audio/engine.js',
  './js/scene/scene.js',
  './js/cats/cats.js',
  './js/cats/toon.js',
  './js/ui/controls.js',
  './js/ui/orb.js',
  './js/ui/sheet.js',
  './js/ui/toast.js',
  './js/ui/firstrun.js',
  './js/ui/feedback.js',
  './js/ui/shortcuts.js',
  './js/ui/nightdim.js',
  './js/ui/ui.js',
];

/** Fetches every shell file past the HTTP cache (GitHub Pages serves max-age=600) and stores them atomically. */
function precache() {
  return caches.open(CACHE).then((cache) =>
    cache.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))),
  );
}

/** Removes the caches of earlier Brain Tune versions and leaves other projects' caches alone. */
function dropOldCaches() {
  return caches.keys().then((names) =>
    Promise.all(
      names
        .filter((name) => name.startsWith('braintune-') && name !== CACHE)
        .map((name) => caches.delete(name)),
    ),
  );
}

function offlineResponse() {
  return new Response(OFFLINE_MESSAGE, { status: 503, headers: { 'Content-Type': 'text/plain' } });
}

/** True for the app's own page: the scope root or its index.html (query strings allowed). */
function isShellPage(url) {
  return url.pathname === ROOT || url.pathname === ROOT + 'index.html';
}

// Absolute pathnames of the shell, so a cache miss while online can be healed (e.g. after storage was cleared).
const SHELL_PATHS = new Set(SHELL.map((url) => new URL(url, self.location).pathname));

/** Stores a good network response for a shell file under its query-less URL and passes the response through. */
function refill(cacheKey, response) {
  if (!response || !response.ok) return response;
  const copy = response.clone();
  caches.open(CACHE).then((cache) => cache.put(cacheKey, copy)).catch(() => {});
  return response;
}

function shellPage(request) {
  const indexUrl = new URL('./index.html', self.location).href;
  const fromNetwork = () =>
    fetch(indexUrl).then((response) => (response.ok ? refill(indexUrl, response) : fetch(request)));
  return caches
    .match('./index.html', { ignoreSearch: true })
    .then((cached) => cached || fromNetwork())
    .catch(offlineResponse);
}

function cacheFirst(request) {
  const url = new URL(request.url);
  const key = url.origin + url.pathname;
  return caches
    .match(request, { ignoreSearch: true })
    .then((cached) => cached || fetch(request).then((response) => (SHELL_PATHS.has(url.pathname) ? refill(key, response) : response)))
    .catch(offlineResponse);
}

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(dropOldCaches().then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if (isShellPage(url)) event.respondWith(shellPage(request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Read by the node:vm test harness (tests/helpers/sw-host.js); harmless in a browser.
self.__BRAINTUNE_SW = { VERSION, CACHE, SHELL };
