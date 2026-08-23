/**
 * Whole-store export/import for PulseRank browser-local state.
 *
 * `exportAll()` produces a versioned JSON envelope containing preferences,
 * the compare tray, and every IndexedDB store. `importAll()` validates an
 * envelope against the schema and restores it.
 *
 * Envelope shape:
 * ```json
 * {
 *   "pulserankLocalStateVersion": 1,
 *   "exportedAt": "2026-08-21T12:00:00.000Z",
 *   "preferences": { "theme": "dark" },
 *   "compare": ["slug-a", "slug-b"],
 *   "savedProducts": [{ "slug": "...", "...SavedProductRef": "", "savedAt": 1755000000000 }],
 *   "myDay": [{ "slug": "...", "id": "...", "date": "2026-08-21", "createdAt": 0 }],
 *   "recentlyViewed": [{ "slug": "...", "viewedAt": 0, "ref": { "...SavedProductRef": "" } }]
 * }
 * ```
 *
 * Validation policy: structural violations (non-object envelope, unsupported
 * version, missing `exportedAt`, section present but not an array) reject the
 * whole import; individual records that fail their record-level sanitizer are
 * dropped silently so one bad row cannot lose a user's whole backup.
 *
 * Reads remain SSR-safe, while `exportAll` deliberately throws when required
 * browser storage is unavailable; `importAll` reports unavailable sections in
 * its `errors` array instead of claiming a complete restore.
 */

import {
  MY_DAY_STORE,
  RECENTLY_VIEWED_STORE,
  SAVED_PRODUCTS_STORE,
  requestToPromise,
  transactionToPromise,
  inspectIndexedDb,
  withDatabase,
} from "./db";
import { PULSERANK_LOCAL_STATE_VERSION } from "./keys";
import type { MyDayRecord } from "./my-day";
import { listMyDayRecords, sanitizeMyDayRecord } from "./my-day";
import { getCompareSlugs, replaceCompareSlugs, sanitizeCompareSlugs } from "./compare";
import { inspectLocalStorage } from "./storage";
import {
  loadPreferences,
  savePreferences,
  sanitizePreferences,
  type PulsePreferences,
} from "./preferences";
import type { RecentlyViewedRecord } from "./recently-viewed";
import {
  RECENTLY_VIEWED_CAP,
  listRecentlyViewed,
  sanitizeRecentlyViewedRecord,
} from "./recently-viewed";
import type { StoredSavedProduct } from "./saved-products";
import {
  listSavedProducts,
  sanitizeStoredSavedProduct,
} from "./saved-products";

/** Envelope field carrying the schema version. */
export const PULSERANK_LOCAL_STATE_ENVELOPE_KEY = "pulserankLocalStateVersion";

/** Versioned snapshot of everything stored by this layer. */
export interface PulserankLocalStateEnvelope {
  pulserankLocalStateVersion: typeof PULSERANK_LOCAL_STATE_VERSION;
  /** ISO timestamp of when the export was produced. */
  exportedAt: string;
  /** `null` when nothing was stored (or when exported on the server). */
  preferences: PulsePreferences | null;
  compare: string[];
  savedProducts: StoredSavedProduct[];
  myDay: MyDayRecord[];
  recentlyViewed: RecentlyViewedRecord[];
}

/** Per-store write counts reported by {@link importAll}. */
export interface ImportSummary {
  preferences: boolean;
  compare: number;
  savedProducts: number;
  myDay: number;
  recentlyViewed: number;
  /** Store-level failures; successful sections may still have been restored. */
  errors: string[];
}

export type EnvelopeValidationResult =
  | { ok: true; envelope: PulserankLocalStateEnvelope }
  | { ok: false; error: string };

function sanitizeArraySection<T>(
  value: unknown,
  sanitize: (item: unknown) => T | null,
): T[] {
  if (!Array.isArray(value)) return [];
  const items: T[] = [];
  for (const item of value) {
    const sanitized = sanitize(item);
    if (sanitized !== null) items.push(sanitized);
  }
  return items;
}

/**
 * Pure envelope validation. Returns a discriminated result instead of
 * throwing; see the module docstring for the reject-vs-drop policy.
 */
export function validateLocalStateEnvelope(value: unknown): EnvelopeValidationResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { ok: false, error: "Envelope must be a JSON object" };
  }
  const record = value as Record<string, unknown>;

  const version = record[PULSERANK_LOCAL_STATE_ENVELOPE_KEY];
  if (
    typeof version !== "number" ||
    !Number.isInteger(version) ||
    version !== PULSERANK_LOCAL_STATE_VERSION
  ) {
    return {
      ok: false,
      error:
        `Unsupported ${PULSERANK_LOCAL_STATE_ENVELOPE_KEY}: expected `
        + `${PULSERANK_LOCAL_STATE_VERSION}, received ${JSON.stringify(version) ?? "undefined"}`,
    };
  }

  const exportedAt = record["exportedAt"];
  if (typeof exportedAt !== "string" || exportedAt.length === 0) {
    return { ok: false, error: "exportedAt must be a non-empty ISO timestamp string" };
  }

  const rawPreferences = record["preferences"];
  if (
    rawPreferences !== undefined &&
    rawPreferences !== null &&
    (typeof rawPreferences !== "object" || Array.isArray(rawPreferences))
  ) {
    return { ok: false, error: "preferences must be an object or null" };
  }

  for (const section of ["compare", "savedProducts", "myDay", "recentlyViewed"] as const) {
    const raw = record[section];
    if (raw !== undefined && !Array.isArray(raw)) {
      return { ok: false, error: `${section} must be an array` };
    }
  }

  return {
    ok: true,
    envelope: {
      pulserankLocalStateVersion: PULSERANK_LOCAL_STATE_VERSION,
      exportedAt,
      // A corrupt preference payload sanitizes to defaults rather than rejecting.
      preferences:
        rawPreferences === undefined || rawPreferences === null
          ? null
          : sanitizePreferences(rawPreferences),
      // Canonicalized through the same sanitizer the compare tray uses:
      // strings only, trimmed, deduplicated, capped at MAX_COMPARE_ITEMS.
      compare: sanitizeCompareSlugs(record["compare"] ?? []),
      savedProducts: sanitizeArraySection(
        record["savedProducts"] ?? [],
        sanitizeStoredSavedProduct,
      ),
      myDay: sanitizeArraySection(record["myDay"] ?? [], sanitizeMyDayRecord),
      recentlyViewed: sanitizeArraySection(
        record["recentlyViewed"] ?? [],
        sanitizeRecentlyViewedRecord,
      ),
    },
  };
}

