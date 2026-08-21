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
 * Plan reference: PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §"Agent A8 —
 * Public API" (endpoints, required pagination and filters). Pagination is
 * keyset-based; cursors are opaque base64url strings carrying the sort value
 * plus a tiebreaker id, so pages stay stable across concurrent inserts.
 */

import { and, asc, desc, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  pulseChangeEvents,
  pulseCollectors,
  pulseCollectionRuns,
  pulseIncidents,
  pulseLeaderboardEntries,
  pulseLeaderboardSnapshots,
  pulseProductAliases,
  pulseProducts,
  pulseProductObservations,
} from "@/server/db/schema/pulse";
import type { CanonicalCategory } from "@/server/ingestion/normalize";
import type { TrustedProductRecord } from "@/server/ingestion/promote";
import type {
  TrustedObservationPayload,
  TrustedProductRow,
} from "@/server/products/dto";

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
    eq(pulseProductObservations.status, "trusted"),
  ) as SQL;
}

type TrustedJoinRow = {
  slug: string;
  name: string;
  categoryLabel: string | null;
  observationId: string;
  observedAt: Date;
  status: string;
  normalized: unknown;
};

const trustedSelect = {
  slug: pulseProducts.slug,
  name: pulseProducts.name,
  categoryLabel: pulseProducts.categoryLabel,
  observationId: pulseProductObservations.id,
  observedAt: pulseProductObservations.observedAt,
  status: pulseProductObservations.status,
  normalized: pulseProductObservations.normalized,
};

function toTrustedProductRow(row: TrustedJoinRow): TrustedProductRow {
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
    payload: row.normalized as TrustedObservationPayload,
  };
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
  /** Opaque cursor for the next page, or null when this is the last page. */
  nextCursor: string | null;
};

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

