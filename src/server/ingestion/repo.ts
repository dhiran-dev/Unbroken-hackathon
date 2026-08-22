/**
 * PulseRank ingestion repository (Agent A7b).
 *
 * Thin persistence layer between the pulse-job handlers and the `pulse.*`
 * schema. The handlers in `@/server/jobs/pulse-handlers` are pure
 * orchestration: they receive a `PulseRepo` and never touch drizzle directly.
 * Two implementations share the interface:
 *
 * - `createDbPulseRepo(db)` — real drizzle/postgres-js implementation bound to
 *   a connection or transaction handle. All SQL lives here.
 * - `createInMemoryPulseRepo()` — deterministic in-memory double used by unit
 *   tests. It emulates the unique constraints the schema enforces
 *   ((source_id, page_fingerprint), (source_id, slug, observed_at),
 *   (snapshot_id, product_id), …) so idempotency behavior is testable without
 *   a database.
 *
 * Import-safety: this module NEVER imports `@/server/db/client` statically —
 * that would open a postgres pool (and require env vars) at import time. The
 * transaction runner resolves the client lazily inside the call, so unit tests
 * can import this file freely.
 */

import { and, asc, desc, eq, isNull, lt, ne } from "drizzle-orm";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgTransaction } from "drizzle-orm/pg-core";
import type {
  PostgresJsDatabase,
  PostgresJsQueryResultHKT,
} from "drizzle-orm/postgres-js";

import type * as fullSchema from "@/server/db/schema";
import {
  pulseChangeEvents,
  pulseCollectors,
  pulseCollectionRuns,
  pulseFlavourObservations,
  pulseFlavours,
  pulseIncidents,
  pulseHealSessions,
  pulseLeaderboardEntries,
  pulseLeaderboardSnapshots,
  pulseProductObservations,
  pulseProducts,
  pulseRawRecords,
  pulseSources,
  pulseVariantObservations,
  pulseVariants,
} from "@/server/db/schema/pulse";

/**
 * JSON object shape of the pulse schema's jsonb columns (mirrors the
 * non-exported `JsonObject` in src/server/db/schema/pulse.ts).
 */
export type JsonObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Row shapes (what handlers see; mirrors the pulse.* columns they need)
// ---------------------------------------------------------------------------

export type ObservationStatus =
  | "candidate"
  | "trusted"
  | "quarantined"
  | "rejected"
  | "superseded";

export type CollectionRunRow = {
  id: string;
  collectorId: string;
  trigger: string;
  status: string;
  rowCount: number | null;
  pageFingerprint: string | null;
  report: JsonObject | null;
  errorCode: string | null;
  errorSummary: string | null;
  createdAt: Date;
};

export type RawRecordRow = {
  id: string;
  collectionRunId: string;
  collectorId: string;
  payload: JsonObject;
  mediaType: string;
  pageFingerprint: string;
  capturedAt: Date;
};

export type SourceRow = {
  id: string;
  slug: string;
  active: boolean;
};

export type CollectorRow = {
  id: string;
  sourceId: string;
  externalId: string;
  active: boolean;
};

export type ProductRow = {
  id: string;
  slug: string;
  name: string;
  categoryLabel: string | null;
  currentTrustedObservationId: string | null;
};

export type VariantRow = {
  id: string;
  productId: string;
  slug: string;
  name: string;
};

export type FlavourRow = {
  id: string;
  productId: string;
  slug: string;
  name: string;
};

export type ObservationRow = {
  id: string;
  productId: string;
  sourceId: string;
  slug: string;
  observedAt: Date;
  pageFingerprint: string;
  status: string;
  normalized: JsonObject;
};

export type IncidentRow = {
  id: string;
  collectionRunId: string | null;
  title: string;
  summary: string;
  status: string;
};

