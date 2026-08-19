import { sql } from "drizzle-orm";
import {
  boolean,
  date,
  doublePrecision,
  foreignKey,
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

type JsonObject = Record<string, unknown>;
type JsonArray = unknown[];

export const transitSnapshotStatusEnum = pgEnum("transit_snapshot_status", [
  "staged",
  "active",
  "rejected",
  "superseded",
]);

export const realtimeFeedTypeEnum = pgEnum("realtime_feed_type", [
  "trip_updates",
  "vehicles",
  "alerts",
]);

export const sourceKindEnum = pgEnum("source_kind", [
  "accessibility_advisories",
  "stop_relocations",
  "stop_accessibility",
]);

export const sourceSnapshotStatusEnum = pgEnum("source_snapshot_status", [
  "current",
  "rejected",
  "unavailable",
]);

export const transitFeedSnapshots = pgTable(
  "transit_feed_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    feedHash: text("feed_hash").notNull(),
    sourceUrl: text("source_url").notNull(),
    sourceEtag: text("source_etag"),
    sourceLastModified: text("source_last_modified"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    status: transitSnapshotStatusEnum("status").default("staged").notNull(),
    validationReport: jsonb("validation_report").$type<JsonObject>().notNull(),
    fileManifest: jsonb("file_manifest").$type<JsonObject>().notNull(),
    coverage: jsonb("coverage").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("transit_feed_snapshots_hash_uidx").on(table.feedHash),
    uniqueIndex("transit_feed_snapshots_one_active_uidx")
      .on(table.status)
      .where(sql`${table.status} = 'active'`),
    index("transit_feed_snapshots_checked_at_idx").on(table.checkedAt),
  ],
);

export const transitStops = pgTable(
  "transit_stops",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => transitFeedSnapshots.id, { onDelete: "cascade" }),
    stopId: text("stop_id").notNull(),
    stopCode: text("stop_code"),
    stopName: text("stop_name").notNull(),
    stopDescription: text("stop_description"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    locationType: integer("location_type").default(0).notNull(),
    parentStationId: text("parent_station_id"),
    wheelchairBoarding: integer("wheelchair_boarding").default(0).notNull(),
    platformCode: text("platform_code"),
    zoneId: text("zone_id"),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.stopId] }),
    foreignKey({
      columns: [table.snapshotId, table.parentStationId],
      foreignColumns: [table.snapshotId, table.stopId],
      name: "transit_stops_parent_fk",
    }).onDelete("restrict"),
    index("transit_stops_name_idx").on(table.stopName),
    index("transit_stops_code_idx").on(table.stopCode),
    index("transit_stops_parent_idx").on(
      table.snapshotId,
      table.parentStationId,
    ),
  ],
);

export const transitShapes = pgTable(
  "transit_shapes",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => transitFeedSnapshots.id, { onDelete: "cascade" }),
    shapeId: text("shape_id").notNull(),
    sequence: integer("sequence").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    distanceTraveled: doublePrecision("distance_traveled"),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.shapeId, table.sequence] }),
    index("transit_shapes_shape_idx").on(table.snapshotId, table.shapeId),
  ],
);

export const transitRoutes = pgTable(
  "transit_routes",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => transitFeedSnapshots.id, { onDelete: "cascade" }),
    routeId: text("route_id").notNull(),
    agencyId: text("agency_id"),
    shortName: text("short_name"),
    longName: text("long_name"),
    description: text("description"),
    routeType: integer("route_type").notNull(),
    url: text("url"),
    color: text("color"),
    textColor: text("text_color"),
    sortOrder: integer("sort_order"),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.routeId] }),
    index("transit_routes_short_name_idx").on(table.shortName),
  ],
);

export const transitServices = pgTable(
  "transit_services",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => transitFeedSnapshots.id, { onDelete: "cascade" }),
    serviceId: text("service_id").notNull(),
    monday: boolean("monday").default(false).notNull(),
    tuesday: boolean("tuesday").default(false).notNull(),
    wednesday: boolean("wednesday").default(false).notNull(),
    thursday: boolean("thursday").default(false).notNull(),
    friday: boolean("friday").default(false).notNull(),
    saturday: boolean("saturday").default(false).notNull(),
    sunday: boolean("sunday").default(false).notNull(),
    startsOn: date("starts_on", { mode: "string" }),
    endsOn: date("ends_on", { mode: "string" }),
    exceptions: jsonb("exceptions").$type<JsonArray>().default([]).notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.serviceId] })],
);

