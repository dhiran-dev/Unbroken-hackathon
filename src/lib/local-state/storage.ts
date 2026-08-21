/**
 * Internal localStorage helpers shared by the browser-local modules.
 *
 * Every access is lazy and guarded so these helpers (and every module that
 * imports them) can be evaluated during SSR without touching `window`.
 * Storage failures (quota, privacy mode, disabled storage) degrade to no-ops.
 */

/** Returns `window.localStorage`, or `null` on the server / when unavailable. */
export function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Accessing localStorage itself can throw (Safari private mode, hardened browsers).
    return null;
  }
}

/** True when a writable localStorage exists in the current runtime. */
export function hasLocalStorage(): boolean {
  return getLocalStorage() !== null;
}

/**
 * Reads and JSON-parses a key. Returns `undefined` when storage is
 * unavailable, the key is missing, or the payload is corrupt — callers treat
 * all three identically as "no data".
 */
export function readJsonStorage(key: string): unknown {
  const storage = getLocalStorage();
  if (!storage) return undefined;
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return undefined;
  }
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}

/** Serializes and writes a key. Returns false when storage is unavailable or the write fails. */
export function writeJsonStorage(key: string, value: unknown): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Removes a key. Returns false when storage is unavailable or the remove fails. */
export function removeStorageKey(key: string): boolean {
  const storage = getLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
