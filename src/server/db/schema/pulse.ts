import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * PulseRank isolated database schema.
 *
 * Every PulseRank table lives in the dedicated "pulse" PostgreSQL schema so the
 * frozen UNBROKEN surface stays untouched: no cross-schema foreign keys in or
 * out, and no reuse of legacy public tables. PulseRank code reaches these
 * tables through direct imports of this module (the established pattern from
 * schema/commute.ts); the shared schema barrel stays orchestrator-owned.
 */

type JsonObject = Record<string, unknown>;

export const pulse = pgSchema("pulse");

/** Registered upstream publication we collect from (e.g. caffeine-informer). */
export const pulseSources = pulse.table(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    displayName: text("display_name").notNull(),
    homepageUrl: text("homepage_url"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [uniqueIndex("sources_slug_uidx").on(table.slug)],
);

/** Bright Data collector registration for a source (legacy IDs excluded). */
export const pulseCollectors = pulse.table(
  "collectors",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => pulseSources.id, { onDelete: "restrict" }),
    externalId: text("external_id").notNull(),
    zone: text("zone"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("collectors_external_id_uidx").on(table.externalId),
    index("collectors_source_idx").on(table.sourceId),
  ],
);

/** One execution of a collector against its source. */
export const pulseCollectionRuns = pulse.table(
  "collection_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => pulseCollectors.id, { onDelete: "restrict" }),
    trigger: text("trigger").notNull(),
    status: text("status").default("queued").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowCount: integer("row_count"),
    pageFingerprint: text("page_fingerprint"),
    report: jsonb("report").$type<JsonObject>(),
    errorCode: text("error_code"),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("collection_runs_collector_started_idx").on(
      table.collectorId,
      table.startedAt,
    ),
    index("collection_runs_status_idx").on(table.status),
  ],
);

/**
 * Append-only landing zone for collector output.
 *
 * Immutable by convention: writers INSERT only. UPDATE and DELETE are
 * intentionally unsupported by application code; a future retention trigger
 * (documented in docs/handoffs/A4-database.md) will own row lifecycle once
 * retention policy is settled. No other code path may mutate these rows.
 */
export const pulseRawRecords = pulse.table(
  "raw_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => pulseCollectionRuns.id, { onDelete: "cascade" }),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => pulseCollectors.id, { onDelete: "restrict" }),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    mediaType: text("media_type").notNull(),
    pageFingerprint: text("page_fingerprint").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("raw_records_run_fingerprint_uidx").on(
      table.collectionRunId,
      table.pageFingerprint,
    ),
    index("raw_records_fingerprint_idx").on(table.pageFingerprint),
  ],
);

/** Public identity of a product across sources. */
export const pulseProducts = pulse.table(
  "products",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    categoryLabel: text("category_label"),
    active: boolean("active").default(true).notNull(),
    currentTrustedObservationId: uuid("current_trusted_observation_id").references(
      (): AnyPgColumn => pulseProductObservations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("products_slug_uidx").on(table.slug),
    index("products_name_idx").on(table.name),
  ],
);

/** Alternate names that resolve to one canonical product. */
export const pulseProductAliases = pulse.table(
  "product_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => pulseProducts.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("product_aliases_product_alias_uidx").on(
      table.productId,
      table.alias,
    ),
    index("product_aliases_alias_idx").on(table.alias),
  ],
);

/**
 * One normalized view of a product page as seen by one source at one time.
 *
 * Status lifecycle is app-driven: candidate | trusted | quarantined |
 * rejected | superseded (checked in the database, transitioned by A5 logic).
 */
export const pulseProductObservations = pulse.table(
  "product_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => pulseProducts.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => pulseSources.id, { onDelete: "restrict" }),
    slug: text("slug").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    pageFingerprint: text("page_fingerprint").notNull(),
    status: text("status").default("candidate").notNull(),
    normalized: jsonb("normalized").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("product_observations_source_slug_observed_uidx").on(
      table.sourceId,
      table.slug,
      table.observedAt,
    ),
    uniqueIndex("product_observations_source_fingerprint_uidx").on(
      table.sourceId,
      table.pageFingerprint,
    ),
    index("product_observations_product_observed_idx").on(
      table.productId,
      table.observedAt,
    ),
    check(
      "product_observations_status_ck",
      sql`${table.status} IN ('candidate', 'trusted', 'quarantined', 'rejected', 'superseded')`,
    ),
  ],
);

