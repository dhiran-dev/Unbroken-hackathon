/**
 * PulseRank public API — request-parameter parsing for route handlers (A8).
 *
 * Pure functions over `URLSearchParams`: no database access, no network, no
 * clock reads. Route handlers stay thin by delegating every query-string
 * decision here, and the parsers are unit-testable without a Next.js runtime.
 *
 * Policy: unknown parameters are ignored; KNOWN parameters with invalid values
 * fail loudly (400) rather than being silently dropped, so a typo like
 * `?sort=namee` can never masquerade as a default sort.
 */

import { CANONICAL_CATEGORIES } from "@/server/ingestion/normalize";
import {
  MAX_PAGE_LIMIT,
  PRODUCT_SORT_OPTIONS,
  type ProductSortOption,
} from "@/server/products/query-options";
import type { ProductListFilters } from "@/server/products/queries";

/** Shared cache policy: CDN-cached for a minute, per plan §"Agent A8". */
export const PUBLIC_CACHE_CONTROL = "public, s-maxage=60";

const BOOLEAN_VALUES = new Set(["true", "false", "1", "0"]);

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

function firstParameter(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name);
  if (values.length === 0) return undefined;
  return values[values.length - 1] ?? undefined;
}

function parseNonNegativeInt(
  raw: string,
  name: string,
): ParseResult<number> {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    return { ok: false, error: `${name} must be a non-negative integer` };
  }
  return { ok: true, value: Number.parseInt(trimmed, 10) };
}

function parseBoolean(raw: string, name: string): ParseResult<boolean> {
  const normalized = raw.trim().toLowerCase();
  if (!BOOLEAN_VALUES.has(normalized)) {
    return { ok: false, error: `${name} must be one of ${[...BOOLEAN_VALUES].join("|")}` };
  }
  return { ok: true, value: normalized === "true" || normalized === "1" };
}

function parseEnum<T extends string>(
  raw: string,
  name: string,
  allowed: readonly T[],
): ParseResult<T> {
  const normalized = raw.trim();
  if (!(allowed as readonly string[]).includes(normalized)) {
    return {
      ok: false,
      error: `${name} must be one of ${allowed.join("|")}`,
    };
  }
  return { ok: true, value: normalized as T };
}

// ---------------------------------------------------------------------------
// Product list/search filters
// ---------------------------------------------------------------------------

const SERVING_FORMS = [
  "drink",
  "concentrate",
  "mix",
  "food",
  "supplement",
  "item",
  "unknown",
] as const;

const SOURCE_LEVELS = [
  "caffeine_free",
  "low",
  "moderate",
  "high",
  "very_high",
  "extreme",
  "unknown",
] as const;

type MutableProductListFilters = {
  [K in keyof ProductListFilters]: ProductListFilters[K];
};

/**
 * Parse the shared product-list query surface:
 * `search`, `category`, `caffeineMinMg`, `caffeineMaxMg`, `servingForm`,
 * `exactOnly`, `hasSugar`, `hasCalories`, `sourceLevel`, `sort`, `cursor`,
 * `limit`.
 */
export function parseProductListQuery(
  parameters: URLSearchParams,
): ParseResult<ProductListFilters> {
  const filters: MutableProductListFilters = {};

  const search = firstParameter(parameters, "search");
  if (search !== undefined && search.trim() === "") {
    return { ok: false, error: "search must not be empty when provided" };
  }
  filters.search = search?.trim();

  const category = firstParameter(parameters, "category");
  if (category !== undefined) {
    const parsed = parseEnum(category, "category", CANONICAL_CATEGORIES);
    if (!parsed.ok) return parsed;
    filters.category = parsed.value;
  }

  for (const name of ["caffeineMinMg", "caffeineMaxMg"] as const) {
    const raw = firstParameter(parameters, name);
    if (raw !== undefined) {
      const parsed = parseNonNegativeInt(raw, name);
      if (!parsed.ok) return parsed;
      filters[name] = parsed.value;
    }
  }

  if (
    filters.caffeineMinMg !== undefined &&
    filters.caffeineMaxMg !== undefined &&
    filters.caffeineMinMg > filters.caffeineMaxMg
  ) {
    return { ok: false, error: "caffeineMinMg must not exceed caffeineMaxMg" };
  }

  const servingForm = firstParameter(parameters, "servingForm");
  if (servingForm !== undefined) {
    const parsed = parseEnum(servingForm, "servingForm", SERVING_FORMS);
    if (!parsed.ok) return parsed;
    filters.servingForm = parsed.value;
  }

  for (const name of ["exactOnly", "hasSugar", "hasCalories"] as const) {
    const raw = firstParameter(parameters, name);
    if (raw !== undefined) {
      const parsed = parseBoolean(raw, name);
      if (!parsed.ok) return parsed;
      filters[name] = parsed.value;
    }
  }

  const sourceLevel = firstParameter(parameters, "sourceLevel");
  if (sourceLevel !== undefined) {
    const parsed = parseEnum(sourceLevel, "sourceLevel", SOURCE_LEVELS);
    if (!parsed.ok) return parsed;
    filters.sourceLevel = parsed.value;
  }

  const sort = firstParameter(parameters, "sort");
  if (sort !== undefined) {
    const parsed = parseEnum(sort, "sort", PRODUCT_SORT_OPTIONS);
    if (!parsed.ok) return parsed;
    filters.sort = parsed.value as ProductSortOption;
  }

  const cursor = firstParameter(parameters, "cursor");
  if (cursor !== undefined && cursor.trim() === "") {
    return { ok: false, error: "cursor must not be empty when provided" };
  }
  filters.cursor = cursor ?? null;

  const limitRaw = firstParameter(parameters, "limit");
  if (limitRaw !== undefined) {
    const parsed = parseNonNegativeInt(limitRaw, "limit");
    if (!parsed.ok) return parsed;
    if (parsed.value < 1 || parsed.value > MAX_PAGE_LIMIT) {
      return { ok: false, error: `limit must be between 1 and ${MAX_PAGE_LIMIT}` };
    }
    filters.limit = parsed.value;
  }

  return { ok: true, value: filters };
}

/** JSON response with the shared public cache policy. */
export function jsonPublic(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": PUBLIC_CACHE_CONTROL },
  });
}

/** Uniform 400 body for parameter failures. */
export function badRequest(error: string): Response {
  return jsonPublic({ error: { code: "INVALID_QUERY", message: error } }, 400);
}

/** Uniform 404 body. */
export function notFound(code: string, message: string): Response {
  return jsonPublic({ error: { code, message } }, 404);
}
