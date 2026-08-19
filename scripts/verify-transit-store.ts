import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";
import type { GtfsSnapshotAttempt } from "@/server/transit/gtfs-refresh";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const namespace = `transit_verify_${randomUUID().replaceAll("-", "")}`;
const quotedNamespace = `"${namespace}"`;
const connection = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  onnotice: () => undefined,
});

function ensure(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const feedHash = "a".repeat(64);
const validation = {
  accepted: true as const,
  summary: {
    serviceDate: "2026-08-19",
    activeServiceCount: 1,
    counts: {
      stops: 2,
      routes: 1,
      trips: 1,
      stopTimes: 2,
      services: 1,
      shapePoints: 2,
    },
    fingerprint: "b".repeat(64),
  },
  snapshot: {
    stops: [
      {
        stopId: "STOP-A",
        stopCode: null,
        name: "Market at 5th",
        description: null,
        latitude: 37.7834,
        longitude: -122.4071,
        locationType: 0,
        parentStationId: null,
        wheelchairBoarding: 0,
        platformCode: null,
        zoneId: null,
      },
      {
        stopId: "STOP-B",
        stopCode: null,
        name: "Embarcadero",
        description: null,
        latitude: 37.7929,
        longitude: -122.3969,
        locationType: 0,
        parentStationId: null,
        wheelchairBoarding: 0,
        platformCode: null,
        zoneId: null,
      },
    ],
    shapes: [
      {
        shapeId: "SHAPE-N",
        latitude: 37.7834,
        longitude: -122.4071,
        sequence: 1,
        distanceTraveled: null,
      },
      {
        shapeId: "SHAPE-N",
        latitude: 37.7929,
        longitude: -122.3969,
        sequence: 2,
        distanceTraveled: null,
      },
    ],
    routes: [
      {
        routeId: "ROUTE-N",
        agencyId: "SF",
        shortName: "N",
        longName: "Judah",
        description: null,
        routeType: 0,
        url: null,
        color: null,
        textColor: null,
        sortOrder: null,
      },
    ],
    services: [
      {
        serviceId: "WEEKDAY",
        weekdays: [true, true, true, true, true, false, false] as [
          boolean,
          boolean,
          boolean,
          boolean,
          boolean,
          boolean,
          boolean,
        ],
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        exceptions: [],
      },
    ],
    trips: [
      {
        tripId: "TRIP-1",
        routeId: "ROUTE-N",
        serviceId: "WEEKDAY",
        shapeId: "SHAPE-N",
        headsign: "Downtown",
        shortName: null,
        directionId: 0 as const,
        blockId: null,
        wheelchairAccessible: 0,
        bikesAllowed: 0,
      },
    ],
    stopTimes: [
      {
        tripId: "TRIP-1",
        stopId: "STOP-A",
        arrivalSeconds: 28_800,
        departureSeconds: 28_800,
        stopSequence: 1,
        stopHeadsign: null,
        pickupType: 0,
        dropOffType: 0,
        shapeDistanceTraveled: null,
        timepoint: 1,
      },
      {
        tripId: "TRIP-1",
        stopId: "STOP-B",
        arrivalSeconds: 29_400,
        departureSeconds: 29_400,
        stopSequence: 2,
        stopHeadsign: null,
        pickupType: 0,
        dropOffType: 0,
        shapeDistanceTraveled: null,
        timepoint: 1,
      },
    ],
  },
};

function attempt(
  hash: string,
  basedOnFeedHash: string | null,
  checkedAt: Date,
): GtfsSnapshotAttempt {
  return {
    status: "validated",
    basedOnFeedHash,
    archive: {
      feedHash: hash,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: "https://api.511.org/transit/datafeeds?operator_id=SF",
      etag: null,
      lastModified: null,
      manifest: { "stops.txt": { bytes: 1, sha256: "c".repeat(64) } },
    },
    validation,
  };
}

try {
  const [publicState] = await connection<
    Array<{ shapeTable: string | null; migrationApplied: boolean }>
  >`
    select
      to_regclass('public.transit_shapes')::text as "shapeTable",
      exists (
        select 1
        from drizzle.__unbroken_migrations
        where created_at = 1787154515787
      ) as "migrationApplied"
  `;
  ensure(
    publicState?.shapeTable,
    "Current database is missing transit_shapes.",
  );
  ensure(
    publicState.migrationApplied,
    "Current database is missing migration 0002.",
  );

  await connection.unsafe(`create schema ${quotedNamespace}`);
  await connection.unsafe(`set search_path to ${quotedNamespace}`);
  const migration = readFileSync("drizzle/0002_citywide_transit.sql", "utf8")
    .replaceAll('"public".', `${quotedNamespace}.`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of migration) await connection.unsafe(statement);

  const [{ tableCount }] = await connection<[{ tableCount: number }]>`
    select count(*)::int as "tableCount"
    from information_schema.tables
    where table_schema = ${namespace}
  `;
  ensure(
    tableCount >= 16,
    "The empty-schema migration did not create all citywide tables.",
  );

  const database = drizzle(connection, { schema });
  const { PostgresGtfsSnapshotStore } =
    await import("@/server/transit/gtfs-store");
  const store = new PostgresGtfsSnapshotStore(database as never);
  const promoted = await store.applyRefreshAttempt(
    attempt(feedHash, null, new Date("2026-08-19T12:00:00.000Z")),
  );
  ensure(
    promoted.status === "promoted",
    "The verified snapshot was not promoted.",
  );
  ensure(
    promoted.activeSnapshot.coverage.counts.shapePoints === 2,
    "Shape coverage was not derived from stored rows.",
  );

  const unchanged = await store.applyRefreshAttempt(
    attempt(feedHash, feedHash, new Date("2026-08-19T12:05:00.000Z")),
  );
  ensure(
    unchanged.status === "unchanged",
    "Same-hash refresh was not idempotent.",
  );
  ensure(
    unchanged.activeSnapshot.checkedAt.toISOString() ===
      "2026-08-19T12:05:00.000Z",
    "Same-hash provenance was not refreshed.",
  );

  const stale = await store.applyRefreshAttempt(
    attempt("d".repeat(64), null, new Date("2026-08-19T12:10:00.000Z")),
  );
  ensure(stale.status === "rejected", "A stale baseline was not rejected.");
  ensure(
    stale.activeSnapshot?.feedHash === feedHash,
    "The trusted snapshot changed.",
  );

  const [stored] = await connection<
    Array<{
      active: number;
      stops: number;
      routes: number;
      trips: number;
      stopTimes: number;
      services: number;
      shapePoints: number;
    }>
  >`
    select
      (select count(*)::int from transit_feed_snapshots where status = 'active') as active,
      (select count(*)::int from transit_stops) as stops,
      (select count(*)::int from transit_routes) as routes,
      (select count(*)::int from transit_trips) as trips,
      (select count(*)::int from transit_stop_times) as "stopTimes",
      (select count(*)::int from transit_services) as services,
      (select count(*)::int from transit_shapes) as "shapePoints"
  `;
  ensure(
    stored?.active === 1 &&
      stored.stops === 2 &&
      stored.routes === 1 &&
      stored.trips === 1 &&
      stored.stopTimes === 2 &&
      stored.services === 1 &&
      stored.shapePoints === 2,
    "Stored snapshot counts failed readback verification.",
  );

  process.stdout.write(
    `${JSON.stringify({
      currentMigration: "verified",
      emptySchemaTables: tableCount,
      promoted: promoted.status,
      repeated: unchanged.status,
      stale: stale.status,
      counts: stored,
    })}\n`,
  );
} finally {
  await connection.unsafe("set search_path to public").catch(() => undefined);
  await connection
    .unsafe(`drop schema if exists ${quotedNamespace} cascade`)
    .catch(() => undefined);
  await connection.end();
}
