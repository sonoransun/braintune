// Service worker registration for Brain Tune: offline-ready and update notifications, hourly update checks,
// the ?nosw / #nosw kill switch, and the cache + storage reset behind Settings -> Reset all settings.

const SW_URL = './sw.js';
const CACHE_PREFIX = 'braintune-';
const STORAGE_PREFIX = 'braintune:';
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let reloading = false;

/** Registers ./sw.js (or honours the nosw kill switch); resolves with the registration, or null when there is none. */
export async function registerServiceWorker({ onOfflineReady, onUpdateReady } = {}) {
  if (!('serviceWorker' in navigator)) return null;
  if (hasKillSwitch(location)) {
    await disableServiceWorker();
    return null;
  }
  const hadController = Boolean(navigator.serviceWorker.controller);
  let registration;
  try {
    registration = await navigator.serviceWorker.register(SW_URL, { scope: './', updateViaCache: 'none' });
  } catch {
    return null;
  }
  if (!hadController) onceActivated(registration, onOfflineReady);
  watchForUpdates(registration, onUpdateReady);
  setInterval(() => registration.update().catch(() => {}), UPDATE_INTERVAL_MS);
  return registration;
}

/** Removes the braintune: storage keys (settings); failures are swallowed like every storage error. */
export async function resetBraintune({ storage } = {}) {
  // Settings only: the offline precache is left alone so a Reset never costs the user offline support.
  // Caches are purged by the ?nosw kill switch, and sw.js re-fills any shell file it misses while online.
  removeBraintuneKeys(storage);
}

function hasKillSwitch({ search, hash }) {
  return search.includes('nosw') || hash.includes('nosw');
}

/** Kill switch: unregister this app's workers, drop its caches, then reload the bare page without the flag. */
async function disableServiceWorker() {
  const scopeUrl = new URL('./', location.href).href;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.filter((r) => r.scope.startsWith(scopeUrl)).map((r) => r.unregister()));
  await deleteBraintuneCaches(globalThis.caches);
  location.replace(location.pathname);
}

/** First install: report once when the new worker reaches 'activated' and the page had no controller before. */
function onceActivated(registration, onOfflineReady) {
  if (typeof onOfflineReady !== 'function') return;
  const worker = registration.installing || registration.waiting || registration.active;
  if (!worker || worker.state === 'activated') return;
  worker.addEventListener('statechange', function onStateChange() {
    if (worker.state !== 'activated') return;
    worker.removeEventListener('statechange', onStateChange);
    onOfflineReady();
  });
}

/** A new version is waiting: hand the UI an apply() that activates it and reloads once. */
function watchForUpdates(registration, onUpdateReady) {
  if (typeof onUpdateReady !== 'function') return;
  registration.addEventListener('updatefound', () => {
    const worker = registration.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) {
        onUpdateReady(() => applyUpdate(registration, worker));
      }
    });
  });
}

function applyUpdate(registration, worker) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  (registration.waiting || worker).postMessage({ type: 'SKIP_WAITING' });
}

async function deleteBraintuneCaches(cacheStorage) {
  if (!cacheStorage) return;
  try {
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((name) => name.startsWith(CACHE_PREFIX)).map((name) => cacheStorage.delete(name)));
  } catch {
    // Cache storage unavailable or blocked: nothing to clear.
  }
}

function removeBraintuneKeys(storage) {
  if (!storage) return;
  try {
    const keys = [];
    for (let i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
    keys
      .filter((key) => typeof key === 'string' && key.startsWith(STORAGE_PREFIX))
      .forEach((key) => storage.removeItem(key));
  } catch {
    // Storage unavailable or blocked: nothing to clear.
  }
}
