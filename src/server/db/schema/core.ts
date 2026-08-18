import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";

type JsonObject = Record<string, unknown>;

export const equipmentStatusEnum = pgEnum("equipment_status", [
  "in_service",
  "out_of_service",
  "unknown",
]);

export const stationAccessibilityEnum = pgEnum("station_accessibility_status", [
  "accessible",
  "limited",
  "unavailable",
  "unknown",
]);

export const dataTrustStateEnum = pgEnum("data_trust_state", [
  "current",
  "held_stale",
  "source_unavailable",
  "extraction_failed",
  "awaiting_review",
]);

export const runClassificationEnum = pgEnum("run_classification", [
  "healthy_no_change",
  "semantic_service_change",
  "probable_layout_drift",
  "source_unavailable",
  "source_stale",
  "ambiguous_contract_failure",
]);

export const runStatusEnum = pgEnum("collection_run_status", [
  "queued",
  "collecting",
  "validating",
  "accepted",
  "rejected",
  "failed",
]);

export const incidentStateEnum = pgEnum("incident_state", [
  "detected",
  "acknowledged",
  "heal_requested",
  "preview_received",
  "preview_rejected",
  "awaiting_review",
  "awaiting_approval",
  "approved",
  "rejected",
  "verified",
  "verification_failed",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);

export const componentStatusEnum = pgEnum("component_status", [
  "operational",
  "degraded",
  "outage",
  "unknown",
]);

export const stations = pgTable(
  "stations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    sourceName: text("source_name").notNull(),
    displayName: text("display_name").notNull(),
    corridorOrder: integer("corridor_order").notNull(),
    reportedAccessibility: stationAccessibilityEnum("reported_accessibility")
      .default("unknown")
      .notNull(),
    computedAccessibility: stationAccessibilityEnum("computed_accessibility")
      .default("unknown")
      .notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("stations_slug_uidx").on(table.slug),
    uniqueIndex("stations_source_name_uidx").on(table.sourceName),
    uniqueIndex("stations_corridor_order_uidx").on(table.corridorOrder),
  ],
);

export const equipment = pgTable(
  "equipment",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "restrict" }),
    sourceKey: text("source_key").notNull(),
    sourceName: text("source_name").notNull(),
    displayName: text("display_name").notNull(),
    equipmentType: text("equipment_type").default("elevator").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("equipment_source_key_uidx").on(table.sourceKey),
    index("equipment_station_id_idx").on(table.stationId),
  ],
);

export const accessPaths = pgTable(
  "access_paths",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    label: text("label").notNull(),
    originNode: text("origin_node").notNull(),
    destinationNode: text("destination_node").notNull(),
    direction: text("direction"),
    active: boolean("active").default(true).notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by").references(() => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("access_paths_station_version_label_uidx").on(
      table.stationId,
      table.version,
      table.label,
    ),
  ],
);

export const accessPathRequirements = pgTable(
  "access_path_requirements",
  {
    accessPathId: uuid("access_path_id")
      .notNull()
      .references(() => accessPaths.id, { onDelete: "cascade" }),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "restrict" }),
    dependencyGroup: integer("dependency_group").default(1).notNull(),
    required: boolean("required").default(true).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accessPathId, table.equipmentId] }),
    index("access_path_requirements_equipment_idx").on(table.equipmentId),
  ],
);

export const stationLinks = pgTable(
  "station_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    fromStationId: uuid("from_station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    toStationId: uuid("to_station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    stepFree: boolean("step_free").default(false).notNull(),
    version: integer("version").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("station_links_pair_version_uidx").on(
      table.fromStationId,
      table.toStationId,
      table.version,
    ),
  ],
);

