/**
 * PulseRank public API — typed read queries over the pulse schema (Agent A8).
 *
 * TRUSTED ONLY, by construction: every product-facing query joins
 * `pulse.products` to `pulse.product_observations` through
 * `products.current_trusted_observation_id` — the pointer maintained by the
 * A5/A7 promotion flow — AND constrains `product_observations.status =
 * 'trusted'`. Candidate, quarantined, rejected, and superseded observations
 * are unreachable through these functions; there is no parameter that can
 * relax either condition.
 *
 * Read-only: this module never INSERTs, UPDATEs, or DELETEs.
 *
 * Plan reference: docs/plans/pulserank-master-implementation-plan.md §"Agent A8 —
 * Public API" (endpoints, required pagination and filters). Pagination is
 * keyset-based; cursors are opaque base64url strings carrying the sort value
 * plus a tiebreaker id, so pages stay stable across concurrent inserts.
 */

import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  pulseChangeEvents,
  pulseCollectors,
  pulseCollectionRuns,
  pulseIncidents,
  pulseLeaderboardEntries,
  pulseLeaderboardSnapshots,
  pulseProductAliases,
  pulseProductMediaPublications,
  pulseProducts,
  pulseProductObservations,
  pulseSources,
} from "@/server/db/schema/pulse";
import type { CanonicalCategory } from "@/server/ingestion/normalize";
import type { TrustedProductRecord } from "@/server/ingestion/promote";
import type {
  TrustedObservationPayload,
  TrustedProductRow,
} from "@/server/products/dto";
import {
  changeField,
  PUBLIC_CHANGE_OBSERVATION_STATUSES,
  sanitizeChangeEventType,
  sanitizeChangePoint,
  type PublicChangeEventType,
} from "@/server/products/change-sanitizer";
import type { ChangePoint } from "@/server/ingestion/change-detection";
import {
  sanitizeLiveRun,
  type SanitizedLiveRun,
} from "@/server/products/live-data-sanitizer";
import { authorizeProductSourceUrl } from "@/server/products/source-policy";

// ---------------------------------------------------------------------------
// Shared trusted-only selection
// ---------------------------------------------------------------------------

/**
 * jsonb handle for the observation payload, used for typed jsonb filters.
 * Only `status = 'trusted'` payloads follow the `TrustedObservationPayload`
 * shape — enforced by the join below.
 */
const payloadColumn = pulseProductObservations.normalized;

/** Join condition that makes non-trusted rows unreachable by construction. */
function trustedOnlyCondition(): SQL {
  return and(
    eq(pulseProducts.currentTrustedObservationId, pulseProductObservations.id),
    eq(pulseProducts.id, pulseProductObservations.productId),
    eq(pulseProductObservations.status, "trusted"),
  ) as SQL;
}

type TrustedJoinRow = {
  productId: string;
  slug: string;
  name: string;
  categoryLabel: string | null;
  observationId: string;
  observedAt: Date;
  status: string;
  normalized: unknown;
  publishedImageUrl: string | null;
};

const trustedSelect = {
  productId: pulseProducts.id,
  slug: pulseProducts.slug,
  name: pulseProducts.name,
  categoryLabel: pulseProducts.categoryLabel,
  observationId: pulseProductObservations.id,
  observedAt: pulseProductObservations.observedAt,
  status: pulseProductObservations.status,
  normalized: pulseProductObservations.normalized,
  publishedImageUrl: pulseProductMediaPublications.imageUrl,
};

function toTrustedProductRow(row: TrustedJoinRow): TrustedProductRow {
  const normalized = row.normalized as TrustedObservationPayload;
  return {
    product: {
      slug: row.slug,
      name: row.name,
      categoryLabel: row.categoryLabel,
    },
    observation: {
      id: row.observationId,
      observedAt: row.observedAt,
      status: row.status,
    },
    payload:
      row.publishedImageUrl === null
        ? normalized
        : {
            ...normalized,
            media: {
              imageUrl: row.publishedImageUrl,
              publicationState: "allowed",
            },
          },
  };
}

function withPublishedMedia() {
  return and(
    eq(
      pulseProductMediaPublications.productObservationId,
      pulseProductObservations.id,
    ),
    eq(pulseProductMediaPublications.publicationState, "allowed"),
  );
}

// ---------------------------------------------------------------------------
// Filters, sorting, cursors
// ---------------------------------------------------------------------------

export {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PRODUCT_SORT_OPTIONS,
} from "@/server/products/query-options";
import {
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
  PRODUCT_SORT_OPTIONS,
  type ProductSortOption,
} from "@/server/products/query-options";

export type ProductListFilters = {
  /** Free-text search over product name and aliases (ILIKE contains). */
  search?: string | undefined;
  /** Canonical category stored on the trusted payload. */
  category?: CanonicalCategory | undefined;
  /** Inclusive lower caffeine bound in mg. */
  caffeineMinMg?: number | undefined;
  /** Inclusive upper caffeine bound in mg. */
  caffeineMaxMg?: number | undefined;
  /** Serving form stored on the trusted payload. */
  servingForm?: TrustedProductRecord["serving"]["form"] | undefined;
  /** Only products whose trusted caffeine is an exact point value. */
  exactOnly?: boolean | undefined;
  /** Only products whose trusted sugar state is `present`. */
  hasSugar?: boolean | undefined;
  /** Only products whose trusted calories state is `present`. */
  hasCalories?: boolean | undefined;
  /** Source-level band stored on the trusted payload. */
  sourceLevel?: TrustedProductRecord["sourceLevel"] | undefined;
  /** Sort order; default `name`. */
  sort?: ProductSortOption | undefined;
  /** Opaque keyset cursor from a previous page (`nextCursor`). */
  cursor?: string | null | undefined;
  /** Page size, clamped to [1, MAX_PAGE_LIMIT]. */
  limit?: number | undefined;
};

