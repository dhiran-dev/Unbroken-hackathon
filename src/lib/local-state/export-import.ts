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
 * Every function is SSR-safe: on the server `exportAll` returns an empty
 * envelope and `importAll` is a no-op resolving zero counts.
 */

import {
  MY_DAY_STORE,
  RECENTLY_VIEWED_STORE,
  SAVED_PRODUCTS_STORE,
  requestToPromise,
  transactionToPromise,
  withDatabase,
} from "./db";
import { PULSERANK_LOCAL_STATE_VERSION } from "./keys";
import type { MyDayRecord } from "./my-day";
import { listMyDayRecords, sanitizeMyDayRecord } from "./my-day";
import { getCompareSlugs, replaceCompareSlugs, sanitizeCompareSlugs } from "./compare";
import { hasLocalStorage } from "./storage";
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
 * Serializes every store and preference into one versioned envelope. On the
 * server (no localStorage, no IndexedDB) every section comes back empty/null.
 */
export async function exportAll(): Promise<PulserankLocalStateEnvelope> {
  const storageAvailable = hasLocalStorage();
  const db = await withDatabase();

  const [savedProducts, myDay, recentlyViewed] = await Promise.all([
    db ? listSavedProducts() : Promise.resolve<StoredSavedProduct[]>([]),
    db ? listMyDayRecords() : Promise.resolve<MyDayRecord[]>([]),
    db ? listRecentlyViewed() : Promise.resolve<RecentlyViewedRecord[]>([]),
  ]);

  return {
    pulserankLocalStateVersion: PULSERANK_LOCAL_STATE_VERSION,
    exportedAt: new Date().toISOString(),
    preferences: storageAvailable ? loadPreferences() : null,
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
  };

  const storageAvailable = hasLocalStorage();
  const db = await withDatabase();
  if (!storageAvailable && !db) return summary;

  if (storageAvailable) {
    if (envelope.preferences) summary.preferences = savePreferences(envelope.preferences);
    if (envelope.compare.length > 0) {
      summary.compare = replaceCompareSlugs(envelope.compare).length;
    }
  }

  if (db) {
    // Recently-viewed is defensively re-capped on the way in.
    const restoredRecentlyViewed = [...envelope.recentlyViewed]
      .sort((a, b) => b.viewedAt - a.viewedAt)
      .slice(0, RECENTLY_VIEWED_CAP);

    const [savedProducts, myDay, recentlyViewed] = await Promise.all([
      rewriteStore(db, SAVED_PRODUCTS_STORE, envelope.savedProducts),
      rewriteStore(db, MY_DAY_STORE, envelope.myDay),
      rewriteStore(db, RECENTLY_VIEWED_STORE, restoredRecentlyViewed),
    ]);
    summary.savedProducts = savedProducts;
    summary.myDay = myDay;
    summary.recentlyViewed = recentlyViewed;
  }

  return summary;
}
