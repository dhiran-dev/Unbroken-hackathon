/**
 * Shared test helpers for the local-state suite. The repo does not ship a
 * full DOM environment, so browser storage is faked here and installed onto
 * `globalThis.window` per test — mirroring exactly what the library reads.
 */

/** Minimal Map-backed localStorage stand-in (no `implements Storage`, to keep TS happy). */
export class MockLocalStorage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.has(key) ? (this.values.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value));
  }

  /** Direct backdoor for seeding corrupt payloads. */
  seedRaw(key: string, raw: string): void {
    this.setItem(key, raw);
  }
}

interface WindowWithStorage {
  window?: { localStorage?: unknown };
}

export function installBrowserStorage(
  storage: MockLocalStorage = new MockLocalStorage(),
): MockLocalStorage {
  (globalThis as unknown as WindowWithStorage).window = { localStorage: storage };
  return storage;
}

export function uninstallBrowserStorage(): void {
  delete (globalThis as unknown as WindowWithStorage).window;
}
