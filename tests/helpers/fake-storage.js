// Storage-like test doubles for the settings store.

/** In-memory Storage look-alike; initial values that are not strings are JSON-encoded. */
export function createFakeStorage(initial = {}) {
  const data = new Map();
  for (const [key, value] of Object.entries(initial)) {
    data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  return {
    data,
    getItem(key) {
      return data.has(String(key)) ? data.get(String(key)) : null;
    },
    setItem(key, value) {
      data.set(String(key), String(value));
    },
    removeItem(key) {
      data.delete(String(key));
    },
    clear() {
      data.clear();
    },
    key(index) {
      return [...data.keys()][index] ?? null;
    },
    get length() {
      return data.size;
    },
  };
}

/** Storage whose every access throws, as a blocked or full browser store would. */
export function throwingStorage() {
  const fail = () => {
    throw new Error('storage unavailable');
  };
  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
    clear: fail,
    key: fail,
    get length() {
      return 0;
    },
  };
}