/** Named variant of a product (size/form as listed by a source). */
export const pulseVariants = pulse.table(
  "variants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => pulseProducts.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    region: text("region"),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("variants_product_slug_uidx").on(table.productId, table.slug),
    index("variants_product_idx").on(table.productId),
  ],
);

/** Normalized variant facts carried by one product observation. */
export const pulseVariantObservations = pulse.table(
  "variant_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => pulseVariants.id, { onDelete: "cascade" }),
    productObservationId: uuid("product_observation_id")
      .notNull()
      .references(() => pulseProductObservations.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    normalized: jsonb("normalized").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("variant_observations_observation_variant_uidx").on(
      table.productObservationId,
      table.variantId,
    ),
    index("variant_observations_variant_idx").on(table.variantId),
  ],
);

/** Named flavour of a product as listed by a source. */
export const pulseFlavours = pulse.table(
  "flavours",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => pulseProducts.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("flavours_product_slug_uidx").on(table.productId, table.slug),
    index("flavours_product_idx").on(table.productId),
  ],
);

/** Normalized flavour facts carried by one product observation. */
export const pulseFlavourObservations = pulse.table(
  "flavour_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    flavourId: uuid("flavour_id")
      .notNull()
      .references(() => pulseFlavours.id, { onDelete: "cascade" }),
    productObservationId: uuid("product_observation_id")
      .notNull()
      .references(() => pulseProductObservations.id, { onDelete: "cascade" }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    normalized: jsonb("normalized").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("flavour_observations_observation_flavour_uidx").on(
      table.productObservationId,
      table.flavourId,
    ),
    index("flavour_observations_flavour_idx").on(table.flavourId),
  ],
);

/**
 * Product-level diff log.
 *
 * event_type is app-constrained (no database check) so new event kinds ship
 * without a migration; before/after carry the JSON values on either side of
 * the change.
 */
export const pulseChangeEvents = pulse.table(
  "change_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    productId: uuid("product_id")
      .notNull()
      .references(() => pulseProducts.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    before: jsonb("before").$type<JsonObject>(),
    after: jsonb("after").$type<JsonObject>(),
    productObservationId: uuid("product_observation_id").references(
      () => pulseProductObservations.id,
      { onDelete: "set null" },
    ),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("change_events_product_occurred_idx").on(
      table.productId,
      table.occurredAt,
    ),
  ],
);

/**
 * Immutable leaderboard state.
 *
 * Snapshots are append-only: a rebuild inserts a new row with a fresh
 * rebuilt_at and never updates an existing snapshot; corrections produce the
 * next snapshot.
 */
export const pulseLeaderboardSnapshots = pulse.table(
  "leaderboard_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    rebuiltAt: timestamp("rebuilt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    summary: jsonb("summary").$type<JsonObject>().notNull(),
  },
  (table) => [
    index("leaderboard_snapshots_rebuilt_at_idx").on(table.rebuiltAt),
  ],
);

/** One ranked row inside a leaderboard snapshot. */
export const pulseLeaderboardEntries = pulse.table(
  "leaderboard_entries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => pulseLeaderboardSnapshots.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => pulseProducts.id, { onDelete: "restrict" }),
    rank: integer("rank").notNull(),
    metricKey: text("metric_key").notNull(),
    metricValue: doublePrecision("metric_value").notNull(),
    eligible: boolean("eligible").default(true).notNull(),
    eligibilityFlags: jsonb("eligibility_flags")
      .$type<string[]>()
      .default([])
      .notNull(),
  },
  (table) => [
    uniqueIndex("leaderboard_entries_snapshot_product_uidx").on(
      table.snapshotId,
      table.productId,
    ),
    index("leaderboard_entries_snapshot_rank_idx").on(
      table.snapshotId,
      table.rank,
    ),
  ],
);

/** Collection anomaly surfaced for operator review. */
export const pulseIncidents = pulse.table(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id").references(
      () => pulseCollectionRuns.id,
      { onDelete: "set null" },
    ),
    status: text("status").default("open").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("incidents_status_detected_idx").on(table.status, table.detectedAt),
    check(
      "incidents_status_ck",
      sql`${table.status} IN ('open', 'resolved')`,
    ),
  ],
);

/** Judge-initiated heal attempt against a collector, with approval trail. */
export const pulseHealSessions = pulse.table(
  "heal_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectorId: uuid("collector_id")
      .notNull()
      .references(() => pulseCollectors.id, { onDelete: "restrict" }),
    prompt: text("prompt").notNull(),
    preview: jsonb("preview").$type<JsonObject>().notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: text("approved_by"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("heal_sessions_collector_idx").on(table.collectorId)],
);
