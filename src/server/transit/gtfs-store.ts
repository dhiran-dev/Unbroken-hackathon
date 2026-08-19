import { eq, sql as drizzleSql } from "drizzle-orm";

import type { GtfsCoverageSummary } from "@/domain/transit/gtfs-validation";
import { db as applicationDatabase } from "@/server/db/client";
import {
  transitFeedSnapshots,
  transitRoutes,
  transitServices,
  transitShapes,
  transitStops,
  transitStopTimes,
  transitTrips,
} from "@/server/db/schema/transit";
import type {
  ActiveGtfsSnapshot,
  GtfsSnapshotAttempt,
  GtfsSnapshotStore,
  StoredGtfsRefreshResult,
} from "@/server/transit/gtfs-refresh";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SnapshotRow = typeof transitFeedSnapshots.$inferSelect;

const IMPORT_LOCK_ID = 1_431_196_242;
const INSERT_BATCH_SIZE = 1_000;
const COUNT_KEYS = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;

function asJson(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function parseCoverage(value: unknown): GtfsCoverageSummary {
  if (!value || typeof value !== "object") {
    throw new Error("Active transit coverage is invalid.");
  }
  const candidate = value as Partial<GtfsCoverageSummary>;
  if (
    typeof candidate.serviceDate !== "string" ||
    typeof candidate.activeServiceCount !== "number" ||
    typeof candidate.fingerprint !== "string" ||
    !candidate.counts ||
    COUNT_KEYS.some(
      (key) =>
        typeof candidate.counts?.[key] !== "number" ||
        !Number.isSafeInteger(candidate.counts[key]) ||
        candidate.counts[key] < 0,
    )
  ) {
    throw new Error("Active transit coverage is invalid.");
  }
  return candidate as GtfsCoverageSummary;
}

function toActiveSnapshot(row: SnapshotRow): ActiveGtfsSnapshot {
  return {
    snapshotId: row.id,
    feedHash: row.feedHash,
    coverage: parseCoverage(row.coverage),
    checkedAt: row.checkedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    sourceUrl: row.sourceUrl,
  };
}

async function activeInside(transaction: Transaction) {
  const row = await transaction.query.transitFeedSnapshots.findFirst({
    where: eq(transitFeedSnapshots.status, "active"),
    orderBy: (snapshot, { desc }) => [desc(snapshot.acceptedAt)],
  });
  return row ? toActiveSnapshot(row) : null;
}

async function existingHash(transaction: Transaction, feedHash: string) {
  return transaction.query.transitFeedSnapshots.findFirst({
    where: eq(transitFeedSnapshots.feedHash, feedHash),
  });
}

async function removeReplaceableHash(
  transaction: Transaction,
  feedHash: string,
) {
  const existing = await existingHash(transaction, feedHash);
  if (!existing) return null;
  if (existing.status === "active") return toActiveSnapshot(existing);
  await transaction
    .delete(transitFeedSnapshots)
    .where(eq(transitFeedSnapshots.id, existing.id));
  return null;
}

async function insertRejected(
  transaction: Transaction,
  attempt: GtfsSnapshotAttempt,
  report: Record<string, unknown>,
) {
  const active = await activeInside(transaction);
  await transaction.insert(transitFeedSnapshots).values({
    feedHash: attempt.archive.feedHash,
    sourceUrl: attempt.archive.sourceUrl,
    sourceEtag: attempt.archive.etag,
    sourceLastModified: attempt.archive.lastModified,
    checkedAt: attempt.archive.checkedAt,
    sourceUpdatedAt: attempt.archive.sourceUpdatedAt,
    acceptedAt: null,
    status: "rejected",
    validationReport: report,
    fileManifest: asJson(attempt.archive.manifest),
    coverage: asJson(active?.coverage ?? {}),
  });
  return { status: "rejected", activeSnapshot: active } as const;
}

async function insertInBatches<T>(
  rows: T[],
  insert: (batch: T[]) => Promise<unknown>,
) {
  for (let offset = 0; offset < rows.length; offset += INSERT_BATCH_SIZE) {
    await insert(rows.slice(offset, offset + INSERT_BATCH_SIZE));
  }
}

async function databaseCounts(transaction: Transaction, snapshotId: string) {
  const count = drizzleSql<number>`count(*)::int`;
  const [stops] = await transaction
    .select({ value: count })
    .from(transitStops)
    .where(eq(transitStops.snapshotId, snapshotId));
  const [routes] = await transaction
    .select({ value: count })
    .from(transitRoutes)
    .where(eq(transitRoutes.snapshotId, snapshotId));
  const [trips] = await transaction
    .select({ value: count })
    .from(transitTrips)
    .where(eq(transitTrips.snapshotId, snapshotId));
  const [stopTimes] = await transaction
    .select({ value: count })
    .from(transitStopTimes)
    .where(eq(transitStopTimes.snapshotId, snapshotId));
  const [services] = await transaction
    .select({ value: count })
    .from(transitServices)
    .where(eq(transitServices.snapshotId, snapshotId));
  const [shapePoints] = await transaction
    .select({ value: count })
    .from(transitShapes)
    .where(eq(transitShapes.snapshotId, snapshotId));
  return {
    stops: Number(stops?.value ?? 0),
    routes: Number(routes?.value ?? 0),
    trips: Number(trips?.value ?? 0),
    stopTimes: Number(stopTimes?.value ?? 0),
    services: Number(services?.value ?? 0),
    shapePoints: Number(shapePoints?.value ?? 0),
  };
}

function countsMatch(
  actual: Awaited<ReturnType<typeof databaseCounts>>,
  expected: GtfsCoverageSummary["counts"],
) {
  return (
    actual.stops === expected.stops &&
    actual.routes === expected.routes &&
    actual.trips === expected.trips &&
    actual.stopTimes === expected.stopTimes &&
    actual.services === expected.services &&
    actual.shapePoints === expected.shapePoints
  );
}

export class PostgresGtfsSnapshotStore implements GtfsSnapshotStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async getActiveSnapshot() {
    const row = await this.database.query.transitFeedSnapshots.findFirst({
      where: eq(transitFeedSnapshots.status, "active"),
      orderBy: (snapshot, { desc }) => [desc(snapshot.acceptedAt)],
    });
    return row ? toActiveSnapshot(row) : null;
  }

  async applyRefreshAttempt(
    attempt: GtfsSnapshotAttempt,
  ): Promise<StoredGtfsRefreshResult> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`select pg_advisory_xact_lock(${IMPORT_LOCK_ID})`,
      );
      const active = await activeInside(transaction);
      if (active?.feedHash === attempt.archive.feedHash) {
        if (
          attempt.status === "rejected" ||
          attempt.archive.checkedAt < active.checkedAt
        ) {
          return { status: "rejected", activeSnapshot: active };
        }
        let storedCounts = await databaseCounts(transaction, active.snapshotId);
        const expectedCounts = attempt.validation.summary.counts;
        if (
          storedCounts.stops === expectedCounts.stops &&
          storedCounts.routes === expectedCounts.routes &&
          storedCounts.trips === expectedCounts.trips &&
          storedCounts.stopTimes === expectedCounts.stopTimes &&
          storedCounts.services === expectedCounts.services &&
          storedCounts.shapePoints === 0 &&
          expectedCounts.shapePoints > 0
        ) {
          await insertInBatches(attempt.validation.snapshot.shapes, (batch) =>
            transaction.insert(transitShapes).values(
              batch.map((shape) => ({
                snapshotId: active.snapshotId,
                shapeId: shape.shapeId,
                sequence: shape.sequence,
                latitude: shape.latitude,
                longitude: shape.longitude,
                distanceTraveled: shape.distanceTraveled,
              })),
            ),
          );
          storedCounts = await databaseCounts(transaction, active.snapshotId);
        }
        if (!countsMatch(storedCounts, expectedCounts)) {
          return { status: "rejected", activeSnapshot: active };
        }
        await transaction
          .update(transitFeedSnapshots)
          .set({
            sourceUrl: attempt.archive.sourceUrl,
            sourceEtag: attempt.archive.etag,
            sourceLastModified: attempt.archive.lastModified,
            checkedAt: attempt.archive.checkedAt,
            sourceUpdatedAt: attempt.archive.sourceUpdatedAt,
            validationReport: asJson({
              accepted: true,
              summary: attempt.validation.summary,
            }),
            fileManifest: asJson(attempt.archive.manifest),
            coverage: asJson(attempt.validation.summary),
          })
          .where(eq(transitFeedSnapshots.id, active.snapshotId));
        return {
          status: "unchanged",
          activeSnapshot: {
            ...active,
            coverage: attempt.validation.summary,
            checkedAt: attempt.archive.checkedAt,
            sourceUpdatedAt: attempt.archive.sourceUpdatedAt,
            sourceUrl: attempt.archive.sourceUrl,
          },
        };
      }

      if (
        attempt.basedOnFeedHash !== (active?.feedHash ?? null) ||
        (active !== null && attempt.archive.checkedAt < active.checkedAt)
      ) {
        return { status: "rejected", activeSnapshot: active };
      }

      await removeReplaceableHash(transaction, attempt.archive.feedHash);
      if (attempt.status === "rejected") {
        return insertRejected(transaction, attempt, asJson(attempt.validation));
      }

      const [staged] = await transaction
        .insert(transitFeedSnapshots)
        .values({
          feedHash: attempt.archive.feedHash,
          sourceUrl: attempt.archive.sourceUrl,
          sourceEtag: attempt.archive.etag,
          sourceLastModified: attempt.archive.lastModified,
          checkedAt: attempt.archive.checkedAt,
          sourceUpdatedAt: attempt.archive.sourceUpdatedAt,
          acceptedAt: null,
          status: "staged",
          validationReport: asJson({
            accepted: true,
            summary: attempt.validation.summary,
          }),
          fileManifest: asJson(attempt.archive.manifest),
          coverage: asJson(attempt.validation.summary),
        })
        .returning({ id: transitFeedSnapshots.id });
      if (!staged)
        throw new Error("The staged transit snapshot was not created.");
      const snapshotId = staged.id;
      const snapshot = attempt.validation.snapshot;

      const orderedStops = [...snapshot.stops].sort(
        (left, right) =>
          Number(Boolean(left.parentStationId)) -
          Number(Boolean(right.parentStationId)),
      );
      await insertInBatches(orderedStops, (batch) =>
        transaction.insert(transitStops).values(
          batch.map((stop) => ({
            snapshotId,
            stopId: stop.stopId,
            stopCode: stop.stopCode,
            stopName: stop.name,
            stopDescription: stop.description,
            latitude: stop.latitude,
            longitude: stop.longitude,
            locationType: stop.locationType,
            parentStationId: stop.parentStationId,
            wheelchairBoarding: stop.wheelchairBoarding,
            platformCode: stop.platformCode,
            zoneId: stop.zoneId,
          })),
        ),
      );
      await insertInBatches(snapshot.shapes, (batch) =>
        transaction.insert(transitShapes).values(
          batch.map((shape) => ({
            snapshotId,
            shapeId: shape.shapeId,
            sequence: shape.sequence,
            latitude: shape.latitude,
            longitude: shape.longitude,
            distanceTraveled: shape.distanceTraveled,
          })),
        ),
      );
      await insertInBatches(snapshot.routes, (batch) =>
        transaction.insert(transitRoutes).values(
          batch.map((route) => ({
            snapshotId,
            routeId: route.routeId,
            agencyId: route.agencyId,
            shortName: route.shortName,
            longName: route.longName,
            description: route.description,
            routeType: route.routeType,
            url: route.url,
            color: route.color,
            textColor: route.textColor,
            sortOrder: route.sortOrder,
          })),
        ),
      );
      await insertInBatches(snapshot.services, (batch) =>
        transaction.insert(transitServices).values(
          batch.map((service) => ({
            snapshotId,
            serviceId: service.serviceId,
            monday: service.weekdays[0],
            tuesday: service.weekdays[1],
            wednesday: service.weekdays[2],
            thursday: service.weekdays[3],
            friday: service.weekdays[4],
            saturday: service.weekdays[5],
            sunday: service.weekdays[6],
            startsOn: service.startDate,
            endsOn: service.endDate,
            exceptions: service.exceptions,
          })),
        ),
      );
      await insertInBatches(snapshot.trips, (batch) =>
        transaction.insert(transitTrips).values(
          batch.map((trip) => ({
            snapshotId,
            tripId: trip.tripId,
            routeId: trip.routeId,
            serviceId: trip.serviceId,
            headsign: trip.headsign,
            shortName: trip.shortName,
            directionId: trip.directionId,
            blockId: trip.blockId,
            shapeId: trip.shapeId,
            wheelchairAccessible: trip.wheelchairAccessible,
            bikesAllowed: trip.bikesAllowed,
          })),
        ),
      );
      await insertInBatches(snapshot.stopTimes, (batch) =>
        transaction.insert(transitStopTimes).values(
          batch.map((stopTime) => ({
            snapshotId,
            tripId: stopTime.tripId,
            stopSequence: stopTime.stopSequence,
            stopId: stopTime.stopId,
            arrivalSeconds: stopTime.arrivalSeconds,
            departureSeconds: stopTime.departureSeconds,
            stopHeadsign: stopTime.stopHeadsign,
            pickupType: stopTime.pickupType,
            dropOffType: stopTime.dropOffType,
            shapeDistanceTraveled: stopTime.shapeDistanceTraveled,
            timepoint: stopTime.timepoint,
          })),
        ),
      );

      const storedCounts = await databaseCounts(transaction, snapshotId);
      if (!countsMatch(storedCounts, attempt.validation.summary.counts)) {
        await transaction
          .delete(transitFeedSnapshots)
          .where(eq(transitFeedSnapshots.id, snapshotId));
        return insertRejected(transaction, attempt, {
          accepted: false,
          reasons: [{ code: "STORE_INTEGRITY" }],
          expected: attempt.validation.summary.counts,
          actual: storedCounts,
        });
      }

      const coverage: GtfsCoverageSummary = {
        ...attempt.validation.summary,
        counts: storedCounts,
      };
      await transaction
        .update(transitFeedSnapshots)
        .set({ status: "superseded" })
        .where(eq(transitFeedSnapshots.status, "active"));
      await transaction
        .update(transitFeedSnapshots)
        .set({
          status: "active",
          acceptedAt: attempt.archive.checkedAt,
          coverage: asJson(coverage),
        })
        .where(eq(transitFeedSnapshots.id, snapshotId));

      return {
        status: "promoted",
        activeSnapshot: {
          snapshotId,
          feedHash: attempt.archive.feedHash,
          coverage,
          checkedAt: attempt.archive.checkedAt,
          sourceUpdatedAt: attempt.archive.sourceUpdatedAt,
          sourceUrl: attempt.archive.sourceUrl,
        },
      };
    });
  }
}