export const collectionRuns = pgTable(
  "collection_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionId: text("collection_id"),
    collectorId: text("collector_id").notNull(),
    trigger: text("trigger").notNull(),
    status: runStatusEnum("status").default("queued").notNull(),
    classification: runClassificationEnum("classification"),
    sourceValidAt: timestamp("source_valid_at", { withTimezone: true }),
    collectedAt: timestamp("collected_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    rowCount: integer("row_count"),
    stationCount: integer("station_count"),
    structuralFingerprint: text("structural_fingerprint"),
    contractVersion: text("contract_version").notNull(),
    contractReport: jsonb("contract_report").$type<JsonObject>(),
    reasonCodes: jsonb("reason_codes").$type<string[]>(),
    errorCode: text("error_code"),
    errorSummary: text("error_summary"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("collection_runs_collection_id_uidx").on(table.collectionId),
    index("collection_runs_created_at_idx").on(table.createdAt),
    index("collection_runs_classification_idx").on(table.classification),
  ],
);

export const rawPayloads = pgTable(
  "raw_payloads",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    payloadHash: text("payload_hash").notNull(),
    mediaType: text("media_type").notNull(),
    body: jsonb("body").$type<unknown>(),
    byteLength: bigint("byte_length", { mode: "number" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("raw_payloads_run_uidx").on(table.collectionRunId),
    index("raw_payloads_expires_at_idx").on(table.expiresAt),
  ],
);

export const observations = pgTable(
  "observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "cascade" }),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "restrict" }),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "restrict" }),
    equipmentStatus: equipmentStatusEnum("equipment_status").notNull(),
    reportedStationAccessibility: stationAccessibilityEnum(
      "reported_station_accessibility",
    ).notNull(),
    sourceValidAt: timestamp("source_valid_at", {
      withTimezone: true,
    }).notNull(),
    sourceLastChangedAt: timestamp("source_last_changed_at", {
      withTimezone: true,
    }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    rawFields: jsonb("raw_fields").$type<JsonObject>().notNull(),
    normalizedHash: text("normalized_hash").notNull(),
  },
  (table) => [
    uniqueIndex("observations_run_equipment_uidx").on(
      table.collectionRunId,
      table.equipmentId,
    ),
    index("observations_equipment_observed_idx").on(
      table.equipmentId,
      table.observedAt,
    ),
  ],
);

export const trustedSnapshots = pgTable(
  "trusted_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "restrict" }),
    trustState: dataTrustStateEnum("trust_state").notNull(),
    structuralFingerprint: text("structural_fingerprint").notNull(),
    sourceValidAt: timestamp("source_valid_at", {
      withTimezone: true,
    }).notNull(),
    collectedAt: timestamp("collected_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    summary: jsonb("summary").$type<JsonObject>().notNull(),
  },
  (table) => [
    uniqueIndex("trusted_snapshots_run_uidx").on(table.collectionRunId),
    index("trusted_snapshots_accepted_at_idx").on(table.acceptedAt),
  ],
);

export const equipmentStatusEvents = pgTable(
  "equipment_status_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    equipmentId: uuid("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "restrict" }),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "restrict" }),
    fromStatus: equipmentStatusEnum("from_status").notNull(),
    toStatus: equipmentStatusEnum("to_status").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("equipment_status_events_equipment_idx").on(
      table.equipmentId,
      table.observedAt,
    ),
  ],
);

export const stationStatusEvents = pgTable(
  "station_status_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    stationId: uuid("station_id")
      .notNull()
      .references(() => stations.id, { onDelete: "restrict" }),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "restrict" }),
    fromStatus: stationAccessibilityEnum("from_status").notNull(),
    toStatus: stationAccessibilityEnum("to_status").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
  },
  (table) => [
    index("station_status_events_station_idx").on(
      table.stationId,
      table.acceptedAt,
    ),
  ],
);

export const routeRecalculations = pgTable(
  "route_recalculations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id")
      .notNull()
      .references(() => collectionRuns.id, { onDelete: "restrict" }),
    reason: text("reason").notNull(),
    affectedStationIds: jsonb("affected_station_ids").$type<string[]>().notNull(),
    affectedRouteCount: integer("affected_route_count").default(0).notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("route_recalculations_run_idx").on(table.collectionRunId)],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    status: jobStatusEnum("status").default("queued").notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    attempts: integer("attempts").default(0).notNull(),
    maxAttempts: integer("max_attempts").default(5).notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("jobs_idempotency_key_uidx").on(table.idempotencyKey),
    index("jobs_claim_idx").on(table.status, table.scheduledFor),
  ],
);

export const workerHeartbeats = pgTable("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  processVersion: text("process_version").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  metadata: jsonb("metadata").$type<JsonObject>().notNull(),
});

export const componentChecks = pgTable(
  "component_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    component: text("component").notNull(),
    status: componentStatusEnum("status").notNull(),
    latencyMs: integer("latency_ms"),
    message: text("message"),
    metadata: jsonb("metadata").$type<JsonObject>(),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("component_checks_component_checked_idx").on(
      table.component,
      table.checkedAt,
    ),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    collectionRunId: uuid("collection_run_id").references(
      () => collectionRuns.id,
      { onDelete: "set null" },
    ),
    state: incidentStateEnum("state").default("detected").notNull(),
    classification: runClassificationEnum("classification").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    fingerprint: text("fingerprint").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("incidents_state_detected_idx").on(table.state, table.detectedAt),
    index("incidents_fingerprint_idx").on(table.fingerprint),
  ],
);

export const incidentEvents = pgTable(
  "incident_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    eventType: text("event_type").notNull(),
    fromState: incidentStateEnum("from_state"),
    toState: incidentStateEnum("to_state").notNull(),
    actorUserId: text("actor_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    details: jsonb("details").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("incident_events_incident_idx").on(table.incidentId)],
);

export const llmReviews = pgTable(
  "llm_reviews",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    reasoningEffort: text("reasoning_effort").notNull(),
    promptVersion: text("prompt_version").notNull(),
    inputHash: text("input_hash").notNull(),
    recommendation: text("recommendation"),
    confidence: integer("confidence"),
    report: jsonb("report").$type<JsonObject>(),
    valid: boolean("valid").default(false).notNull(),
    errorCode: text("error_code"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("llm_reviews_incident_idx").on(table.incidentId)],
);

export const operatorActions = pgTable(
  "operator_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    outcome: text("outcome").notNull(),
    metadata: jsonb("metadata").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("operator_actions_idempotency_uidx").on(table.idempotencyKey),
    index("operator_actions_actor_created_idx").on(
      table.actorUserId,
      table.createdAt,
    ),
  ],
);
