import { describe, expect, it } from 'vitest';
import { installWebStorageForTests, webStorageIsUsable } from '../webStorageForTests';

/**
 * A stand-in for Node's own store: it satisfies the Storage interface and its
 * constructor is even *named* `Storage`, which is why the install condition tests
 * `instanceof` against this realm's `Storage` rather than a constructor name.
 */
const foreignStorage = () => {
  const Storage = class {
    length = 0;
    key() {
      return null;
    }
    getItem() {
      return null;
    }
    setItem() {}
    removeItem() {}
    clear() {}
  };
  return new Storage();
};

/** A realm whose own Storage instances are, by construction, usable in it. */
const realmWithStorage = () => {
  const Storage = class {
    length = 0;
    key() {
      return null;
    }
    getItem() {
      return null;
    }
    setItem() {}
    removeItem() {}
    clear() {}
  };
  return { Storage, localStorage: new Storage(), sessionStorage: new Storage() };
};

describe('webStorageIsUsable', () => {
  /**
   * Version-independent on purpose: on Node 20 the environment supplies jsdom's
   * Storage and on Node 26 it supplies the installed stand-in, so the invariant
   * the suite depends on is that storage round-trips, not which class provides it.
   */
  it('leaves the running suite with storage that round-trips', () => {
    globalThis.localStorage.setItem('probe', 'value');
    expect(globalThis.localStorage.getItem('probe')).toBe('value');
    globalThis.localStorage.removeItem('probe');
    globalThis.sessionStorage.setItem('probe', 'value');
    expect(globalThis.sessionStorage.getItem('probe')).toBe('value');
    globalThis.sessionStorage.removeItem('probe');
  });

  it('accepts an instance of the realm s own Storage', () => {
    const realm = realmWithStorage();
    expect(webStorageIsUsable(realm.localStorage, realm.Storage)).toBe(true);
  });

  it('refuses undefined and a foreign store whose constructor is also named Storage', () => {
    const realm = realmWithStorage();
    expect(webStorageIsUsable(undefined, realm.Storage)).toBe(false);
    const foreign = foreignStorage();
    expect(foreign.constructor.name).toBe('Storage');
    expect(webStorageIsUsable(foreign, realm.Storage)).toBe(false);
  });

  it('refuses everything when the realm has no Storage constructor at all', () => {
    expect(webStorageIsUsable(foreignStorage(), undefined)).toBe(false);
  });
});

describe('installWebStorageForTests', () => {
  it('installs nothing when both stores are already the realm s own Storage', () => {
    expect(installWebStorageForTests(realmWithStorage() as never)).toEqual([]);
  });

  it('installs over an absent localStorage and a foreign sessionStorage', () => {
    const target = {
      Storage: realmWithStorage().Storage,
      sessionStorage: foreignStorage(),
    } as never;

    expect(installWebStorageForTests(target)).toEqual(['localStorage', 'sessionStorage']);
    const installed = target as unknown as typeof globalThis;
    expect(typeof installed.localStorage.setItem).toBe('function');
    expect(typeof installed.sessionStorage.setItem).toBe('function');
  });

  it('gives each installed store spec behaviour, including string coercion', () => {
    const target = { Storage: realmWithStorage().Storage } as never;
    installWebStorageForTests(target);
    const store = (target as unknown as typeof globalThis).localStorage;

    expect(store.getItem('absent')).toBeNull();
    store.setItem('count', 1 as unknown as string);
    expect(store.getItem('count')).toBe('1');
    expect(store.length).toBe(1);
    expect(store.key(0)).toBe('count');
    expect(store.key(9)).toBeNull();

    store.setItem('second', 'two');
    store.removeItem('count');
    expect(store.getItem('count')).toBeNull();
    expect(store.length).toBe(1);

    store.clear();
    expect(store.length).toBe(0);
  });

  it('gives the two stores separate state', () => {
    const target = { Storage: realmWithStorage().Storage } as never;
    installWebStorageForTests(target);
    const installed = target as unknown as typeof globalThis;

    installed.localStorage.setItem('shared-key', 'local');
    expect(installed.sessionStorage.getItem('shared-key')).toBeNull();
  });
});
