/**
 * Installs a working `localStorage` and `sessionStorage` when the test
 * environment's own are unusable (#3187).
 *
 * Node 22 added both as globals of its own. `localStorage` is an accessor that
 * warns and returns `undefined` unless the process was started with
 * `--localstorage-file`, and `sessionStorage` resolves to Node's store rather
 * than the document's. Vitest's jsdom environment skips any window key already
 * present on `globalThis`, so those globals win and jsdom's storage never becomes
 * reachable. Under that environment `window`, `globalThis` and
 * `document.defaultView` are one object, so there is no second place to read the
 * real store from, and jsdom's `Storage` refuses construction with "Illegal
 * constructor", so the store cannot be borrowed either.
 *
 * The install condition is `instanceof Storage` against this realm's `Storage`,
 * not a `typeof` or a constructor-name check: Node's own store is also *named*
 * `Storage`, so the name cannot tell them apart. Measured, that discriminator
 * reads true for both stores on Node 20, where this module is a no-op and jsdom
 * keeps its own storage, and false for both on Node 26.
 */

class InMemoryWebStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  key(index: number): string | null {
    if (!Number.isFinite(index)) return null;
    return Array.from(this.entries.keys())[Math.trunc(index)] ?? null;
  }

  getItem(key: string): string | null {
    const value = this.entries.get(String(key));
    return value === undefined ? null : value;
  }

  /**
   * The spec coerces both key and value to strings, so `setItem('n', 1)` has to
   * read back as the string `'1'` rather than the number.
   */
  setItem(key: string, value: string): void {
    this.entries.set(String(key), String(value));
  }

  removeItem(key: string): void {
    this.entries.delete(String(key));
  }

  clear(): void {
    this.entries.clear();
  }
}

/**
 * Judged against the Storage constructor of the object being installed onto, not
 * against `globalThis`'s, so the answer is about one realm rather than a mix of
 * two.
 */
export function webStorageIsUsable(candidate: unknown, StorageCtor: unknown): boolean {
  return typeof StorageCtor === 'function' && candidate instanceof (StorageCtor as never);
}

export function installWebStorageForTests(target: typeof globalThis = globalThis): string[] {
  const StorageCtor = (target as { Storage?: unknown }).Storage;
  const installed: string[] = [];
  for (const name of ['localStorage', 'sessionStorage'] as const) {
    if (webStorageIsUsable((target as Record<string, unknown>)[name], StorageCtor)) continue;
    Object.defineProperty(target, name, {
      value: new InMemoryWebStorage(),
      configurable: true,
      writable: true,
      enumerable: true,
    });
    installed.push(name);
  }
  return installed;
}
