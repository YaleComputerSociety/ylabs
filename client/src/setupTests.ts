/**
 * Test environment setup for Vitest.
 */
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Node 26 ships `localStorage` and `sessionStorage` as its own globals, and `localStorage` reads
// as undefined unless the process was started with `--localstorage-file`. Vitest's jsdom
// environment only copies a window key onto `globalThis` when that key is absent there, so Node's
// pair wins and the document's own stores never become reachable. `window`, `globalThis` and
// `document.defaultView` are one object under that environment, but the environment also leaves
// the JSDOM instance on `globalThis.jsdom`, whose `window` is the real jsdom window, so the
// document's stores are reachable through it. Adopting them keeps every storage-backed test
// reading and writing the same per-file store on every supported Node version.
const adoptDocumentStorage = (): void => {
  const documentWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;
  if (!documentWindow) return;
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    const documentStore = documentWindow[name];
    if (!documentStore || globalThis[name] === documentStore) continue;
    Object.defineProperty(globalThis, name, {
      value: documentStore,
      writable: true,
      configurable: true,
    });
  }
};

adoptDocumentStorage();

// Testing Library defaults `waitFor` and `findBy*` to 1000ms. Page-level renders here mount a
// whole page plus its charts, and on a loaded machine that work has been measured past 1000ms,
// so the default made a passing suite report red for load rather than for behaviour. This budget
// is a ceiling, not a delay: it only costs wall clock when an assertion is genuinely not met.
const ASYNC_UTIL_TIMEOUT_MS = 5000;

configure({ asyncUtilTimeout: ASYNC_UTIL_TIMEOUT_MS });

// Node 22+ declares `localStorage` and `sessionStorage` as globals of its own, and `localStorage`
// reads as `undefined` unless the process was started with `--localstorage-file`. Vitest's jsdom
// environment skips any window key that already exists on `globalThis`, so on those Node versions
// that `undefined` wins and jsdom's own storage never becomes reachable: `window`, `globalThis`
// and `document.defaultView` are one object, so there is no second place to read it from. Supply a
// store instead. The guard keeps this inert wherever the global is already a real Storage,
// including the Node 20 that CI pins.
const createMemoryStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, String(value));
    },
    removeItem: (key: string) => {
      entries.delete(key);
    },
    clear: () => {
      entries.clear();
    },
  };
};

for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (typeof globalThis[key]?.getItem === 'function') continue;
  Object.defineProperty(globalThis, key, {
    value: createMemoryStorage(),
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  cleanup();
});
