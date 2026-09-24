import { afterEach, describe, expect, it } from 'vitest';

/**
 * Pins the repair in src/setupTests.ts. On a Node version that ships its own web storage globals
 * (26 and later), an unrepaired harness leaves `globalThis.localStorage` holding Node's undefined
 * value and `globalThis.sessionStorage` holding Node's store rather than the document's, and every
 * storage-backed test fails. On Node 20 the globals do not exist and these assertions hold either
 * way, so this file reports the repair rather than the platform.
 */
const documentWindow = (globalThis as { jsdom?: { window: Window } }).jsdom?.window;

describe('jsdom storage harness', () => {
  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('exposes the JSDOM instance the repair reads the document stores from', () => {
    expect(documentWindow).toBeDefined();
  });

  it.each(['localStorage', 'sessionStorage'] as const)(
    'resolves %s on the global to the document store',
    (name) => {
      expect(globalThis[name]).toBe(documentWindow?.[name]);
      expect(globalThis[name]).toBeInstanceOf(Storage);
    },
  );

  it('round-trips a value written through the global and read through the document', () => {
    localStorage.setItem('ylabs-harness-probe', 'written-through-the-global');

    expect(documentWindow?.localStorage.getItem('ylabs-harness-probe')).toBe(
      'written-through-the-global',
    );
    expect(localStorage.length).toBe(1);
    expect(localStorage.key(0)).toBe('ylabs-harness-probe');
  });

  it('keeps the two stores separate', () => {
    sessionStorage.setItem('ylabs-harness-probe', 'session-only');

    expect(localStorage.getItem('ylabs-harness-probe')).toBeNull();
    expect(sessionStorage.getItem('ylabs-harness-probe')).toBe('session-only');
  });
});