export const transitTrips = pgTable(
  "transit_trips",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => transitFeedSnapshots.id, { onDelete: "cascade" }),
    tripId: text("trip_id").notNull(),
    routeId: text("route_id").notNull(),
    serviceId: text("service_id").notNull(),
    headsign: text("headsign"),
    shortName: text("short_name"),
    directionId: integer("direction_id"),
    blockId: text("block_id"),
    shapeId: text("shape_id"),
    wheelchairAccessible: integer("wheelchair_accessible").default(0).notNull(),
    bikesAllowed: integer("bikes_allowed").default(0).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.tripId] }),
    foreignKey({
      columns: [table.snapshotId, table.routeId],
      foreignColumns: [transitRoutes.snapshotId, transitRoutes.routeId],
      name: "transit_trips_route_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.snapshotId, table.serviceId],
      foreignColumns: [transitServices.snapshotId, transitServices.serviceId],
      name: "transit_trips_service_fk",
    }).onDelete("cascade"),
    index("transit_trips_route_idx").on(table.snapshotId, table.routeId),
    index("transit_trips_service_idx").on(table.snapshotId, table.serviceId),
  ],
);

export const transitStopTimes = pgTable(
  "transit_stop_times",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => transitFeedSnapshots.id, { onDelete: "cascade" }),
    tripId: text("trip_id").notNull(),
    stopSequence: integer("stop_sequence").notNull(),
    stopId: text("stop_id").notNull(),
    arrivalSeconds: integer("arrival_seconds"),
    departureSeconds: integer("departure_seconds"),
    stopHeadsign: text("stop_headsign"),
    pickupType: integer("pickup_type").default(0).notNull(),
    dropOffType: integer("drop_off_type").default(0).notNull(),
    shapeDistanceTraveled: doublePrecision("shape_distance_traveled"),
    timepoint: integer("timepoint"),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshotId, table.tripId, table.stopSequence],
    }),
    foreignKey({
      columns: [table.snapshotId, table.tripId],
      foreignColumns: [transitTrips.snapshotId, transitTrips.tripId],
      name: "transit_stop_times_trip_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.snapshotId, table.stopId],
      foreignColumns: [transitStops.snapshotId, transitStops.stopId],
      name: "transit_stop_times_stop_fk",
    }).onDelete("restrict"),
    index("transit_stop_times_stop_idx").on(table.snapshotId, table.stopId),
    index("transit_stop_times_trip_idx").on(table.snapshotId, table.tripId),
  ],
);

export const transitLandmarks = pgTable(
  "transit_landmarks",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    aliases: jsonb("aliases").$type<string[]>().default([]).notNull(),
    stopIds: jsonb("stop_ids").$type<string[]>().default([]).notNull(),
    active: boolean("active").default(true).notNull(),
    evidenceUrl: text("evidence_url"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index("transit_landmarks_name_idx").on(table.name)],
);

export const realtimeFeedSnapshots = pgTable(
  "realtime_feed_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    transitSnapshotId: uuid("transit_snapshot_id").references(
      () => transitFeedSnapshots.id,
      { onDelete: "set null" },
    ),
    feedType: realtimeFeedTypeEnum("feed_type").notNull(),
    payloadHash: text("payload_hash").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    valid: boolean("valid").notNull(),
    validationReport: jsonb("validation_report").$type<JsonObject>().notNull(),
    entityCount: integer("entity_count").default(0).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("realtime_feed_snapshots_type_hash_uidx").on(
      table.feedType,
      table.payloadHash,
    ),
    index("realtime_feed_snapshots_latest_idx").on(
      table.feedType,
      table.checkedAt,
    ),
  ],
);