export type ProductListResult = {
  items: TrustedProductRow[];
  totalCount: number;
  activeFacets: ActiveProductFacets;
  /** Opaque cursor for the next page, or null when this is the last page. */
  nextCursor: string | null;
};

export type ActiveProductFacets = Omit<
  ProductListFilters,
  "cursor" | "limit" | "sort"
>;

/** Effective numeric caffeine used for range filters and caffeine sorting. */
function caffeineSortExpression(): SQL {
  // Ranges sort by their lower bound; point values by themselves.
  return sql`coalesce(
    (${payloadColumn} -> 'caffeineMg' ->> 'value')::double precision,
    (${payloadColumn} -> 'caffeineMg' ->> 'min')::double precision
  )`;
}

function filterConditions(filters: ProductListFilters): SQL[] {
  const conditions: SQL[] = [trustedOnlyCondition()];

  if (filters.search !== undefined && filters.search.trim() !== "") {
    const pattern = `%${filters.search.trim().replace(/[%_]/g, (m) => `\\${m}`)}%`;
    conditions.push(
      sql`(
        ${pulseProducts.name} ilike ${pattern}
        or exists (
          select 1 from ${pulseProductAliases}
          where ${pulseProductAliases.productId} = ${pulseProducts.id}
            and ${pulseProductAliases.alias} ilike ${pattern}
        )
      )`,
    );
  }

  if (filters.category !== undefined) {
    conditions.push(sql`${payloadColumn} ->> 'category' = ${filters.category}`);
  }

  if (filters.caffeineMinMg !== undefined) {
    // Point values must reach the bound; ranges overlap when their max does.
    conditions.push(sql`(
      (${payloadColumn} -> 'caffeineMg' ->> 'value')::double precision >= ${filters.caffeineMinMg}
      or (
        (${payloadColumn} -> 'caffeineMg' ->> 'qualifier') = 'range'
        and (${payloadColumn} -> 'caffeineMg' ->> 'max')::double precision >= ${filters.caffeineMinMg}
      )
    )`);
  }

  if (filters.caffeineMaxMg !== undefined) {
    // Ranges overlap when their min stays under the bound.
    conditions.push(sql`(
      coalesce(
        (${payloadColumn} -> 'caffeineMg' ->> 'value')::double precision,
        (${payloadColumn} -> 'caffeineMg' ->> 'min')::double precision
      ) <= ${filters.caffeineMaxMg}
    )`);
  }

  if (filters.servingForm !== undefined) {
    conditions.push(
      sql`${payloadColumn} -> 'serving' ->> 'form' = ${filters.servingForm}`,
    );
  }

  if (filters.exactOnly === true) {
    conditions.push(sql`(
      (${payloadColumn} -> 'caffeineMg' ->> 'qualifier') = 'exact'
      and (${payloadColumn} -> 'caffeineMg' ->> 'value') is not null
    )`);
  }

  if (filters.hasSugar === true) {
    conditions.push(sql`${payloadColumn} -> 'sugarG' ->> 'state' = 'present'`);
  }

  if (filters.hasCalories === true) {
    conditions.push(
      sql`${payloadColumn} -> 'caloriesKcal' ->> 'state' = 'present'`,
    );
  }

  if (filters.sourceLevel !== undefined) {
    conditions.push(sql`${payloadColumn} ->> 'sourceLevel' = ${filters.sourceLevel}`);
  }

  return conditions;
}

// -- opaque keyset cursors ---------------------------------------------------

const CURSOR_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CursorPayload = {
  v: 1;
  k: ProductSortOption;
  id: string;
  s?: string | undefined; // name / newest timestamp (ISO)
  n?: number | undefined; // caffeine value
  z?: 1 | undefined; // caffeine value is null (the final sort bucket)
};

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): CursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { k?: unknown }).k === "string" &&
      PRODUCT_SORT_OPTIONS.includes((parsed as { k: ProductSortOption }).k) &&
      typeof (parsed as { id?: unknown }).id === "string" &&
      CURSOR_UUID.test((parsed as { id: string }).id)
    ) {
      const candidate = parsed as CursorPayload;
      if (
        (candidate.k === "name" || candidate.k === "newest") &&
        typeof candidate.s !== "string"
      ) {
        return null;
      }
      if (
        candidate.k === "newest" &&
        (candidate.s === undefined || Number.isNaN(Date.parse(candidate.s)))
      ) {
        return null;
      }
      if (
        (candidate.k === "caffeine-desc" || candidate.k === "caffeine-asc") &&
        candidate.z !== 1 &&
        (typeof candidate.n !== "number" || !Number.isFinite(candidate.n))
      ) {
        return null;
      }
      return candidate;
    }
    return null;
  } catch {
    return null;
  }
}

function keysetCondition(sort: ProductSortOption, cursor: CursorPayload): SQL {
  switch (sort) {
    case "name":
      // name ascending, id ascending tiebreak.
      return sql`(
        ${pulseProducts.name} > ${cursor.s ?? ""}
        or (${pulseProducts.name} = ${cursor.s ?? ""} and ${pulseProducts.id} > ${cursor.id})
      )`;
    case "caffeine-desc":
      if (cursor.z === 1) {
        return sql`(
          ${caffeineSortExpression()} is null
          and ${pulseProducts.id} > ${cursor.id}
        )`;
      }
      return sql`(
        ${caffeineSortExpression()} < ${cursor.n ?? Number.NEGATIVE_INFINITY}
        or ${caffeineSortExpression()} is null
        or (
          ${caffeineSortExpression()} = ${cursor.n ?? Number.NEGATIVE_INFINITY}
          and ${pulseProducts.id} > ${cursor.id}
        )
      )`;
    case "caffeine-asc":
      if (cursor.z === 1) {
        return sql`(
          ${caffeineSortExpression()} is null
          and ${pulseProducts.id} > ${cursor.id}
        )`;
      }
      return sql`(
        ${caffeineSortExpression()} > ${cursor.n ?? Number.POSITIVE_INFINITY}
        or ${caffeineSortExpression()} is null
        or (
          ${caffeineSortExpression()} = ${cursor.n ?? Number.POSITIVE_INFINITY}
          and ${pulseProducts.id} > ${cursor.id}
        )
      )`;
    case "newest":
      // observedAt descending, id descending tiebreak.
      return sql`(
        ${pulseProductObservations.observedAt} < ${cursor.s ?? ""}
        or (
          ${pulseProductObservations.observedAt} = ${cursor.s ?? ""}
          and ${pulseProducts.id} < ${cursor.id}
        )
      )`;
  }
}