export type HealSessionRow = {
  id: string;
  collectorId: string;
  prompt: string;
  preview: JsonObject;
  approvedAt: Date | null;
  approvedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TrustedPayloadRow = {
  productId: string;
  productSlug: string;
  observationId: string;
  payload: JsonObject;
};

// ---------------------------------------------------------------------------
// Input shapes
// ---------------------------------------------------------------------------

export type InsertCollectionRunInput = {
  collectorId: string;
  trigger: string;
  status: string;
  startedAt: Date | null;
  finishedAt: Date | null;
  rowCount: number | null;
  pageFingerprint: string | null;
  report: JsonObject | null;
};

export type CollectionRunPatch = {
  status?: string;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  rowCount?: number | null;
  /** Run-level fingerprint of the whole collected output (set on success). */
  pageFingerprint?: string | null;
  report?: JsonObject | null;
  errorCode?: string | null;
  errorSummary?: string | null;
};

export type InsertRawRecordInput = {
  collectionRunId: string;
  collectorId: string;
  payload: JsonObject;
  mediaType: string;
  pageFingerprint: string;
  capturedAt: Date;
};

export type InsertObservationInput = {
  productId: string;
  sourceId: string;
  slug: string;
  observedAt: Date;
  pageFingerprint: string;
  status: ObservationStatus;
  normalized: JsonObject;
};

export type InsertVariantObservationInput = {
  variantId: string;
  productObservationId: string;
  observedAt: Date;
  normalized: JsonObject;
};

export type InsertFlavourObservationInput = {
  flavourId: string;
  productObservationId: string;
  observedAt: Date;
  normalized: JsonObject;
};

export type OpenIncidentInput = {
  collectionRunId: string | null;
  title: string;
  summary: string;
  detectedAt: Date;
};

export type InsertHealSessionInput = {
  collectorId: string;
  prompt: string;
  preview: JsonObject;
};

export type InsertChangeEventInput = {
  productId: string;
  eventType: string;
  before: JsonObject | null;
  after: JsonObject | null;
  productObservationId: string | null;
  occurredAt: Date;
};

export type InsertLeaderboardEntryInput = {
  snapshotId: string;
  productId: string;
  rank: number;
  metricKey: string;
  metricValue: number;
  eligible: boolean;
  eligibilityFlags: string[];
};

/** Transaction/connection handle accepted by the drizzle-backed repo. */
export type PulseDbHandle = PulseDatabase | PulseTransaction;

export type PulseDatabase = PostgresJsDatabase<typeof fullSchema>;
export type PulseTransaction = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof fullSchema,
  ExtractTablesWithRelations<typeof fullSchema>
>;

/**
 * Runs `work` inside ONE database transaction, handing it a repo bound to the
 * transaction handle so every write a handler performs commits or rolls back
 * atomically. Resolves the db client lazily (dynamic import) so importing this
 * module never opens a connection.
 */
export async function runInPulseTransaction<T>(
  work: (repo: PulseRepo) => Promise<T>,
): Promise<T> {
  const { db } = await import("@/server/db/client");
  return db.transaction(async (tx) => work(createDbPulseRepo(tx)));
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface PulseRepo {
  // -- collection runs + raw records ----------------------------------------
  getCollectionRun(runId: string): Promise<CollectionRunRow | null>;
  listRawRecords(runId: string): Promise<RawRecordRow[]>;
  insertCollectionRun(input: InsertCollectionRunInput): Promise<CollectionRunRow>;
  updateCollectionRun(runId: string, patch: CollectionRunPatch): Promise<void>;
  insertRawRecord(input: InsertRawRecordInput): Promise<RawRecordRow>;
  /** Row count of the most recent earlier run for this collector, if any. */
  getPreviousRunRowCount(
    collectorId: string,
    excludeRunId: string,
    before: Date,
  ): Promise<number | null>;

  // -- sources + collectors --------------------------------------------------
  findSourceBySlug(slug: string): Promise<SourceRow | null>;
  findActiveCollector(): Promise<CollectorRow | null>;

  // -- products, variants, flavours -------------------------------------------
  upsertProductBySlug(input: {
    slug: string;
    name: string;
    categoryLabel: string | null;
  }): Promise<ProductRow>;
  getProduct(productId: string): Promise<ProductRow | null>;
  updateProduct(
    productId: string,
    patch: {
      currentTrustedObservationId?: string | null;
      name?: string;
      categoryLabel?: string | null;
    },
  ): Promise<void>;
  ensureVariant(productId: string, name: string): Promise<VariantRow>;
  ensureFlavour(productId: string, name: string): Promise<FlavourRow>;

  // -- observations ------------------------------------------------------------
  findObservationBySourceFingerprint(
    sourceId: string,
    pageFingerprint: string,
  ): Promise<ObservationRow | null>;
  /** Returns null when a unique constraint made the insert a no-op. */
  insertObservation(input: InsertObservationInput): Promise<ObservationRow | null>;
  getObservation(id: string): Promise<ObservationRow | null>;
  updateObservation(
    id: string,
    patch: { status?: ObservationStatus; normalized?: JsonObject },
  ): Promise<void>;
  /** Demotes every other trusted observation of the product; returns count. */
  supersedeOtherTrustedObservations(
    productId: string,
    keepObservationId: string,
  ): Promise<number>;
  listCandidateObservationsByFingerprints(
    sourceId: string,
    fingerprints: readonly string[],
  ): Promise<ObservationRow[]>;
  /** False when the (observation, variant) pair already existed. */
  insertVariantObservation(input: InsertVariantObservationInput): Promise<boolean>;
  /** False when the (observation, flavour) pair already existed. */
  insertFlavourObservation(input: InsertFlavourObservationInput): Promise<boolean>;

  // -- promotion outputs ---------------------------------------------------------
  openIncident(input: OpenIncidentInput): Promise<IncidentRow>;
  insertChangeEvent(input: InsertChangeEventInput): Promise<void>;

  // -- healing sessions -----------------------------------------------------------
  insertHealSession(input: InsertHealSessionInput): Promise<HealSessionRow>;
  getHealSession(sessionId: string): Promise<HealSessionRow | null>;
  updateHealSessionPreview(sessionId: string, preview: JsonObject): Promise<void>;
  approveHealSession(sessionId: string, approvedBy: string): Promise<void>;

  // -- leaderboards -----------------------------------------------------------------
  listTrustedObservationPayloads(): Promise<TrustedPayloadRow[]>;
  insertLeaderboardSnapshot(summary: JsonObject): Promise<string>;
  insertLeaderboardEntry(input: InsertLeaderboardEntryInput): Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** True when the value looks like a uuid (the only run-id shape accepted). */
export function isUuidLike(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** Deterministic variant/flavour slug derived from a display name. */
export function entitySlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "unnamed" : slug;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

// ---------------------------------------------------------------------------
// Drizzle-backed implementation (all SQL lives here)
// ---------------------------------------------------------------------------

export function createDbPulseRepo(db: PulseDbHandle): PulseRepo {
  return {
    async getCollectionRun(runId) {
      const rows = await db
        .select()
        .from(pulseCollectionRuns)
        .where(eq(pulseCollectionRuns.id, runId))
        .limit(1);
      const row = rows[0];
      return row ? mapRun(row) : null;
    },

    async listRawRecords(runId) {
      const rows = await db
        .select()
        .from(pulseRawRecords)
        .where(eq(pulseRawRecords.collectionRunId, runId))
        .orderBy(asc(pulseRawRecords.capturedAt), asc(pulseRawRecords.id));
      return rows.map((row) => ({
        id: row.id,
        collectionRunId: row.collectionRunId,
        collectorId: row.collectorId,
        payload: row.payload,
        mediaType: row.mediaType,
        pageFingerprint: row.pageFingerprint,
        capturedAt: row.capturedAt,
      }));
    },

    async insertCollectionRun(input) {
      const rows = await db
        .insert(pulseCollectionRuns)
        .values({
          collectorId: input.collectorId,
          trigger: input.trigger,
          status: input.status,
          startedAt: input.startedAt,
          finishedAt: input.finishedAt,
          rowCount: input.rowCount,
          pageFingerprint: input.pageFingerprint,
          report: input.report ?? undefined,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error("insertCollectionRun returned no row");
      return mapRun(row);
    },

    async updateCollectionRun(runId, patch) {
      await db
        .update(pulseCollectionRuns)
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
          ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
          ...(patch.rowCount !== undefined ? { rowCount: patch.rowCount } : {}),
          ...(patch.pageFingerprint !== undefined
            ? { pageFingerprint: patch.pageFingerprint }
            : {}),
          ...(patch.report !== undefined ? { report: patch.report ?? undefined } : {}),
          ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
          ...(patch.errorSummary !== undefined
            ? { errorSummary: patch.errorSummary }
            : {}),
        })
        .where(eq(pulseCollectionRuns.id, runId));
    },

    async insertRawRecord(input) {
      const rows = await db
        .insert(pulseRawRecords)
        .values({
          collectionRunId: input.collectionRunId,
          collectorId: input.collectorId,
          payload: input.payload,
          mediaType: input.mediaType,
          pageFingerprint: input.pageFingerprint,
          capturedAt: input.capturedAt,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error("insertRawRecord returned no row");
      return {
        id: row.id,
        collectionRunId: row.collectionRunId,
        collectorId: row.collectorId,
        payload: row.payload,
        mediaType: row.mediaType,
        pageFingerprint: row.pageFingerprint,
        capturedAt: row.capturedAt,
      };
    },

    async getPreviousRunRowCount(collectorId, excludeRunId, before) {
      const rows = await db
        .select({ rowCount: pulseCollectionRuns.rowCount })
        .from(pulseCollectionRuns)
        .where(
          and(
            eq(pulseCollectionRuns.collectorId, collectorId),
            ne(pulseCollectionRuns.id, excludeRunId),
            lt(pulseCollectionRuns.createdAt, before),
          ),
        )
        .orderBy(desc(pulseCollectionRuns.createdAt))
        .limit(1);
      return rows[0]?.rowCount ?? null;
    },

    async findSourceBySlug(slug) {
      const rows = await db
        .select()
        .from(pulseSources)
        .where(eq(pulseSources.slug, slug))
        .limit(1);
      const row = rows[0];
      return row ? { id: row.id, slug: row.slug, active: row.active } : null;
    },

    async findActiveCollector() {
      const rows = await db
        .select()
        .from(pulseCollectors)
        .where(and(eq(pulseCollectors.active, true)))
        .orderBy(asc(pulseCollectors.createdAt), asc(pulseCollectors.id))
        .limit(1);
      const row = rows[0];
      return row
        ? {
            id: row.id,
            sourceId: row.sourceId,
            externalId: row.externalId,
            active: row.active,
          }
        : null;
    },

    async upsertProductBySlug(input) {
      const inserted = await db
        .insert(pulseProducts)
        .values({
          slug: input.slug,
          name: input.name,
          categoryLabel: input.categoryLabel,
        })
        .onConflictDoNothing({ target: pulseProducts.slug })
        .returning();
      const insertedRow = inserted[0];
      if (insertedRow) return mapProduct(insertedRow);
      const existing = await db
        .select()
        .from(pulseProducts)
        .where(eq(pulseProducts.slug, input.slug))
        .limit(1);
      const row = existing[0];
      if (!row) throw new Error(`product ${input.slug} missing after upsert`);
      return mapProduct(row);
    },

    async getProduct(productId) {
      const rows = await db
        .select()
        .from(pulseProducts)
        .where(eq(pulseProducts.id, productId))
        .limit(1);
      const row = rows[0];
      return row ? mapProduct(row) : null;
    },

    async updateProduct(productId, patch) {
      await db
        .update(pulseProducts)
        .set({
          ...(patch.currentTrustedObservationId !== undefined
            ? { currentTrustedObservationId: patch.currentTrustedObservationId }
            : {}),
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.categoryLabel !== undefined
            ? { categoryLabel: patch.categoryLabel }
            : {}),
          updatedAt: new Date(),
        })
        .where(eq(pulseProducts.id, productId));
    },

    async ensureVariant(productId, name) {
      const slug = entitySlug(name);
      const inserted = await db
        .insert(pulseVariants)
        .values({ productId, slug, name })
        .onConflictDoNothing({ target: [pulseVariants.productId, pulseVariants.slug] })
        .returning();
      const insertedRow = inserted[0];
      if (insertedRow) {
        return {
          id: insertedRow.id,
          productId: insertedRow.productId,
          slug: insertedRow.slug,
          name: insertedRow.name,
        };
      }
      const existing = await db
        .select()
        .from(pulseVariants)
        .where(and(eq(pulseVariants.productId, productId), eq(pulseVariants.slug, slug)))
        .limit(1);
      const row = existing[0];
      if (!row) throw new Error(`variant ${slug} missing after ensure`);
      return { id: row.id, productId: row.productId, slug: row.slug, name: row.name };
    },

    async ensureFlavour(productId, name) {
      const slug = entitySlug(name);
      const inserted = await db
        .insert(pulseFlavours)
        .values({ productId, slug, name })
        .onConflictDoNothing({ target: [pulseFlavours.productId, pulseFlavours.slug] })
        .returning();
      const insertedRow = inserted[0];
      if (insertedRow) {
        return {
          id: insertedRow.id,
          productId: insertedRow.productId,
          slug: insertedRow.slug,
          name: insertedRow.name,
        };
      }
      const existing = await db
        .select()
        .from(pulseFlavours)
        .where(and(eq(pulseFlavours.productId, productId), eq(pulseFlavours.slug, slug)))
        .limit(1);
      const row = existing[0];
      if (!row) throw new Error(`flavour ${slug} missing after ensure`);
      return { id: row.id, productId: row.productId, slug: row.slug, name: row.name };
    },

    async findObservationBySourceFingerprint(sourceId, pageFingerprint) {
      const rows = await db
        .select()
        .from(pulseProductObservations)
        .where(
          and(
            eq(pulseProductObservations.sourceId, sourceId),
            eq(pulseProductObservations.pageFingerprint, pageFingerprint),
          ),
        )
        .limit(1);
      const row = rows[0];
      return row ? mapObservation(row) : null;
    },

    async insertObservation(input) {
      const rows = await db
        .insert(pulseProductObservations)
        .values({
          productId: input.productId,
          sourceId: input.sourceId,
          slug: input.slug,
          observedAt: input.observedAt,
          pageFingerprint: input.pageFingerprint,
          status: input.status,
          normalized: input.normalized,
        })
        // No explicit target: ANY unique collision (fingerprint or
        // slug+observed_at) means "already ingested" for an append-only run.
        .onConflictDoNothing()
        .returning();
      const row = rows[0];
      return row ? mapObservation(row) : null;
    },

    async getObservation(id) {
      const rows = await db
        .select()
        .from(pulseProductObservations)
        .where(eq(pulseProductObservations.id, id))
        .limit(1);
      const row = rows[0];
      return row ? mapObservation(row) : null;
    },

    async updateObservation(id, patch) {
      await db
        .update(pulseProductObservations)
        .set({
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.normalized !== undefined ? { normalized: patch.normalized } : {}),
        })
        .where(eq(pulseProductObservations.id, id));
    },

    async supersedeOtherTrustedObservations(productId, keepObservationId) {
      const demoted = await db
        .update(pulseProductObservations)
        .set({ status: "superseded" })
        .where(
          and(
            eq(pulseProductObservations.productId, productId),
            eq(pulseProductObservations.status, "trusted"),
            ne(pulseProductObservations.id, keepObservationId),
          ),
        )
        .returning({ id: pulseProductObservations.id });
      return demoted.length;
    },

    async listCandidateObservationsByFingerprints(sourceId, fingerprints) {
      if (fingerprints.length === 0) return [];
      const rows = await db
        .select()
        .from(pulseProductObservations)
        .where(
          and(
            eq(pulseProductObservations.sourceId, sourceId),
            eq(pulseProductObservations.status, "candidate"),
          ),
        )
        .orderBy(asc(pulseProductObservations.slug), asc(pulseProductObservations.id));
      const wanted = new Set(fingerprints);
      return rows.filter((row) => wanted.has(row.pageFingerprint)).map(mapObservation);
    },

    async insertVariantObservation(input) {
      const rows = await db
        .insert(pulseVariantObservations)
        .values({
          variantId: input.variantId,
          productObservationId: input.productObservationId,
          observedAt: input.observedAt,
          normalized: input.normalized,
        })
        .onConflictDoNothing({
          target: [
            pulseVariantObservations.productObservationId,
            pulseVariantObservations.variantId,
          ],
        })
        .returning({ id: pulseVariantObservations.id });
      return rows.length > 0;
    },

    async insertFlavourObservation(input) {
      const rows = await db
        .insert(pulseFlavourObservations)
        .values({
          flavourId: input.flavourId,
          productObservationId: input.productObservationId,
          observedAt: input.observedAt,
          normalized: input.normalized,
        })
        .onConflictDoNothing({
          target: [
            pulseFlavourObservations.productObservationId,
            pulseFlavourObservations.flavourId,
          ],
        })
        .returning({ id: pulseFlavourObservations.id });
      return rows.length > 0;
    },

    async openIncident(input) {
      const rows = await db
        .insert(pulseIncidents)
        .values({
          collectionRunId: input.collectionRunId,
          title: input.title,
          summary: input.summary,
          status: "open",
          detectedAt: input.detectedAt,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error("openIncident returned no row");
      return {
        id: row.id,
        collectionRunId: row.collectionRunId,
        title: row.title,
        summary: row.summary,
        status: row.status,
      };
    },

    async insertChangeEvent(input) {
      await db.insert(pulseChangeEvents).values({
        productId: input.productId,
        eventType: input.eventType,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        productObservationId: input.productObservationId,
        occurredAt: input.occurredAt,
      });
    },

    async insertHealSession(input) {
      const rows = await db
        .insert(pulseHealSessions)
        .values({
          collectorId: input.collectorId,
          prompt: input.prompt,
          preview: input.preview,
        })
        .returning();
      const row = rows[0];
      if (!row) throw new Error("insertHealSession returned no row");
      return mapHealSession(row);
    },

    async getHealSession(sessionId) {
      const rows = await db
        .select()
        .from(pulseHealSessions)
        .where(eq(pulseHealSessions.id, sessionId))
        .limit(1);
      const row = rows[0];
      return row ? mapHealSession(row) : null;
    },

    async updateHealSessionPreview(sessionId, preview) {
      await db
        .update(pulseHealSessions)
        .set({ preview, updatedAt: new Date() })
        .where(eq(pulseHealSessions.id, sessionId));
    },

    async approveHealSession(sessionId, approvedBy) {
      const now = new Date();
      await db
        .update(pulseHealSessions)
        .set({ approvedAt: now, approvedBy, updatedAt: now })
        .where(and(eq(pulseHealSessions.id, sessionId), isNull(pulseHealSessions.approvedAt)));
    },

    async listTrustedObservationPayloads() {
      // Trusted-only join, mirroring src/server/products/queries.ts:
      // products.current_trusted_observation_id -> observation AND status='trusted'.
      const rows = await db
        .select({
          productId: pulseProducts.id,
          productSlug: pulseProducts.slug,
          observationId: pulseProductObservations.id,
          normalized: pulseProductObservations.normalized,
        })
        .from(pulseProducts)
        .innerJoin(
          pulseProductObservations,
          and(
            eq(pulseProducts.currentTrustedObservationId, pulseProductObservations.id),
            eq(pulseProductObservations.status, "trusted"),
          ),
        )
        .orderBy(asc(pulseProducts.slug));
      return rows.map((row) => ({
        productId: row.productId,
        productSlug: row.productSlug,
        observationId: row.observationId,
        payload: row.normalized,
      }));
    },

    async insertLeaderboardSnapshot(summary) {
      const rows = await db
        .insert(pulseLeaderboardSnapshots)
        .values({ summary })
        .returning({ id: pulseLeaderboardSnapshots.id });
      const row = rows[0];
      if (!row) throw new Error("insertLeaderboardSnapshot returned no row");
      return row.id;
    },

    async insertLeaderboardEntry(input) {
      await db.insert(pulseLeaderboardEntries).values({
        snapshotId: input.snapshotId,
        productId: input.productId,
        rank: input.rank,
        metricKey: input.metricKey,
        metricValue: input.metricValue,
        eligible: input.eligible,
        eligibilityFlags: input.eligibilityFlags,
      });
    },
  };
}

type DbRunRow = typeof pulseCollectionRuns.$inferSelect;
type DbProductRow = typeof pulseProducts.$inferSelect;
type DbObservationRow = typeof pulseProductObservations.$inferSelect;
type DbHealSessionRow = typeof pulseHealSessions.$inferSelect;

function mapRun(row: DbRunRow): CollectionRunRow {
  return {
    id: row.id,
    collectorId: row.collectorId,
    trigger: row.trigger,
    status: row.status,
    rowCount: row.rowCount,
    pageFingerprint: row.pageFingerprint,
    report: row.report ?? null,
    errorCode: row.errorCode,
    errorSummary: row.errorSummary,
    createdAt: row.createdAt,
  };
}

function mapProduct(row: DbProductRow): ProductRow {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryLabel: row.categoryLabel,
    currentTrustedObservationId: row.currentTrustedObservationId,
  };
}

function mapObservation(row: DbObservationRow): ObservationRow {
  return {
    id: row.id,
    productId: row.productId,
    sourceId: row.sourceId,
    slug: row.slug,
    observedAt: row.observedAt,
    pageFingerprint: row.pageFingerprint,
    status: row.status,
    normalized: row.normalized,
  };
}

function mapHealSession(row: DbHealSessionRow): HealSessionRow {
  return {
    id: row.id,
    collectorId: row.collectorId,
    prompt: row.prompt,
    preview: row.preview,
    approvedAt: row.approvedAt,
    approvedBy: row.approvedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// In-memory implementation (unit-test double with constraint emulation)
// ---------------------------------------------------------------------------

export type InMemoryPulseRepo = PulseRepo & {
  seedSource(input: { slug: string; id?: string }): SourceRow;
  seedCollector(input: {
    sourceId: string;
    externalId?: string;
    active?: boolean;
  }): CollectorRow;
  /** Test-only introspection of persisted state (not part of PulseRepo). */
  readonly __debug: {
    incidents: IncidentRow[];
    changeEvents: InsertChangeEventInput[];
    snapshots: Array<{ id: string; summary: JsonObject }>;
    leaderboardEntries: InsertLeaderboardEntryInput[];
    observations: Map<string, ObservationRow>;
    products: Map<string, ProductRow>;
    runs: Map<string, CollectionRunRow>;
    rawRecords: Map<string, RawRecordRow>;
    healSessions: Map<string, HealSessionRow>;
  };
};

export function createInMemoryPulseRepo(): InMemoryPulseRepo {
  let nextId = 0;
  const freshId = (prefix: string) => `${prefix}-${String(++nextId).padStart(4, "0")}`;

  const sources = new Map<string, SourceRow>();
  const collectors = new Map<string, CollectorRow>();
  const runs = new Map<string, CollectionRunRow>();
  const rawRecords = new Map<string, RawRecordRow>();
  const products = new Map<string, ProductRow>();
  const variants = new Map<string, VariantRow>();
  const flavours = new Map<string, FlavourRow>();
  const observations = new Map<string, ObservationRow>();
  const variantObservations = new Set<string>();
  const flavourObservations = new Set<string>();
  const incidents: IncidentRow[] = [];
  const changeEvents: InsertChangeEventInput[] = [];
  const snapshots: Array<{ id: string; summary: JsonObject }> = [];
  const leaderboardEntries: InsertLeaderboardEntryInput[] = [];
  const healSessions = new Map<string, HealSessionRow>();

  const observationKeySourceSlugObserved = (sourceId: string, slug: string, at: Date) =>
    `${sourceId}|${slug}|${toDate(at).toISOString()}`;

  const debug = {
    incidents,
    changeEvents,
    snapshots,
    leaderboardEntries,
    observations,
    products,
    runs,
    rawRecords,
    healSessions,
  } as InMemoryPulseRepo["__debug"];

  const api: InMemoryPulseRepo = {
    __debug: debug,
    seedSource(input: { slug: string; id?: string }): SourceRow {
      const row: SourceRow = {
        id: input.id ?? freshId("src"),
        slug: input.slug,
        active: true,
      };
      sources.set(row.id, row);
      sources.set(`by-slug:${row.slug}`, row);
      return row;
    },
    seedCollector(input: {
      sourceId: string;
      externalId?: string;
      active?: boolean;
    }): CollectorRow {
      const row: CollectorRow = {
        id: freshId("col"),
        sourceId: input.sourceId,
        externalId: input.externalId ?? "c_test_collector",
        active: input.active ?? true,
      };
      collectors.set(row.id, row);
      return row;
    },

    async getCollectionRun(runId) {
      return runs.get(runId) ?? null;
    },
    async listRawRecords(runId) {
      return [...rawRecords.values()]
        .filter((row) => row.collectionRunId === runId)
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime() || (a.id < b.id ? -1 : 1));
    },
    async insertCollectionRun(input) {
      const row: CollectionRunRow = {
        id: freshId("run"),
        collectorId: input.collectorId,
        trigger: input.trigger,
        status: input.status,
        rowCount: input.rowCount,
        pageFingerprint: input.pageFingerprint,
        report: input.report,
        errorCode: null,
        errorSummary: null,
        createdAt: new Date(),
      };
      runs.set(row.id, row);
      return row;
    },
    async updateCollectionRun(runId, patch) {
      const row = runs.get(runId);
      if (!row) throw new Error(`unknown run ${runId}`);
      runs.set(runId, {
        ...row,
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.startedAt !== undefined ? { startedAt: patch.startedAt } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        ...(patch.rowCount !== undefined ? { rowCount: patch.rowCount } : {}),
        ...(patch.pageFingerprint !== undefined
          ? { pageFingerprint: patch.pageFingerprint }
          : {}),
        ...(patch.report !== undefined ? { report: patch.report } : {}),
        ...(patch.errorCode !== undefined ? { errorCode: patch.errorCode } : {}),
        ...(patch.errorSummary !== undefined ? { errorSummary: patch.errorSummary } : {}),
      });
    },
    async insertRawRecord(input) {
      const fingerprintKey = `${input.collectionRunId}|${input.pageFingerprint}`;
      for (const existing of rawRecords.values()) {
        if (
          `${existing.collectionRunId}|${existing.pageFingerprint}` === fingerprintKey
        ) {
          throw new Error("raw_records_run_fingerprint_uidx violation");
        }
      }
      const row: RawRecordRow = { id: freshId("raw"), ...input };
      rawRecords.set(row.id, row);
      return row;
    },
    async getPreviousRunRowCount(collectorId, excludeRunId, before) {
      let best: CollectionRunRow | null = null;
      for (const run of runs.values()) {
        if (run.collectorId !== collectorId) continue;
        if (run.id === excludeRunId) continue;
        if (run.createdAt.getTime() >= before.getTime()) continue;
        if (!best || run.createdAt.getTime() > best.createdAt.getTime()) best = run;
      }
      return best?.rowCount ?? null;
    },

    async findSourceBySlug(slug) {
      return sources.get(`by-slug:${slug}`) ?? null;
    },
    async findActiveCollector() {
      const all = [...collectors.values()].filter((row) => row.active);
      all.sort((a, b) => (a.id < b.id ? -1 : 1));
      return all[0] ?? null;
    },

    async upsertProductBySlug(input) {
      for (const row of products.values()) {
        if (row.slug === input.slug) return row;
      }
      const row: ProductRow = {
        id: freshId("prd"),
        slug: input.slug,
        name: input.name,
        categoryLabel: input.categoryLabel,
        currentTrustedObservationId: null,
      };
      products.set(row.id, row);
      return row;
    },
    async getProduct(productId) {
      return products.get(productId) ?? null;
    },
    async updateProduct(productId, patch) {
      const row = products.get(productId);
      if (!row) throw new Error(`unknown product ${productId}`);
      products.set(productId, {
        ...row,
        ...(patch.currentTrustedObservationId !== undefined
          ? { currentTrustedObservationId: patch.currentTrustedObservationId }
          : {}),
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.categoryLabel !== undefined
          ? { categoryLabel: patch.categoryLabel }
          : {}),
      });
    },
    async ensureVariant(productId, name) {
      const slug = entitySlug(name);
      for (const row of variants.values()) {
        if (row.productId === productId && row.slug === slug) return row;
      }
      const row: VariantRow = { id: freshId("var"), productId, slug, name };
      variants.set(row.id, row);
      return row;
    },
    async ensureFlavour(productId, name) {
      const slug = entitySlug(name);
      for (const row of flavours.values()) {
        if (row.productId === productId && row.slug === slug) return row;
      }
      const row: FlavourRow = { id: freshId("flv"), productId, slug, name };
      flavours.set(row.id, row);
      return row;
    },

    async findObservationBySourceFingerprint(sourceId, pageFingerprint) {
      for (const row of observations.values()) {
        if (row.sourceId === sourceId && row.pageFingerprint === pageFingerprint) {
          return row;
        }
      }
      return null;
    },
    async insertObservation(input) {
      for (const row of observations.values()) {
        if (
          row.sourceId === input.sourceId &&
          row.pageFingerprint === input.pageFingerprint
        ) {
          return null;
        }
        if (
          observationKeySourceSlugObserved(input.sourceId, input.slug, input.observedAt) ===
          observationKeySourceSlugObserved(row.sourceId, row.slug, row.observedAt)
        ) {
          return null;
        }
      }
      const row: ObservationRow = { id: freshId("obs"), ...input };
      observations.set(row.id, row);
      return row;
    },
    async getObservation(id) {
      return observations.get(id) ?? null;
    },
    async updateObservation(id, patch) {
      const row = observations.get(id);
      if (!row) throw new Error(`unknown observation ${id}`);
      observations.set(id, { ...row, ...patch });
    },
    async supersedeOtherTrustedObservations(productId, keepObservationId) {
      let count = 0;
      for (const [id, row] of observations) {
        if (
          row.productId === productId &&
          row.status === "trusted" &&
          id !== keepObservationId
        ) {
          observations.set(id, { ...row, status: "superseded" });
          count += 1;
        }
      }
      return count;
    },
    async listCandidateObservationsByFingerprints(sourceId, fingerprints) {
      const wanted = new Set(fingerprints);
      return [...observations.values()]
        .filter(
          (row) =>
            row.sourceId === sourceId &&
            row.status === "candidate" &&
            wanted.has(row.pageFingerprint),
        )
        .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : a.id < b.id ? -1 : 1));
    },
    async insertVariantObservation(input) {
      const key = `${input.productObservationId}|${input.variantId}`;
      if (variantObservations.has(key)) return false;
      variantObservations.add(key);
      return true;
    },
    async insertFlavourObservation(input) {
      const key = `${input.productObservationId}|${input.flavourId}`;
      if (flavourObservations.has(key)) return false;
      flavourObservations.add(key);
      return true;
    },

    async openIncident(input) {
      const row: IncidentRow = {
        id: freshId("inc"),
        collectionRunId: input.collectionRunId,
        title: input.title,
        summary: input.summary,
        status: "open",
      };
      incidents.push(row);
      return row;
    },
    async insertChangeEvent(input) {
      changeEvents.push(input);
    },

    async insertHealSession(input) {
      const now = new Date();
      const row: HealSessionRow = {
        id: freshId("heal"),
        collectorId: input.collectorId,
        prompt: input.prompt,
        preview: input.preview,
        approvedAt: null,
        approvedBy: null,
        createdAt: now,
        updatedAt: now,
      };
      healSessions.set(row.id, row);
      return row;
    },
    async getHealSession(sessionId) {
      return healSessions.get(sessionId) ?? null;
    },
    async updateHealSessionPreview(sessionId, preview) {
      const row = healSessions.get(sessionId);
      if (!row) throw new Error(`unknown heal session ${sessionId}`);
      healSessions.set(sessionId, { ...row, preview, updatedAt: new Date() });
    },
    async approveHealSession(sessionId, approvedBy) {
      const row = healSessions.get(sessionId);
      if (!row) throw new Error(`unknown heal session ${sessionId}`);
      healSessions.set(sessionId, {
        ...row,
        approvedAt: new Date(),
        approvedBy,
        updatedAt: new Date(),
      });
    },

    async listTrustedObservationPayloads() {
      const out: TrustedPayloadRow[] = [];
      for (const product of products.values()) {
        if (!product.currentTrustedObservationId) continue;
        const obs = observations.get(product.currentTrustedObservationId);
        if (!obs || obs.status !== "trusted") continue;
        out.push({
          productId: product.id,
          productSlug: product.slug,
          observationId: obs.id,
          payload: obs.normalized,
        });
      }
      out.sort((a, b) => (a.productSlug < b.productSlug ? -1 : 1));
      return out;
    },
    async insertLeaderboardSnapshot(summary) {
      const id = freshId("snap");
      snapshots.push({ id, summary });
      return id;
    },
    async insertLeaderboardEntry(input) {
      for (const entry of leaderboardEntries) {
        if (entry.snapshotId === input.snapshotId && entry.productId === input.productId) {
          throw new Error("leaderboard_entries_snapshot_product_uidx violation");
        }
      }
      leaderboardEntries.push(input);
    },
  };

  return api;
}