type CursorPayload = {
  v: 1;
  k: ProductSortOption;
  id: string;
  s?: string | undefined; // name / newest timestamp (ISO)
  n?: number | undefined; // caffeine value
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
      typeof (parsed as { id?: unknown }).id === "string"
    ) {
      return parsed as CursorPayload;
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
      return sql`(
        ${caffeineSortExpression()} < ${cursor.n ?? Number.NEGATIVE_INFINITY}
        or (
          ${caffeineSortExpression()} = ${cursor.n ?? Number.NEGATIVE_INFINITY}
          and ${pulseProducts.id} > ${cursor.id}
        )
      )`;
    case "caffeine-asc":
      return sql`(
        ${caffeineSortExpression()} > ${cursor.n ?? Number.POSITIVE_INFINITY}
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
): { s?: string | undefined; n?: number | undefined } {
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
      return typeof value === "number" ? { n: value } : {};
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

  const conditions = filterConditions(filters);
  if (filters.cursor) {
    const cursor = decodeCursor(filters.cursor);
    // A cursor minted for a different sort must never be silently re-applied
    // under another ordering — that yields wrong pages. Fail loudly instead.
    if (!cursor || cursor.k !== sort) throw new InvalidCursorError();
    conditions.push(keysetCondition(cursor.k, cursor));
  }

  const rows = (await db
    .select(trustedSelect)
    .from(pulseProducts)
    .innerJoin(
      pulseProductObservations,
      and(
        eq(pulseProducts.currentTrustedObservationId, pulseProductObservations.id),
        eq(pulseProductObservations.status, "trusted"),
      ),
    )
    .where(and(...conditions))
    .orderBy(...sortClauses(sort))
    .limit(limit + 1)) as TrustedJoinRow[];

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  let nextCursor: string | null = null;
  if (hasMore) {
    const last = page[page.length - 1];
    if (last) {
      nextCursor = encodeCursor({
        v: 1,
        k: sort,
        id: last.observationId,
        ...cursorValueFor(sort, last),
      });
    }
  }

  return { items: page.map(toTrustedProductRow), nextCursor };
}

/** One trusted product by slug, or null when absent/not yet trusted. */
export async function getProductBySlug(
  slug: string,
): Promise<TrustedProductRow | null> {
  const rows = (await db
    .select(trustedSelect)
    .from(pulseProducts)
    .innerJoin(
      pulseProductObservations,
      and(
        eq(pulseProducts.currentTrustedObservationId, pulseProductObservations.id),
        eq(pulseProductObservations.status, "trusted"),
      ),
    )
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
    .innerJoin(
      pulseProductObservations,
      and(
        eq(pulseProducts.currentTrustedObservationId, pulseProductObservations.id),
        eq(pulseProductObservations.status, "trusted"),
      ),
    )
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
};

export type LeaderboardResult = {
  snapshotId: string;
  rebuiltAt: Date;
  boardKey: string;
  entries: LeaderboardEntryDto[];
};

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
  limit = 50,
): Promise<LeaderboardResult | null> {
  const tagged = await db
    .select({
      id: pulseLeaderboardSnapshots.id,
      rebuiltAt: pulseLeaderboardSnapshots.rebuiltAt,
    })
    .from(pulseLeaderboardSnapshots)
    .where(sql`${pulseLeaderboardSnapshots.summary} ->> 'boardKey' = ${boardKey}`)
    .orderBy(desc(pulseLeaderboardSnapshots.rebuiltAt))
    .limit(1);

  const snapshot =
    tagged[0] ??
    (
      await db
        .select({
          id: pulseLeaderboardSnapshots.id,
          rebuiltAt: pulseLeaderboardSnapshots.rebuiltAt,
        })
        .from(pulseLeaderboardSnapshots)
        .orderBy(desc(pulseLeaderboardSnapshots.rebuiltAt))
        .limit(1)
    )[0];

  if (!snapshot) return null;

  const rows = await db
    .select({
      productId: pulseLeaderboardEntries.productId,
      rank: pulseLeaderboardEntries.rank,
      metricKey: pulseLeaderboardEntries.metricKey,
      metricValue: pulseLeaderboardEntries.metricValue,
      eligible: pulseLeaderboardEntries.eligible,
      eligibilityFlags: pulseLeaderboardEntries.eligibilityFlags,
    })
    .from(pulseLeaderboardEntries)
    .where(
      and(
        eq(pulseLeaderboardEntries.snapshotId, snapshot.id),
        eq(pulseLeaderboardEntries.metricKey, boardKey),
      ),
    )
    .orderBy(asc(pulseLeaderboardEntries.rank))
    .limit(Math.min(Math.max(Math.trunc(limit), 1), 200));

  return {
    snapshotId: snapshot.id,
    rebuiltAt: snapshot.rebuiltAt,
    boardKey,
    entries: rows.map((row) => ({
      rank: row.rank,
      productId: row.productId,
      metricKey: row.metricKey,
      metricValue: row.metricValue,
      eligible: row.eligible,
      eligibilityFlags: row.eligibilityFlags ?? [],
    })),
  };
}

// -- changes ------------------------------------------------------------------

export const DEFAULT_CHANGES_LIMIT = 20;

export type ChangeEventDto = {
  id: string;
  slug: string;
  productName: string;
  eventType: string;
  occurredAt: string;
};

export type ChangeListResult = {
  items: ChangeEventDto[];
  nextCursor: string | null;
};

/**
 * Recent change events (newest first, keyset-paged).
 *
 * Deliberately exposes event metadata only — `before`/`after` bodies are raw
 * internal records and stay unpublished (no long raw text leaves the API).
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

  const rows = await db
    .select({
      id: pulseChangeEvents.id,
      slug: pulseProducts.slug,
      productName: pulseProducts.name,
      eventType: pulseChangeEvents.eventType,
      occurredAt: pulseChangeEvents.occurredAt,
    })
    .from(pulseChangeEvents)
    .innerJoin(pulseProducts, eq(pulseChangeEvents.productId, pulseProducts.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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
    items: page.map((row) => ({
      id: row.id,
      slug: row.slug,
      productName: row.productName,
      eventType: row.eventType,
      occurredAt: row.occurredAt.toISOString(),
    })),
    nextCursor,
  };
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
      typeof (parsed as { occurredAt?: unknown }).occurredAt === "string"
    ) {
      return parsed as ChangesCursorPayload;
    }
    return null;
  } catch {
    return null;
  }
}

// -- live data ----------------------------------------------------------------

export const LIVE_DATA_SCHEMA_VERSION = "1.0";

export type LiveDataStats = {
  schemaVersion: "1.0";
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
  /** Finish time (or start time) of the most recent collection run; null when none. */
  lastCollectionRunAt: string | null;
  /** Count of incidents currently in `open` state. */
  openIncidentCount: number;
  /** External ids of ACTIVE PulseRank collectors (legacy ids never register here). */
  collectorIds: string[];
};

/** Real operational counters for the live-data endpoint. */
export async function getLiveDataStats(): Promise<LiveDataStats> {
  const statusRows = await db
    .select({
      status: pulseProductObservations.status,
      count: sql<number>`count(*)::int`,
    })
    .from(pulseProductObservations)
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

  const lastRunRows = await db
    .select({
      finishedAt: pulseCollectionRuns.finishedAt,
      startedAt: pulseCollectionRuns.startedAt,
    })
    .from(pulseCollectionRuns)
    .orderBy(
      desc(sql`coalesce(${pulseCollectionRuns.finishedAt}, ${pulseCollectionRuns.startedAt})`),
    )
    .limit(1);
  const lastRun = lastRunRows[0];
  const lastRunMoment = lastRun?.finishedAt ?? lastRun?.startedAt ?? null;

  const incidentRows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pulseIncidents)
    .where(eq(pulseIncidents.status, "open"));

  const collectorRows = await db
    .select({ externalId: pulseCollectors.externalId })
    .from(pulseCollectors)
    .where(eq(pulseCollectors.active, true))
    .orderBy(asc(pulseCollectors.externalId));

  return {
    schemaVersion: LIVE_DATA_SCHEMA_VERSION,
    observationCounts,
    lastCollectionRunAt: lastRunMoment ? lastRunMoment.toISOString() : null,
    openIncidentCount: Number(incidentRows[0]?.count ?? 0),
    collectorIds: collectorRows.map((row) => row.externalId),
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