function sortClauses(sort: ProductSortOption): SQL[] {
  switch (sort) {
    case "name":
      return [sql`${pulseProducts.name} asc`, sql`${pulseProducts.id} asc`];
    case "caffeine-desc":
      return [
        sql`${caffeineSortExpression()} desc nulls last`,
        sql`${pulseProducts.id} asc`,
      ];
    case "caffeine-asc":
      return [
        sql`${caffeineSortExpression()} asc nulls last`,
        sql`${pulseProducts.id} asc`,
      ];
    case "newest":
      return [
        sql`${pulseProductObservations.observedAt} desc`,
        sql`${pulseProducts.id} desc`,
      ];
  }
}

function cursorValueFor(
  sort: ProductSortOption,
  row: TrustedJoinRow,
): { s?: string | undefined; n?: number | undefined; z?: 1 | undefined } {
  switch (sort) {
    case "name":
      return { s: row.name };
    case "newest":
      return { s: row.observedAt.toISOString() };
    default: {
      const normalized = row.normalized as TrustedObservationPayload;
      const caffeine = normalized?.caffeineMg;
      const value =
        caffeine?.value ??
        (caffeine?.qualifier === "range"
          ? (caffeine.min ?? undefined)
          : undefined);
      return typeof value === "number" ? { n: value } : { z: 1 };
    }
  }
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_PAGE_LIMIT);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** List trusted products through the current-trusted pointer, filtered + paged. */
export async function listProducts(
  filters: ProductListFilters = {},
): Promise<ProductListResult> {
  const sort = filters.sort ?? "name";
  const limit = clampLimit(filters.limit);

  const baseConditions = filterConditions(filters);
  const conditions = [...baseConditions];
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    // A cursor minted for a different sort must never be silently re-applied
    // under another ordering — that yields wrong pages. Fail loudly instead.
    if (!cursor || cursor.k !== sort) throw new InvalidCursorError();
    conditions.push(keysetCondition(cursor.k, cursor));
  }

  const [rows, countRows] = await Promise.all([
    db
      .select(trustedSelect)
      .from(pulseProducts)
      .innerJoin(pulseProductObservations, trustedOnlyCondition())
      .leftJoin(pulseProductMediaPublications, withPublishedMedia())
      .where(and(...conditions))
      .orderBy(...sortClauses(sort))
      .limit(limit + 1) as Promise<TrustedJoinRow[]>,
    db
      .select({ totalCount: sql<number>`count(distinct ${pulseProducts.id})::int` })
      .from(pulseProducts)
      .innerJoin(pulseProductObservations, trustedOnlyCondition())
      .where(and(...baseConditions)),
  ]);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeCursor({
        v: 1,
        k: sort,
        id: last.productId,
        ...cursorValueFor(sort, last),
      });
    }
  }

  const activeFacets: ActiveProductFacets = {};
  for (const key of [
    "search",
    "category",
    "caffeineMinMg",
    "caffeineMaxMg",
    "servingForm",
    "exactOnly",
    "hasSugar",
    "hasCalories",
    "sourceLevel",
  ] as const) {
    const value = filters[key];
    if (value !== undefined && value !== false) {
      Object.assign(activeFacets, { [key]: value });
    }
  }

  return {
    items: page.map(toTrustedProductRow),
    totalCount: Number(countRows[0]?.totalCount ?? 0),
    activeFacets,
    nextCursor,
  };
}

/** One trusted product by slug, or null when absent/not yet trusted. */
export async function getProductBySlug(
  slug: string,
): Promise<TrustedProductRow | null> {
  const rows = (await db
    .select(trustedSelect)
    .from(pulseProducts)
    .innerJoin(pulseProductObservations, trustedOnlyCondition())
    .leftJoin(pulseProductMediaPublications, withPublishedMedia())
    .where(and(trustedOnlyCondition(), eq(pulseProducts.slug, slug)))
    .limit(1)) as TrustedJoinRow[];

  const row = rows[0];
  return row ? toTrustedProductRow(row) : null;
}

/**
 * Search trusted products by term (name + aliases) with the same shared
 * filters and keyset pagination as `listProducts`.
 */
export async function searchProducts(
  query: string,
  filters: Omit<ProductListFilters, "search"> = {},
): Promise<ProductListResult> {
  return listProducts({ ...filters, search: query });
}

// -- categories ---------------------------------------------------------------

export type CategoryCount = {
  category: CanonicalCategory;
  productCount: number;
};

/** Canonical categories over trusted products, with distinct product counts. */
export async function listCategories(): Promise<CategoryCount[]> {
  const rows = await db
    .select({
      category: sql<string>`${payloadColumn} ->> 'category'`,
      productCount:
        sql<number>`count(distinct ${pulseProducts.id})::int`,
    })
    .from(pulseProducts)
    .innerJoin(pulseProductObservations, trustedOnlyCondition())
    .groupBy(sql`${payloadColumn} ->> 'category'`)
    .orderBy(asc(sql`${payloadColumn} ->> 'category'`));

  return rows.map((row) => ({
    category: (row.category ?? "other") as CanonicalCategory,
    productCount: Number(row.productCount),
  }));
}

// -- leaderboards -------------------------------------------------------------

export type LeaderboardEntryDto = {
  rank: number;
  productId: string;
  metricKey: string;
  metricValue: number;
  eligible: boolean;
  eligibilityFlags: string[];
  previousRank: number | null;
  rankDelta: number | null;
  product: {
    slug: string;
    name: string;
    category: CanonicalCategory;
  };
};

