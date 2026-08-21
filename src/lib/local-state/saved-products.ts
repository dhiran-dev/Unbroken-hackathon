/**
 * Saved products persisted in IndexedDB (database `pulserank`, version 1,
 * object store `saved-products`, keyPath `slug`, secondary index `savedAt`).
 *
 * The public record shape is the {@link SavedProductRef} DTO — a denormalized
 * snapshot of a product at the moment it was saved — plus an internal
 * `savedAt` timestamp used for ordering.
 *
 * Every function is SSR-safe: on the server (or when IndexedDB is
 * unavailable/blocked) reads resolve to empty results and writes are no-ops.
 */

import {
  SAVED_PRODUCTS_SAVED_AT_INDEX,
  SAVED_PRODUCTS_STORE,
  requestToPromise,
  transactionToPromise,
  withDatabase,
} from "./db";

export interface SavedProductCaffeine {
  /** Caffeine amount in milligrams. */
  mg: number;
  /** Qualifier for the amount (e.g. `"per-can"`, `"per-serving"`). */
  qualifier: string;
  /** Provenance level of the caffeine figure (e.g. `"label"`, `"estimate"`). */
  sourceLevel: string;
}

export interface SavedProductServing {
  value: number;
  unit: string;
  form: string;
}

/** Public snapshot of a product at save time. Defined locally to this layer. */
export interface SavedProductRef {
  slug: string;
  name: string;
  category: string;
  caffeine: SavedProductCaffeine;
  serving: SavedProductServing;
  /** ISO timestamp of the product data the snapshot was taken from. */
  observedAt: string;
}

/** Stored shape: the public ref plus the save-time ordering timestamp. */
export interface StoredSavedProduct extends SavedProductRef {
  savedAt: number;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sanitizeCaffeine(value: unknown): SavedProductCaffeine | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const mg = record["mg"];
  const qualifier = record["qualifier"];
  const sourceLevel = record["sourceLevel"];
  if (!isFiniteNumber(mg) || mg < 0) return null;
  if (!isNonEmptyString(qualifier) || !isNonEmptyString(sourceLevel)) return null;
  return { mg, qualifier, sourceLevel };
}

function sanitizeServing(value: unknown): SavedProductServing | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const servingValue = record["value"];
  const unit = record["unit"];
  const form = record["form"];
  if (!isFiniteNumber(servingValue)) return null;
  if (!isNonEmptyString(unit) || !isNonEmptyString(form)) return null;
  return { value: servingValue, unit, form };
}

/**
 * Coerces an unknown value into a {@link SavedProductRef}, or `null` when any
 * required field is missing or mistyped. Used to guard writes and imports.
 */
export function sanitizeSavedProductRef(value: unknown): SavedProductRef | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const slug = record["slug"];
  const name = record["name"];
  const category = record["category"];
  const observedAt = record["observedAt"];
  const caffeine = sanitizeCaffeine(record["caffeine"]);
  const serving = sanitizeServing(record["serving"]);
  if (
    !isNonEmptyString(slug) ||
    !isNonEmptyString(name) ||
    typeof category !== "string" ||
    !isNonEmptyString(observedAt) ||
    !caffeine ||
    !serving
  ) {
    return null;
  }
  return { slug, name, category, caffeine, serving, observedAt };
}

/**
 * Coerces an unknown stored/imported record into a {@link StoredSavedProduct}.
 * A missing/invalid `savedAt` defaults to now so restored records still order.
 */
export function sanitizeStoredSavedProduct(value: unknown): StoredSavedProduct | null {
  const ref = sanitizeSavedProductRef(value);
  if (!ref) return null;
  const rawSavedAt =
    typeof value === "object" && value !== null
      ? (value as Record<string, unknown>)["savedAt"]
      : undefined;
  const savedAt = isFiniteNumber(rawSavedAt) ? rawSavedAt : Date.now();
  return { ...ref, savedAt };
}

/** Stamps a ref with a save timestamp and deep-copies nested objects. */
export function toStoredSavedProduct(
  ref: SavedProductRef,
  savedAt: number = Date.now(),
): StoredSavedProduct {
  return {
    ...ref,
    caffeine: { ...ref.caffeine },
    serving: { ...ref.serving },
    savedAt,
  };
}

/**
 * Inserts or updates a saved product keyed by slug. Returns the stored record,
 * or `null` when storage is unavailable (server). Throws if `ref` is invalid.
 */
export async function saveSavedProduct(
  ref: SavedProductRef,
  savedAt: number = Date.now(),
): Promise<StoredSavedProduct | null> {
  const stored = toStoredSavedProduct(ref, savedAt);
  const db = await withDatabase();
  if (!db) return null;
  const tx = db.transaction(SAVED_PRODUCTS_STORE, "readwrite");
  tx.objectStore(SAVED_PRODUCTS_STORE).put(stored);
  await transactionToPromise(tx);
  return stored;
}

/** Removes a saved product. Returns true only when a record existed and was deleted. */
export async function removeSavedProduct(slug: string): Promise<boolean> {
  const db = await withDatabase();
  if (!db) return false;
  const tx = db.transaction(SAVED_PRODUCTS_STORE, "readwrite");
  const store = tx.objectStore(SAVED_PRODUCTS_STORE);
  const existing = await requestToPromise(store.getKey(slug));
  if (existing === undefined) return false;
  store.delete(slug);
  await transactionToPromise(tx);
  return true;
}

/** Fetches one saved product by slug, or `null` when absent/unavailable. */
export async function getSavedProduct(slug: string): Promise<StoredSavedProduct | null> {
  const db = await withDatabase();
  if (!db) return null;
  const tx = db.transaction(SAVED_PRODUCTS_STORE, "readonly");
  const record = await requestToPromise(
    tx.objectStore(SAVED_PRODUCTS_STORE).get(slug),
  );
  return record ?? null;
}

/** True when the slug currently has a saved product. */
export async function isProductSaved(slug: string): Promise<boolean> {
  return (await getSavedProduct(slug)) !== null;
}

/**
 * Lists every saved product ordered by `savedAt` descending (newest first).
 * Empty array on the server.
 */
export async function listSavedProducts(): Promise<StoredSavedProduct[]> {
  const db = await withDatabase();
  if (!db) return [];
  const tx = db.transaction(SAVED_PRODUCTS_STORE, "readonly");
  const index = tx.objectStore(SAVED_PRODUCTS_STORE).index(SAVED_PRODUCTS_SAVED_AT_INDEX);
  const records = (await requestToPromise(index.getAll())) as StoredSavedProduct[];
  return records.sort((a, b) => b.savedAt - a.savedAt);
}

/** Deletes every saved product. No-op on the server. */
export async function clearSavedProducts(): Promise<void> {
  const db = await withDatabase();
  if (!db) return;
  const tx = db.transaction(SAVED_PRODUCTS_STORE, "readwrite");
  tx.objectStore(SAVED_PRODUCTS_STORE).clear();
  await transactionToPromise(tx);
}
