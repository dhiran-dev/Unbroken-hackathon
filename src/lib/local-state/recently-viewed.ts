/**
 * Recently-viewed products persisted in IndexedDB (database `pulserank`,
 * object store `recently-viewed`, keyPath `slug`, secondary index `viewedAt`).
 *
 * The list is capped at {@link RECENTLY_VIEWED_CAP} entries: touching a slug
 * dedupes it, moves it to the front (most recent), and evicts the oldest
 * entry beyond the cap.
 *
 * Every function is SSR-safe: on the server reads resolve to empty results and
 * writes are no-ops. Invalid input throws `TypeError`, never at import time.
 */

import {
  RECENTLY_VIEWED_STORE,
  RECENTLY_VIEWED_VIEWED_AT_INDEX,
  requestToPromise,
  transactionToPromise,
  withDatabase,
} from "./db";
import type { SavedProductRef } from "./saved-products";
import { sanitizeSavedProductRef } from "./saved-products";

/** Maximum number of recently-viewed records retained. */
export const RECENTLY_VIEWED_CAP = 50;

/** Stored shape: the viewed product ref plus its last view timestamp. */
export interface RecentlyViewedRecord {
  slug: string;
  /** Epoch milliseconds of the most recent view; ordering key. */
  viewedAt: number;
  ref: SavedProductRef;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Coerces an unknown stored/imported record into a {@link RecentlyViewedRecord}. */
export function sanitizeRecentlyViewedRecord(value: unknown): RecentlyViewedRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const ref = sanitizeSavedProductRef(record["ref"]);
  if (!ref) return null;
  const viewedAt = record["viewedAt"];
  return {
    // The key always mirrors the embedded ref's slug so the two can't diverge.
    slug: ref.slug,
    viewedAt: isFiniteNumber(viewedAt) ? viewedAt : Date.now(),
    ref,
  };
}

/**
 * Pure merge used by {@link touchRecentlyViewed}: replaces any existing record
 * for `slug`, sorts newest-first, and trims to {@link RECENTLY_VIEWED_CAP}.
 */
export function mergeRecentlyViewed(
  records: readonly RecentlyViewedRecord[],
  slug: string,
  ref: SavedProductRef,
  viewedAt: number,
): RecentlyViewedRecord[] {
  const next = records.filter((record) => record.slug !== slug);
  next.push({
    slug,
    viewedAt,
    ref: { ...ref, caffeine: { ...ref.caffeine }, serving: { ...ref.serving } },
  });
  next.sort((a, b) => b.viewedAt - a.viewedAt);
  return next.slice(0, RECENTLY_VIEWED_CAP);
}

/**
 * Records a product view: upserts the record for `slug` with a fresh
 * timestamp, dedupes by slug, and evicts anything beyond the cap — all inside
 * one readwrite transaction. Returns the written record, or `null` on the
 * server / when storage is unavailable. Throws `TypeError` on invalid input.
 */
export async function touchRecentlyViewed(
  slug: string,
  ref: SavedProductRef,
): Promise<RecentlyViewedRecord | null> {
  const validRef = sanitizeSavedProductRef({ ...ref, slug });
  if (!validRef) {
    throw new TypeError("Invalid recently-viewed ref: a complete SavedProductRef is required");
  }
  const viewedAt = Date.now();
  const db = await withDatabase();
  if (!db) return null;
  const tx = db.transaction(RECENTLY_VIEWED_STORE, "readwrite");
  const store = tx.objectStore(RECENTLY_VIEWED_STORE);
  const rawExisting = (await requestToPromise(store.getAll())) as RecentlyViewedRecord[];
  const existing = rawExisting
    .map((record) => sanitizeRecentlyViewedRecord(record))
    .filter((record): record is RecentlyViewedRecord => record !== null);
  const merged = mergeRecentlyViewed(existing, slug, validRef, viewedAt);
  const keptSlugs = new Set(merged.map((record) => record.slug));
  store.put({ slug, viewedAt, ref: validRef });
  for (const record of existing) {
    if (!keptSlugs.has(record.slug)) store.delete(record.slug);
  }
  await transactionToPromise(tx);
  return { slug, viewedAt, ref: validRef };
}

/**
 * Lists recently-viewed records newest-first, optionally limited to `limit`
 * entries. Empty array on the server.
 */
export async function listRecentlyViewed(limit?: number): Promise<RecentlyViewedRecord[]> {
  const db = await withDatabase();
  if (!db) return [];
  const tx = db.transaction(RECENTLY_VIEWED_STORE, "readonly");
  const index = tx.objectStore(RECENTLY_VIEWED_STORE).index(RECENTLY_VIEWED_VIEWED_AT_INDEX);
  const records = (await requestToPromise(index.getAll())) as unknown[];
  const ordered = records
    .map((record) => sanitizeRecentlyViewedRecord(record))
    .filter((record): record is RecentlyViewedRecord => record !== null)
    .sort((a, b) => b.viewedAt - a.viewedAt);
  if (limit !== undefined) {
    if (!Number.isInteger(limit) || limit < 0) {
      throw new TypeError(`Invalid listRecentlyViewed limit: ${String(limit)}`);
    }
    return ordered.slice(0, limit);
  }
  return ordered;
}

/** Removes one record by slug. Returns true only when a record was deleted. */
export async function removeRecentlyViewed(slug: string): Promise<boolean> {
  const db = await withDatabase();
  if (!db) return false;
  const tx = db.transaction(RECENTLY_VIEWED_STORE, "readwrite");
  const store = tx.objectStore(RECENTLY_VIEWED_STORE);
  const existing = await requestToPromise(store.getKey(slug));
  if (existing === undefined) return false;
  store.delete(slug);
  await transactionToPromise(tx);
  return true;
}

/** Deletes every recently-viewed record. No-op on the server. */
export async function clearRecentlyViewed(): Promise<void> {
  const db = await withDatabase();
  if (!db) return;
  const tx = db.transaction(RECENTLY_VIEWED_STORE, "readwrite");
  tx.objectStore(RECENTLY_VIEWED_STORE).clear();
  await transactionToPromise(tx);
}