export type LeaderboardFilterOptions = {
  category?: CanonicalCategory;
  servingForm?: TrustedProductRecord["serving"]["form"] | string;
  completeOnly?: boolean;
};

export type LeaderboardFacetResult = {
  eligibleCount: number;
  excludedCount: number;
  reasons: Array<{ label: string; count: number }>;
  servingForms: string[];
};

export type LeaderboardResult = {
  snapshotId: string;
  rebuiltAt: Date;
  boardKey: string;
  trustedProductCount: number;
  eligibleCount: number;
  excludedCount: number;
  totalCount: number;
  nextCursor: string | null;
  entries: LeaderboardEntryDto[];
};

type LeaderboardCursor = {
  v: 2;
  boardKey: string;
  snapshotId: string;
  category: CanonicalCategory | null;
  servingForm: string | null;
  completeOnly: boolean;
  rank: number;
};

function encodeLeaderboardCursor(cursor: LeaderboardCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeLeaderboardCursor(value: string): LeaderboardCursor | null {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<LeaderboardCursor>;
    if (
      parsed.v !== 2 ||
      typeof parsed.boardKey !== "string" ||
      typeof parsed.snapshotId !== "string" ||
      !CURSOR_UUID.test(parsed.snapshotId) ||
      (parsed.category !== null && typeof parsed.category !== "string") ||
      (parsed.servingForm !== null && typeof parsed.servingForm !== "string") ||
      typeof parsed.completeOnly !== "boolean" ||
      typeof parsed.rank !== "number" ||
      !Number.isInteger(parsed.rank) ||
      parsed.rank < 1
    ) {
      return null;
    }
    return parsed as LeaderboardCursor;
  } catch {
    return null;
  }
}

const LEADERBOARD_TOTAL_CAFFEINE = "highest-total-caffeine";
const LEADERBOARD_CONCENTRATION = "highest-exact-concentration";
const LEADERBOARD_CAFFEINE_FREE = "caffeine-free";

function exactCaffeineConditions(): SQL[] {
  return [
    sql`${payloadColumn} -> 'caffeineMg' ->> 'state' = 'present'`,
    sql`${payloadColumn} -> 'caffeineMg' ->> 'qualifier' = 'exact'`,
    sql`${payloadColumn} -> 'caffeineMg' ->> 'value' is not null`,
    sql`(${payloadColumn} -> 'caffeineMg' ->> 'value')::double precision >= 0`,
  ];
}

function leaderboardEligibilityConditions(boardKey: string): SQL[] {
  const exact = exactCaffeineConditions();
  if (boardKey === LEADERBOARD_CONCENTRATION) {
    return [
      ...exact,
      sql`${payloadColumn} -> 'serving' ->> 'state' = 'present'`,
      sql`${payloadColumn} -> 'serving' ->> 'normalizedMl' is not null`,
      sql`(${payloadColumn} -> 'serving' ->> 'normalizedMl')::double precision > 0`,
    ];
  }
  if (boardKey === LEADERBOARD_CAFFEINE_FREE) {
    return [
      ...exact,
      sql`(${payloadColumn} -> 'caffeineMg' ->> 'value')::double precision = 0`,
    ];
  }
  if (boardKey === LEADERBOARD_TOTAL_CAFFEINE) return exact;
  return [];
}

function leaderboardFilterConditions(
  boardKey: string,
  options: LeaderboardFilterOptions,
): SQL[] {
  const conditions = leaderboardEligibilityConditions(boardKey);
  if (options.category !== undefined) {
    conditions.push(sql`${payloadColumn} ->> 'category' = ${options.category}`);
  }
  if (options.servingForm !== undefined && options.servingForm !== "") {
    conditions.push(sql`${payloadColumn} -> 'serving' ->> 'form' = ${options.servingForm}`);
  }
  if (options.completeOnly === true) {
    conditions.push(
      sql`${payloadColumn} -> 'serving' ->> 'state' = 'present'`,
      sql`${payloadColumn} -> 'serving' ->> 'value' is not null`,
      sql`${payloadColumn} -> 'serving' ->> 'unit' is not null`,
    );
  }
  return conditions;
}

function leaderboardExclusionReason(boardKey: string): SQL {
  const state = sql`${payloadColumn} -> 'caffeineMg' ->> 'state'`;
  const qualifier = sql`${payloadColumn} -> 'caffeineMg' ->> 'qualifier'`;
  const value = sql`${payloadColumn} -> 'caffeineMg' ->> 'value'`;
  const concentration = boardKey === LEADERBOARD_CONCENTRATION;
  return sql`case
    when ${state} = 'conflicting' then 'Conflicting values'
    when ${state} = 'unparseable' then 'Unparseable'
    when ${state} in ('not_published', 'not_applicable') then 'Not published'
    when ${qualifier} <> 'exact' or ${value} is null then 'Not an exact value'
    ${concentration ? sql`when ${payloadColumn} -> 'serving' ->> 'normalizedMl' is null then 'Serving volume unavailable'
    when (${payloadColumn} -> 'serving' ->> 'normalizedMl')::double precision <= 0 then 'Not concentration eligible'` : sql``}
    ${boardKey === LEADERBOARD_CAFFEINE_FREE ? sql`when (${value})::double precision <> 0 then 'Contains caffeine'` : sql``}
    else 'Not ranking eligible'
  end`;
}

/**
 * Entries of `boardKey` from the most recent immutable leaderboard snapshot
 * for that board, ordered by rank. Snapshots written by the A7b rebuild carry
 * their board in `summary.boardKey`, so the latest snapshot FOR the board is
 * selected; older snapshots without the tag fall back to the legacy behavior
 * (latest snapshot of any board, filtered by metric key). Returns null when
 * no snapshot exists at all; an existing snapshot without that board yields
 * empty entries.
 */
