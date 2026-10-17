// node:vm harness for docs/sw.js: a fresh context with fake self / caches / fetch / clients / location so the
// classic worker script runs in Node. Node's global Request rejects relative URLs and mode 'navigate', both of
// which a worker needs, so a minimal Request class stands in; Response and URL are Node's own.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

/** Where the worker is served in the fake origin; relative URLs resolve against it like in a real worker. */
export const SW_URL = 'https://user.github.io/braintune/sw.js';

/** Minimal Request: url resolved against the worker URL, plus method, mode and cache. */
export class SwRequest {
  constructor(input, init = {}) {
    const base = input instanceof SwRequest ? input : null;
    this.url = base ? base.url : new URL(String(input), SW_URL).href;
    this.method = (init.method ?? base?.method ?? 'GET').toUpperCase();
    this.mode = init.mode ?? base?.mode ?? 'cors';
    this.cache = init.cache ?? base?.cache ?? 'default';
  }

  clone() {
    return new SwRequest(this);
  }
}

/** Cache key of a request or URL string: absolute, no hash, optionally without the query. */
function keyOf(input, ignoreSearch = false) {
  const url = new URL(typeof input === 'string' ? new URL(input, SW_URL).href : input.url);
  url.hash = '';
  if (ignoreSearch) url.search = '';
  return url.href;
}

class FakeCache {
  #entries = new Map();

  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl;
  }

  /** Atomic like the real thing: one non-2xx response (or a network error) stores nothing. */
  async addAll(requests) {
    const responses = await Promise.all(requests.map((request) => this.fetchImpl(request)));
    const failed = responses.findIndex((response) => !response.ok);
    if (failed !== -1) {
      throw new TypeError(`addAll: ${requests[failed].url} responded with status ${responses[failed].status}`);
    }
    requests.forEach((request, i) => this.#entries.set(keyOf(request), responses[i]));
  }

  async put(request, response) {
    this.#entries.set(keyOf(request), response);
  }

  async match(request, { ignoreSearch = false } = {}) {
    const wanted = keyOf(request, ignoreSearch);
    for (const [href, response] of this.#entries) {
      if (keyOf(href, ignoreSearch) === wanted) return response.clone();
    }
    return undefined;
  }

  async keys() {
    return [...this.#entries.keys()].map((href) => new SwRequest(href));
  }

  async delete(request) {
    return this.#entries.delete(keyOf(request));
  }
}

class FakeCacheStorage {
  #caches = new Map();

  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl;
  }

  async open(name) {
    if (!this.#caches.has(name)) this.#caches.set(name, new FakeCache(this.fetchImpl));
    return this.#caches.get(name);
  }

  async has(name) {
    return this.#caches.has(name);
  }

  async keys() {
    return [...this.#caches.keys()];
  }

  async delete(name) {
    return this.#caches.delete(name);
  }

  async match(request, options) {
    for (const cache of this.#caches.values()) {
      const hit = await cache.match(request, options);
      if (hit) return hit;
    }
    return undefined;
  }
}

/**
 * Runs the worker at swPath in a fresh vm context.
 * files: Map<url, {status, body, headers?}> served by the fake network (keys relative to the worker URL or absolute).
 * Returns { self, caches, fetchCalls, trigger(event, props), skipWaitingCalls, claimCalls, setOnline(flag) }.
 */
export function loadServiceWorker(swPath, { files = new Map(), online = true } = {}) {
  const state = { online };
  const fetchCalls = [];
  const skipWaitingCalls = [];
  const claimCalls = [];
  const network = new Map([...files].map(([url, entry]) => [keyOf(url), entry]));

  const fetchImpl = async (input, init = {}) => {
    const request = input instanceof SwRequest ? input : new SwRequest(input, init);
    fetchCalls.push({ url: request.url, method: request.method, mode: request.mode, cache: request.cache });
    if (!state.online) throw new TypeError(`Failed to fetch ${request.url}: offline`);
    const entry = network.get(keyOf(request)) ?? network.get(keyOf(request, true));
    if (!entry) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain' } });
    return new Response(entry.body ?? '', { status: entry.status ?? 200, headers: entry.headers ?? {} });
  };

  const listeners = new Map();
  const sandbox = {
    location: new URL(SW_URL),
    caches: new FakeCacheStorage(fetchImpl),
    fetch: fetchImpl,
    clients: {
      claim: async () => {
        claimCalls.push(claimCalls.length + 1);
      },
      matchAll: async () => [],
    },
    skipWaiting: async () => {
      skipWaitingCalls.push(skipWaitingCalls.length + 1);
    },
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener: (type, fn) => {
      listeners.set(type, (listeners.get(type) ?? []).filter((candidate) => candidate !== fn));
    },
    Request: SwRequest,
    Response,
    URL,
    console,
  };
  sandbox.self = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(readFileSync(swPath, 'utf8'), context, { filename: swPath });

  /** Dispatches one event, awaits every waitUntil()/respondWith(), and returns the Response for fetch events. */
  async function trigger(type, props = {}) {
    const pending = [];
    let response;
    const event = {
      type,
      ...props,
      waitUntil(promise) {
        pending.push(Promise.resolve(promise));
      },
      respondWith(promise) {
        response = Promise.resolve(promise);
        pending.push(response);
      },
    };
    for (const fn of listeners.get(type) ?? []) fn(event);
    await Promise.all(pending);
    return response ? response : undefined;
  }

  return {
    self: sandbox,
    caches: sandbox.caches,
    fetchCalls,
    trigger,
    skipWaitingCalls,
    claimCalls,
    setOnline(flag) {
      state.online = flag;
    },
  };
}
