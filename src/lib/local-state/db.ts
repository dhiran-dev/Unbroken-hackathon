/**
 * Internal IndexedDB plumbing shared by the browser-local stores.
 *
 * All stores live in one database (`pulserank`, version 1) so a single
 * `upgradeneeded` pass creates them together. Opening from any module is safe
 * regardless of which module runs first, and every entry point resolves to
 * `null` instead of throwing when IndexedDB does not exist (SSR, tests) so
 * callers can degrade to no-ops.
 *
 * This file is internal to `lib/local-state`; consume the feature modules
 * (`saved-products`, `my-day`, `recently-viewed`) instead.
 */

/** IndexedDB database name holding every PulseRank object store. */
export const PULSERANK_DB_NAME = "pulserank";

/** IndexedDB database schema version. Bump when adding/migrating stores. */
export const PULSERANK_DB_VERSION = 1;

/** Object store of {@link ./saved-products!StoredSavedProduct}, keyed by `slug`. */
export const SAVED_PRODUCTS_STORE = "saved-products";

/** Object store of {@link ./my-day!MyDayRecord}, keyed by `id`. */
export const MY_DAY_STORE = "my-day";

/** Object store of {@link ./recently-viewed!RecentlyViewedRecord}, keyed by `slug`. */
export const RECENTLY_VIEWED_STORE = "recently-viewed";

/** Secondary index over `savedAt` timestamps in {@link SAVED_PRODUCTS_STORE}. */
export const SAVED_PRODUCTS_SAVED_AT_INDEX = "savedAt";

/** Secondary index over date strings in {@link MY_DAY_STORE}. */
export const MY_DAY_DATE_INDEX = "date";

/** Secondary index over `viewedAt` timestamps in {@link RECENTLY_VIEWED_STORE}. */
export const RECENTLY_VIEWED_VIEWED_AT_INDEX = "viewedAt";

interface StoreSpec {
  readonly name: string;
  readonly keyPath: string;
  readonly indexes: readonly { readonly name: string; readonly keyPath: string }[];
}

const STORE_SPECS: readonly StoreSpec[] = [
  {
    name: SAVED_PRODUCTS_STORE,
    keyPath: "slug",
    indexes: [{ name: SAVED_PRODUCTS_SAVED_AT_INDEX, keyPath: "savedAt" }],
  },
  {
    name: MY_DAY_STORE,
    keyPath: "id",
    indexes: [{ name: MY_DAY_DATE_INDEX, keyPath: "date" }],
  },
  {
    name: RECENTLY_VIEWED_STORE,
    keyPath: "slug",
    indexes: [{ name: RECENTLY_VIEWED_VIEWED_AT_INDEX, keyPath: "viewedAt" }],
  },
];

let openPromise: Promise<IDBDatabase> | null = null;

/** True when an IndexedDB factory exists in the current runtime. */
export function isIndexedDbAvailable(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined";
}

function openDatabase(): Promise<IDBDatabase> {
  if (!openPromise) {
    const promise = new Promise<IDBDatabase>((resolve, reject) => {
      let request: IDBOpenDBRequest;
      try {
        request = globalThis.indexedDB.open(PULSERANK_DB_NAME, PULSERANK_DB_VERSION);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Failed to open IndexedDB database"));
        return;
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const spec of STORE_SPECS) {
          if (db.objectStoreNames.contains(spec.name)) continue;
          const store = db.createObjectStore(spec.name, { keyPath: spec.keyPath });
          for (const index of spec.indexes) {
            store.createIndex(index.name, index.keyPath);
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          if (openPromise === promise) openPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        openPromise = null;
        reject(request.error ?? new Error("Failed to open IndexedDB database"));
      };
      request.onblocked = () => {
        openPromise = null;
        reject(new Error("IndexedDB upgrade blocked by another open connection"));
      };
    });
    openPromise = promise;
  }
  return openPromise;
}

/**
 * Resolves the shared `pulserank` database, creating its stores on first open,
 * or `null` when IndexedDB is unavailable/opening fails. Callers must treat
 * `null` as "feature silently unavailable" (the SSR no-op path) and never throw.
 */
export async function withDatabase(): Promise<IDBDatabase | null> {
  if (!isIndexedDbAvailable()) return null;
  try {
    return await openDatabase();
  } catch {
    return null;
  }
}

/** Wraps an IDBRequest in a promise rejecting with the request's error. */
export function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

/** Resolves when the transaction commits; rejects on abort/error. */
export function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
  });
}