export async function getLeaderboard(
  boardKey: string,
  options: {
    limit?: number;
    cursor?: string | null;
  } & LeaderboardFilterOptions = {},
): Promise<LeaderboardResult | null> {
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 25), 1), 200);
  const cursor = options.cursor ? decodeLeaderboardCursor(options.cursor) : null;
  if (options.cursor && cursor === null) throw new InvalidCursorError();
  if (
    cursor &&
    (
      cursor.boardKey !== boardKey ||
      cursor.category !== (options.category ?? null) ||
      cursor.servingForm !== (options.servingForm ?? null) ||
      cursor.completeOnly !== (options.completeOnly ?? false)
    )
  ) {
    throw new InvalidCursorError();
  }

  const snapshots = await db
    .select({
      id: pulseLeaderboardSnapshots.id,
      rebuiltAt: pulseLeaderboardSnapshots.rebuiltAt,
      summary: pulseLeaderboardSnapshots.summary,
    })
    .from(pulseLeaderboardSnapshots)
    .where(
      cursor
        ? and(
            eq(pulseLeaderboardSnapshots.id, cursor.snapshotId),
            sql`${pulseLeaderboardSnapshots.summary} ->> 'boardKey' = ${boardKey}`,
          )
        : sql`${pulseLeaderboardSnapshots.summary} ->> 'boardKey' = ${boardKey}`,
    )
    .orderBy(
      desc(pulseLeaderboardSnapshots.rebuiltAt),
      desc(pulseLeaderboardSnapshots.id),
    )
    .limit(1);

  const snapshot = snapshots[0];

  if (!snapshot) return null;

  const previousSnapshot = (
    await db
      .select({ id: pulseLeaderboardSnapshots.id })
      .from(pulseLeaderboardSnapshots)
      .where(
        and(
          sql`${pulseLeaderboardSnapshots.summary} ->> 'boardKey' = ${boardKey}`,
          or(
            lt(pulseLeaderboardSnapshots.rebuiltAt, snapshot.rebuiltAt),
            and(
              eq(pulseLeaderboardSnapshots.rebuiltAt, snapshot.rebuiltAt),
              lt(pulseLeaderboardSnapshots.id, snapshot.id),
            ),
          ),
        ),
      )
      .orderBy(
        desc(pulseLeaderboardSnapshots.rebuiltAt),
        desc(pulseLeaderboardSnapshots.id),
      )
      .limit(1)
  )[0];

  const countConditions: SQL[] = [
    eq(pulseLeaderboardEntries.snapshotId, snapshot.id),
    eq(pulseLeaderboardEntries.metricKey, boardKey),
    trustedOnlyCondition(),
    ...leaderboardFilterConditions(boardKey, options),
  ];
  const entryConditions = [...countConditions];
  if (cursor) entryConditions.push(gt(pulseLeaderboardEntries.rank, cursor.rank));

  const [fetchedRows, countRows] = await Promise.all([
    db
      .select({
        productId: pulseLeaderboardEntries.productId,
        rank: pulseLeaderboardEntries.rank,
        metricKey: pulseLeaderboardEntries.metricKey,
        metricValue: pulseLeaderboardEntries.metricValue,
        eligible: pulseLeaderboardEntries.eligible,
        eligibilityFlags: pulseLeaderboardEntries.eligibilityFlags,
        productSlug: pulseProducts.slug,
        productName: pulseProducts.name,
        productCategory: sql<string>`${pulseProductObservations.normalized} ->> 'category'`,
      })
      .from(pulseLeaderboardEntries)
      .innerJoin(pulseProducts, eq(pulseLeaderboardEntries.productId, pulseProducts.id))
      .innerJoin(pulseProductObservations, trustedOnlyCondition())
      .where(and(...entryConditions))
      .orderBy(asc(pulseLeaderboardEntries.rank))
      .limit(limit + 1),
    db
      .select({ totalCount: sql<number>`count(*)::int` })
      .from(pulseLeaderboardEntries)
      .innerJoin(pulseProducts, eq(pulseLeaderboardEntries.productId, pulseProducts.id))
      .innerJoin(pulseProductObservations, trustedOnlyCondition())
      .where(and(...countConditions)),
  ]);
  const hasMore = fetchedRows.length > limit;
  const rows = hasMore ? fetchedRows.slice(0, limit) : fetchedRows;
  const priorRanks = new Map<string, number>();
  if (previousSnapshot && rows.length > 0) {
    const priorRows = await db
      .select({
        productId: pulseLeaderboardEntries.productId,
        rank: pulseLeaderboardEntries.rank,
      })
      .from(pulseLeaderboardEntries)
      .where(
        and(
          eq(pulseLeaderboardEntries.snapshotId, previousSnapshot.id),
          eq(pulseLeaderboardEntries.metricKey, boardKey),
          inArray(
            pulseLeaderboardEntries.productId,
            rows.map((row) => row.productId),
          ),
        ),
      );
    for (const row of priorRows) priorRanks.set(row.productId, row.rank);
  }
  const last = rows.at(-1);
  const nextCursor =
    hasMore && last
      ? encodeLeaderboardCursor({
          v: 2,
          boardKey,
          snapshotId: snapshot.id,
          category: options.category ?? null,
          servingForm: options.servingForm ?? null,
          completeOnly: options.completeOnly ?? false,
          rank: last.rank,
        })
      : null;
  const totalCount = Number(countRows[0]?.totalCount ?? 0);

  return {
    snapshotId: snapshot.id,
    rebuiltAt: snapshot.rebuiltAt,
    boardKey,
    trustedProductCount: Number(snapshot.summary?.trustedProductCount ?? 0),
    eligibleCount: totalCount,
    excludedCount: Math.max(
      Number(snapshot.summary?.trustedProductCount ?? 0) - totalCount,
      0,
    ),
    totalCount,
    nextCursor,
    entries: rows.map((row) => ({
      rank: row.rank,
      productId: row.productId,
      metricKey: row.metricKey,
      metricValue: row.metricValue,
      eligible: row.eligible,
      eligibilityFlags: row.eligibilityFlags ?? [],
      previousRank: priorRanks.get(row.productId) ?? null,
      rankDelta:
        priorRanks.has(row.productId)
          ? (priorRanks.get(row.productId) as number) - row.rank
          : null,
      product: {
        slug: row.productSlug,
        name: row.productName,
        category: (row.productCategory ?? "other") as CanonicalCategory,
      },
    })),
  };
}

