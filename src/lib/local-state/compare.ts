/**
 * Compare-tray selection persisted in localStorage under
 * `pulserank:v1:compare` as a JSON array of product slugs, capped at
 * {@link MAX_COMPARE_ITEMS} entries.
 *
 * All functions are SSR-safe: on the server the selection is empty and
 * mutations are no-ops. Corrupt payloads parse back to an empty selection.
 */

import { COMPARE_STORAGE_KEY } from "./keys";
import { hasLocalStorage, readJsonStorage, removeStorageKey, writeJsonStorage } from "./storage";

/** Hard cap on how many products can sit in the compare tray at once. */
export const MAX_COMPARE_ITEMS = 4;

/** Result of a compare-tray mutation. */
export interface CompareUpdate {
  /** The selection after the mutation (already sanitized and capped). */
  slugs: string[];
  /** False only when browser storage is unavailable or the write failed. */
  ok: boolean;
  /** True only when a slug was newly added by this call. */
  added: boolean;
}

/**
 * Coerces an unknown parsed value into a valid slug list: strings only,
 * trimmed, deduplicated, capped at {@link MAX_COMPARE_ITEMS}. Never throws.
 */
export function sanitizeCompareSlugs(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const slug = item.trim();
    if (slug.length === 0 || seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
    if (slugs.length >= MAX_COMPARE_ITEMS) break;
  }
  return slugs;
}

/** Parses a raw JSON string into a slug list; corrupt JSON yields an empty list. */
export function parseCompareSlugs(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return [];
  }
  return sanitizeCompareSlugs(parsed);
}

/** True when the value is a usable slug (non-empty after trimming). */
export function isValidCompareSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.trim().length > 0;
}

/** Reads the current selection (empty on the server or when nothing is stored). */
export function getCompareSlugs(): string[] {
  return sanitizeCompareSlugs(readJsonStorage(COMPARE_STORAGE_KEY));
}

/** Replaces the whole selection with a sanitized, capped version of `slugs`. */
export type ReplaceCompareResult = {
  ok: boolean;
  slugs: string[];
};

export function replaceCompareSlugs(slugs: readonly string[]): ReplaceCompareResult {
  const next = sanitizeCompareSlugs(slugs);
  return { ok: writeJsonStorage(COMPARE_STORAGE_KEY, next), slugs: next };
}

/** True when `slug` is currently in the tray. */
export function isInCompare(slug: string): boolean {
  if (!isValidCompareSlug(slug)) return false;
  return getCompareSlugs().includes(slug.trim());
}

/**
 * Adds `slug` unless it is invalid, already present, or the tray is full.
 * Adding to a full tray is a silent no-op (the 4-slot cap is enforced, never
 * evicted). Reports `added: true` only when the new selection was persisted;
 * unavailable/failing storage yields `added: false`.
 */
export function addCompareSlug(slug: string): CompareUpdate {
  const current = getCompareSlugs();
  if (!isValidCompareSlug(slug)) return { slugs: current, ok: hasLocalStorage(), added: false };
  const trimmed = slug.trim();
  if (current.includes(trimmed) || current.length >= MAX_COMPARE_ITEMS) {
    return { slugs: current, ok: hasLocalStorage(), added: false };
  }
  const next = [...current, trimmed];
  if (!writeJsonStorage(COMPARE_STORAGE_KEY, next)) {
    return { slugs: current, ok: false, added: false };
  }
  return { slugs: next, ok: true, added: true };
}

/** Removes `slug` if present; otherwise a no-op. Unavailable storage leaves the selection untouched. */
export function removeCompareSlug(slug: string): CompareUpdate {
  const current = getCompareSlugs();
  if (!isValidCompareSlug(slug) || !current.includes(slug.trim())) {
    return { slugs: current, ok: hasLocalStorage(), added: false };
  }
  const next = current.filter((item) => item !== slug.trim());
  if (!writeJsonStorage(COMPARE_STORAGE_KEY, next)) {
    return { slugs: current, ok: false, added: false };
  }
  return { slugs: next, ok: true, added: false };
}

/** Adds `slug` if absent, removes it if present. */
export function toggleCompareSlug(slug: string): CompareUpdate {
  if (!isValidCompareSlug(slug)) return { slugs: getCompareSlugs(), ok: hasLocalStorage(), added: false };
  const trimmed = slug.trim();
  return getCompareSlugs().includes(trimmed)
    ? removeCompareSlug(trimmed)
    : addCompareSlug(trimmed);
}

/** Clears the selection. Returns false when storage is unavailable. */
export function clearCompare(): boolean {
  return removeStorageKey(COMPARE_STORAGE_KEY);
}