/**
 * Serializes every store and preference into one versioned envelope. A backup
 * is refused when required browser storage is unavailable or unreadable so a
 * successful-looking empty file can never replace a user's real data.
 */
export async function exportAll(): Promise<PulserankLocalStateEnvelope> {
  const local = inspectLocalStorage();
  if (local.status !== "available") {
    throw new Error(`Export unavailable: localStorage is ${local.status}.`);
  }
  const indexedDb = await inspectIndexedDb();
  if (indexedDb.status !== "available") {
    throw new Error(`Export unavailable: IndexedDB is ${indexedDb.status}.`);
  }
  const db = await withDatabase();
  if (!db) throw new Error("Export unavailable: IndexedDB could not be opened.");

  let savedProducts: StoredSavedProduct[];
  let myDay: MyDayRecord[];
  let recentlyViewed: RecentlyViewedRecord[];
  try {
    [savedProducts, myDay, recentlyViewed] = await Promise.all([
      listSavedProducts(),
      listMyDayRecords(),
      listRecentlyViewed(),
    ]);
  } catch {
    throw new Error("Export unavailable: IndexedDB could not be read completely.");
  }

  return {
    pulserankLocalStateVersion: PULSERANK_LOCAL_STATE_VERSION,
    exportedAt: new Date().toISOString(),
    preferences: loadPreferences(),
    compare: getCompareSlugs(),
    savedProducts,
    myDay,
    recentlyViewed,
  };
}

async function rewriteStore(
  db: IDBDatabase,
  storeName: string,
  records: readonly unknown[],
): Promise<number> {
  const tx = db.transaction(storeName, "readwrite");
  const store = tx.objectStore(storeName);
  await requestToPromise(store.clear());
  for (const record of records) store.put(record);
  await transactionToPromise(tx);
  return records.length;
}

/**
 * Validates then restores a previously exported envelope. Everything is
 * validated before anything is written; each store is replaced wholesale
 * (clear-then-write) with original timestamps preserved so ordering survives
 * a round-trip. Throws `Error` when schema validation fails; resolves zero
 * counts on the server.
 */
export async function importAll(json: unknown): Promise<ImportSummary> {
  const validation = validateLocalStateEnvelope(json);
  if (!validation.ok) {
    throw new Error(`Invalid PulseRank local-state envelope: ${validation.error}`);
  }
  const envelope = validation.envelope;

  const summary: ImportSummary = {
    preferences: false,
    compare: 0,
    savedProducts: 0,
    myDay: 0,
    recentlyViewed: 0,
    errors: [],
  };

  const storageAvailable = inspectLocalStorage().status === "available";
  const db = await withDatabase();
  if (!storageAvailable) summary.errors.push("localStorage");
  if (!db) summary.errors.push("IndexedDB");
  if (!storageAvailable && !db) return summary;

  if (storageAvailable) {
    if (envelope.preferences) {
      try {
        summary.preferences = savePreferences(envelope.preferences);
        if (!summary.preferences) summary.errors.push("preferences");
      } catch {
        summary.errors.push("preferences");
      }
    }
    try {
      const compareResult = replaceCompareSlugs(envelope.compare);
      summary.compare = compareResult.ok ? compareResult.slugs.length : 0;
      if (!compareResult.ok || summary.compare !== envelope.compare.length) summary.errors.push("compare");
    } catch {
      summary.errors.push("compare");
    }
  }

  if (db) {
    // Recently-viewed is defensively re-capped on the way in.
    const restoredRecentlyViewed = [...envelope.recentlyViewed]
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .slice(0, RECENTLY_VIEWED_CAP);

    const stores = [
      ["saved products", SAVED_PRODUCTS_STORE, envelope.savedProducts] as const,
      ["My Day", MY_DAY_STORE, envelope.myDay] as const,
      ["recent views", RECENTLY_VIEWED_STORE, restoredRecentlyViewed] as const,
    ];
    for (const [label, storeName, records] of stores) {
      try {
        const count = await rewriteStore(db, storeName, records);
        if (storeName === SAVED_PRODUCTS_STORE) summary.savedProducts = count;
        if (storeName === MY_DAY_STORE) summary.myDay = count;
        if (storeName === RECENTLY_VIEWED_STORE) summary.recentlyViewed = count;
      } catch {
        summary.errors.push(label);
      }
    }
  }

  return summary;
}