/**
 * Returns the small facet set needed by the leaderboard sidebar. Counts and
 * serving forms are computed in SQL over the trusted pointer, so the page
 * never has to hydrate the entire catalog just to render its filters.
 */
export async function getLeaderboardFacets(
  boardKey: string,
): Promise<LeaderboardFacetResult> {
  const eligibilityConditions = leaderboardEligibilityConditions(boardKey);
  const eligibility = and(...eligibilityConditions) as SQL;
  const reason = leaderboardExclusionReason(boardKey);
  const trusted = trustedOnlyCondition();
  const [countRows, reasonRows, servingRows] = await Promise.all([
    db
      .select({
        eligibleCount: sql<number>`count(*) filter (where ${eligibility})`,
        excludedCount: sql<number>`count(*) filter (where not (${eligibility}))`,
      })
      .from(pulseProducts)
      .innerJoin(pulseProductObservations, trusted),
    db
      .select({ label: reason, count: sql<number>`count(*)` })
      .from(pulseProducts)
      .innerJoin(pulseProductObservations, trusted)
      .where(sql`not (${eligibility})`)
      .groupBy(reason)
      .orderBy(desc(sql`count(*)`), asc(reason)),
    db
      .select({ form: sql<string>`${payloadColumn} -> 'serving' ->> 'form'` })
      .from(pulseProducts)
      .innerJoin(pulseProductObservations, trusted)
      .where(eligibility)
      .groupBy(sql`${payloadColumn} -> 'serving' ->> 'form'`)
      .orderBy(asc(sql`${payloadColumn} -> 'serving' ->> 'form'`)),
  ]);
  return {
    eligibleCount: Number(countRows[0]?.eligibleCount ?? 0),
    excludedCount: Number(countRows[0]?.excludedCount ?? 0),
    reasons: reasonRows.map((row) => ({ label: String(row.label), count: Number(row.count) })),
    servingForms: servingRows
      .map((row) => row.form)
      .filter((form): form is string => Boolean(form)),
  };
}

/** Enrich only the ranked rows shown on the current page through trusted DTOs. */
export async function getTrustedProductsBySlugs(
  slugs: readonly string[],
): Promise<TrustedProductRow[]> {
  const uniqueSlugs = [...new Set(slugs)].filter(Boolean).slice(0, 200);
  if (uniqueSlugs.length === 0) return [];
  const rows = (await db
    .select(trustedSelect)
    .from(pulseProducts)
    .innerJoin(pulseProductObservations, trustedOnlyCondition())
    .leftJoin(pulseProductMediaPublications, withPublishedMedia())
    .where(and(trustedOnlyCondition(), inArray(pulseProducts.slug, uniqueSlugs)))) as TrustedJoinRow[];
  return rows.map(toTrustedProductRow);
}

// -- overview -----------------------------------------------------------------

export type OverviewStats = {
  trustedProductCount: number;
  categoryCount: number;
  fieldCoverage: {
    caffeineObserved: number;
    servingObserved: number;
    exactCaffeine: number;
    concentrationEligible: number;
  };
  featured: TrustedProductRow[];
};

/** Real trusted-catalog counters used by the home surface. */
export async function getOverviewStats(): Promise<OverviewStats> {
  const [countRow] = await db
    .select({
      total: sql<number>`count(distinct ${pulseProducts.id})::int`,
      caffeineObserved: sql<number>`count(distinct ${pulseProducts.id}) filter (where ${payloadColumn} -> 'caffeineMg' ->> 'state' not in ('not_published', 'not_applicable'))::int`,
      servingObserved: sql<number>`count(distinct ${pulseProducts.id}) filter (where ${payloadColumn} -> 'serving' ->> 'state' not in ('not_published', 'not_applicable'))::int`,
      exactCaffeine: sql<number>`count(distinct ${pulseProducts.id}) filter (where ${payloadColumn} -> 'caffeineMg' ->> 'state' = 'present' and ${payloadColumn} -> 'caffeineMg' ->> 'qualifier' = 'exact')::int`,
      concentrationEligible: sql<number>`count(distinct ${pulseProducts.id}) filter (where (${payloadColumn} -> 'concentration' ->> 'mgPer100Ml') is not null)::int`,
    })
    .from(pulseProducts)
    .innerJoin(pulseProductObservations, trustedOnlyCondition());

  const categories = await listCategories();
  const featured = await listProducts({ sort: "caffeine-desc", limit: 6 });

  return {
    trustedProductCount: Number(countRow?.total ?? 0),
    categoryCount: categories.length,
    fieldCoverage: {
      caffeineObserved: Number(countRow?.caffeineObserved ?? 0),
      servingObserved: Number(countRow?.servingObserved ?? 0),
      exactCaffeine: Number(countRow?.exactCaffeine ?? 0),
      concentrationEligible: Number(countRow?.concentrationEligible ?? 0),
    },
    featured: featured.items,
  };
}

// -- changes ------------------------------------------------------------------

export const DEFAULT_CHANGES_LIMIT = 20;

export type ChangeEventDto = {
  id: string;
  slug: string;
  productName: string;
  eventType: PublicChangeEventType;
  field: string;
  before: ChangePoint | null;
  after: ChangePoint | null;
  occurredAt: string;
  /** Exact allowlisted source page carried by the trusted observation, when valid. */
  sourceUrl: string | null;
  /** Trusted observation timestamp; this is not claimed to be the source access time. */
  sourceObservationAt: string | null;
};

export type ChangeListResult = {
  items: ChangeEventDto[];
  nextCursor: string | null;
};