export const realtimeTripUpdates = pgTable(
  "realtime_trip_updates",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => realtimeFeedSnapshots.id, { onDelete: "cascade" }),
    updateId: text("update_id").notNull(),
    entityId: text("entity_id").notNull(),
    tripId: text("trip_id").notNull(),
    routeId: text("route_id"),
    scheduleRelationship: text("schedule_relationship").notNull(),
    stopId: text("stop_id"),
    stopSequence: integer("stop_sequence"),
    arrivalDelaySeconds: integer("arrival_delay_seconds"),
    departureDelaySeconds: integer("departure_delay_seconds"),
    arrivalAt: timestamp("arrival_at", { withTimezone: true }),
    departureAt: timestamp("departure_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({
      columns: [table.snapshotId, table.updateId],
    }),
    index("realtime_trip_updates_trip_idx").on(table.tripId),
    index("realtime_trip_updates_route_idx").on(table.routeId),
  ],
);

export const realtimeVehiclePositions = pgTable(
  "realtime_vehicle_positions",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => realtimeFeedSnapshots.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    vehicleId: text("vehicle_id"),
    label: text("label"),
    tripId: text("trip_id"),
    routeId: text("route_id"),
    stopId: text("stop_id"),
    currentStopSequence: integer("current_stop_sequence"),
    currentStatus: text("current_status"),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    bearing: doublePrecision("bearing"),
    speedMetersPerSecond: doublePrecision("speed_meters_per_second"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.entityId] }),
    index("realtime_vehicle_positions_route_idx").on(table.routeId),
  ],
);

export const realtimeAlerts = pgTable(
  "realtime_alerts",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => realtimeFeedSnapshots.id, { onDelete: "cascade" }),
    entityId: text("entity_id").notNull(),
    cause: text("cause"),
    effect: text("effect"),
    header: text("header").notNull(),
    description: text("description"),
    url: text("url"),
    activePeriods: jsonb("active_periods")
      .$type<JsonArray>()
      .default([])
      .notNull(),
    informedEntities: jsonb("informed_entities")
      .$type<JsonArray>()
      .default([])
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.snapshotId, table.entityId] })],
);

export const sourceSnapshots = pgTable(
  "source_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    kind: sourceKindEnum("kind").notNull(),
    collectorId: text("collector_id").notNull(),
    sourceUrl: text("source_url").notNull(),
    payloadHash: text("payload_hash").notNull(),
    structuralFingerprint: text("structural_fingerprint"),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    sourceUpdatedAt: timestamp("source_updated_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    status: sourceSnapshotStatusEnum("status").notNull(),
    validationReport: jsonb("validation_report").$type<JsonObject>().notNull(),
    rowCount: integer("row_count").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("source_snapshots_kind_hash_uidx").on(
      table.kind,
      table.payloadHash,
    ),
    index("source_snapshots_latest_idx").on(table.kind, table.checkedAt),
  ],
);

export const accessibilityAdvisories = pgTable(
  "accessibility_advisories",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id, { onDelete: "cascade" }),
    advisoryId: text("advisory_id").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    affectedStopIds: jsonb("affected_stop_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    affectedRouteIds: jsonb("affected_route_ids")
      .$type<string[]>()
      .default([])
      .notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    publicUrl: text("public_url").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.advisoryId] }),
    index("accessibility_advisories_time_idx").on(table.startsAt, table.endsAt),
  ],
);

export const stopRelocations = pgTable(
  "stop_relocations",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id, { onDelete: "cascade" }),
    rowId: text("row_id").notNull(),
    stopId: text("stop_id").notNull(),
    stopName: text("stop_name").notNull(),
    applicant: text("applicant"),
    routeNames: jsonb("route_names").$type<string[]>().default([]).notNull(),
    fromDescription: text("from_description"),
    toDescription: text("to_description").notNull(),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    publicUrl: text("public_url").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.rowId] }),
    index("stop_relocations_stop_idx").on(table.stopId),
  ],
);

export const stopAccessibilityGuides = pgTable(
  "stop_accessibility_guides",
  {
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id, { onDelete: "cascade" }),
    guideId: text("guide_id").notNull(),
    stopId: text("stop_id"),
    stationName: text("station_name").notNull(),
    routeNames: jsonb("route_names").$type<string[]>().default([]).notNull(),
    guidance: text("guidance").notNull(),
    accessibilityState: text("accessibility_state").notNull(),
    reviewed: boolean("reviewed").default(false).notNull(),
    publicUrl: text("public_url").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.snapshotId, table.guideId] }),
    index("stop_accessibility_guides_stop_idx").on(table.stopId),
  ],
);