/**
 * Recent change events (newest first, keyset-paged).
 *
 * Publishes only the allowlisted field-level change point. Raw source bodies,
 * arbitrary JSON keys, and source prose never leave this boundary.
 */
export async function listChanges(
  options: { cursor?: string | null | undefined; limit?: number | undefined } = {},
): Promise<ChangeListResult> {
  const limit = Math.min(
    Math.max(Math.trunc(options.limit ?? DEFAULT_CHANGES_LIMIT), 1),
    100,
  );

  const conditions: SQL[] = [];
  if (options.cursor) {
    const decoded = decodeChangesCursor(options.cursor);
    if (!decoded) throw new InvalidCursorError();
    conditions.push(sql`(
      ${pulseChangeEvents.occurredAt} < ${decoded.occurredAt}
      or (
        ${pulseChangeEvents.occurredAt} = ${decoded.occurredAt}
        and ${pulseChangeEvents.id} < ${decoded.id}
      )
    )`);
  }

  // The FK is nullable for legacy rows. Preserve those rows with no
  // provenance, but never publish an event linked to a candidate,
  // quarantined, rejected, or otherwise untrusted observation.
  const publicProvenance = or(
    isNull(pulseChangeEvents.productObservationId),
    inArray(pulseProductObservations.status, PUBLIC_CHANGE_OBSERVATION_STATUSES),
  );

  const rows = await db
    .select({
      id: pulseChangeEvents.id,
      slug: pulseProducts.slug,
      productName: pulseProducts.name,
      eventType: pulseChangeEvents.eventType,
      before: pulseChangeEvents.before,
      after: pulseChangeEvents.after,
      occurredAt: pulseChangeEvents.occurredAt,
      sourceUrl: sql<string | null>`${pulseProductObservations.normalized}->>'sourceUrl'`,
      sourceObservationAt: pulseProductObservations.observedAt,
    })
    .from(pulseChangeEvents)
    .innerJoin(pulseProducts, eq(pulseChangeEvents.productId, pulseProducts.id))
    // Change events retain the observation that was trusted when the event
    // was created. That observation may be superseded by a later trusted
    // snapshot, so do not filter historical events by its current status.
    .leftJoin(
      pulseProductObservations,
      eq(pulseChangeEvents.productObservationId, pulseProductObservations.id),
    )
    .where(and(...conditions, publicProvenance))
    .orderBy(desc(pulseChangeEvents.occurredAt), desc(pulseChangeEvents.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) nextCursor = encodeChangesCursor(last.id, last.occurredAt);
  }

  return {
    items: page.map((row) => {
      const eventType = sanitizeChangeEventType(row.eventType);
      return {
        id: row.id,
        slug: row.slug,
        productName: row.productName,
        eventType,
        field: changeField(eventType, row.before, row.after),
        before: sanitizeChangePoint(row.before),
        after: sanitizeChangePoint(row.after),
        occurredAt: row.occurredAt.toISOString(),
        sourceUrl: sanitizeChangeSourceUrl(row.sourceUrl),
        sourceObservationAt: row.sourceObservationAt?.toISOString() ?? null,
      };
    }),
    nextCursor,
  };
}

/** Public changes may carry only the exact HTTPS Caffeine Informer page URL. */
function sanitizeChangeSourceUrl(value: string | null): string | null {
  return authorizeProductSourceUrl(value);
}

type ChangesCursorPayload = { v: 1; id: string; occurredAt: string };

function encodeChangesCursor(id: string, occurredAt: Date): string {
  const payload: ChangesCursorPayload = {
    v: 1,
    id,
    occurredAt: occurredAt.toISOString(),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeChangesCursor(cursor: string): ChangesCursorPayload | null {
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      (parsed as { v?: unknown }).v === 1 &&
      typeof (parsed as { id?: unknown }).id === "string" &&
      CURSOR_UUID.test((parsed as { id: string }).id) &&
      typeof (parsed as { occurredAt?: unknown }).occurredAt === "string" &&
      !Number.isNaN(
        Date.parse((parsed as { occurredAt: string }).occurredAt),
      )
    ) {
      return parsed as ChangesCursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// -- live data ----------------------------------------------------------------

export const LIVE_DATA_SCHEMA_VERSION = "1.1";
const PUBLIC_LIVE_DATA_SOURCE_SLUG = "caffeine-informer";

function isoTimestamp(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export type LiveDataStats = {
  schemaVersion: "1.1";
  /**
   * REAL counts of product observations grouped by pipeline status. These are
   * plain database counts — no derived confidence scores exist anywhere.
   */
  observationCounts: {
    trusted: number;
    candidate: number;
    quarantined: number;
    rejected: number;
    superseded: number;
  };
  /** Finish, start, or creation time of the most recent eligible run; null when none. */
  lastCollectionRunAt: string | null;
  /** Count of incidents currently in `open` state. */
  openIncidentCount: number;
  trustedProductCount: number;
  freshness: {
    latestTrustedObservationAt: string | null;
    latestSuccessfulCollectionAt: string | null;
  };
  /** Approved public source records; collector/provider identifiers stay private. */
  activeCollectors: Array<{ source: string }>;
  lastCollectionRun: {
    status: string;
    trigger: string;
    rowCount: number | null;
    at: string | null;
  } | null;
  recentRuns: SanitizedLiveRun[];
};

/** Real operational counters for the live-data endpoint. */
export async function getLiveDataStats(): Promise<LiveDataStats> {
  const statusRows = await db
    .select({
      status: pulseProductObservations.status,
      count: sql<number>`count(*)::int`,
    })
    .from(pulseProductObservations)
    .innerJoin(pulseSources, eq(pulseProductObservations.sourceId, pulseSources.id))
    .where(
      and(
        eq(pulseSources.slug, PUBLIC_LIVE_DATA_SOURCE_SLUG),
        eq(pulseSources.active, true),
      ),
    )
    .groupBy(pulseProductObservations.status);

  const observationCounts: LiveDataStats["observationCounts"] = {
    trusted: 0,
    candidate: 0,
    quarantined: 0,
    rejected: 0,
    superseded: 0,
  };
  for (const row of statusRows) {
    if (row.status in observationCounts) {
      observationCounts[row.status as keyof LiveDataStats["observationCounts"]] =
        Number(row.count);
    }
  }

  const recentRunRows = await db
    .select({
      finishedAt: pulseCollectionRuns.finishedAt,
      startedAt: pulseCollectionRuns.startedAt,
      status: pulseCollectionRuns.status,
      trigger: pulseCollectionRuns.trigger,
      rowCount: pulseCollectionRuns.rowCount,
      report: pulseCollectionRuns.report,
      createdAt: pulseCollectionRuns.createdAt,
    })
    .from(pulseCollectionRuns)
    .innerJoin(pulseCollectors, eq(pulseCollectionRuns.collectorId, pulseCollectors.id))
    .innerJoin(pulseSources, eq(pulseCollectors.sourceId, pulseSources.id))
    .where(
      and(
        eq(pulseCollectors.active, true),
        eq(pulseSources.active, true),
        eq(pulseSources.slug, PUBLIC_LIVE_DATA_SOURCE_SLUG),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${pulseCollectionRuns.finishedAt}, ${pulseCollectionRuns.startedAt}, ${pulseCollectionRuns.createdAt})`,
      ),
    )
    .limit(10);
  const lastRun = recentRunRows[0];
  const lastRunMoment = lastRun?.finishedAt ?? lastRun?.startedAt ?? lastRun?.createdAt ?? null;

  const incidentRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pulseIncidents)
    .innerJoin(pulseCollectionRuns, eq(pulseIncidents.collectionRunId, pulseCollectionRuns.id))
    .innerJoin(pulseCollectors, eq(pulseCollectionRuns.collectorId, pulseCollectors.id))
    .innerJoin(pulseSources, eq(pulseCollectors.sourceId, pulseSources.id))
    .where(
      and(
        eq(pulseIncidents.status, "open"),
        eq(pulseCollectors.active, true),
        eq(pulseSources.active, true),
        eq(pulseSources.slug, PUBLIC_LIVE_DATA_SOURCE_SLUG),
      ),
    );

  const collectorRows = await db
    .select({ source: pulseSources.displayName })
    .from(pulseCollectors)
    .innerJoin(pulseSources, eq(pulseCollectors.sourceId, pulseSources.id))
    .where(
      and(
        eq(pulseCollectors.active, true),
        eq(pulseSources.active, true),
        eq(pulseSources.slug, PUBLIC_LIVE_DATA_SOURCE_SLUG),
      ),
    )
    .orderBy(asc(pulseSources.displayName));

  const [trustedSummary] = await db
    .select({
      productCount: sql<number>`count(distinct ${pulseProducts.id})::int`,
      latestObservedAt: sql<Date | string | null>`max(${pulseProductObservations.observedAt})`,
    })
    .from(pulseProducts)
    .innerJoin(pulseProductObservations, trustedOnlyCondition())
    .innerJoin(pulseSources, eq(pulseProductObservations.sourceId, pulseSources.id))
    .where(
      and(
        eq(pulseSources.slug, PUBLIC_LIVE_DATA_SOURCE_SLUG),
        eq(pulseSources.active, true),
      ),
    );

  const [latestSuccessful] = await db
    .select({
      finishedAt: pulseCollectionRuns.finishedAt,
      startedAt: pulseCollectionRuns.startedAt,
      createdAt: pulseCollectionRuns.createdAt,
    })
    .from(pulseCollectionRuns)
    .innerJoin(pulseCollectors, eq(pulseCollectionRuns.collectorId, pulseCollectors.id))
    .innerJoin(pulseSources, eq(pulseCollectors.sourceId, pulseSources.id))
    .where(
      and(
        inArray(pulseCollectionRuns.status, ["succeeded", "validated"]),
        eq(pulseCollectors.active, true),
        eq(pulseSources.active, true),
        eq(pulseSources.slug, PUBLIC_LIVE_DATA_SOURCE_SLUG),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${pulseCollectionRuns.finishedAt}, ${pulseCollectionRuns.startedAt}, ${pulseCollectionRuns.createdAt})`,
      ),
    )
    .limit(1);
  const latestSuccessfulAt =
    latestSuccessful?.finishedAt ?? latestSuccessful?.startedAt ?? latestSuccessful?.createdAt ?? null;
  const sanitizedRecentRuns = recentRunRows.map((run) =>
    sanitizeLiveRun({
      status: run.status,
      trigger: run.trigger,
      rowCount: run.rowCount,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      createdAt: run.createdAt,
      report: run.report ?? null,
    }),
  );
  const latestPublicRun = sanitizedRecentRuns[0] ?? null;

  return {
    schemaVersion: LIVE_DATA_SCHEMA_VERSION,
    observationCounts,
    lastCollectionRunAt: lastRunMoment ? lastRunMoment.toISOString() : null,
    openIncidentCount: Number(incidentRows[0]?.count ?? 0),
    trustedProductCount: Number(trustedSummary?.productCount ?? 0),
    freshness: {
      latestTrustedObservationAt:
        isoTimestamp(trustedSummary?.latestObservedAt),
      latestSuccessfulCollectionAt: latestSuccessfulAt?.toISOString() ?? null,
    },
    activeCollectors: collectorRows.map((row) => ({ source: row.source })),
    lastCollectionRun: latestPublicRun
      ? {
          status: latestPublicRun.status,
          trigger: latestPublicRun.trigger,
          rowCount: latestPublicRun.rowCounts.collected,
          at: lastRunMoment ? lastRunMoment.toISOString() : null,
        }
      : null,
    recentRuns: sanitizedRecentRuns,
  };
}

// -- errors -------------------------------------------------------------------

/** Raised when a caller supplies a malformed or foreign cursor. */
export class InvalidCursorError extends Error {
  constructor() {
    super("malformed pagination cursor");
    this.name = "InvalidCursorError";
  }
}
