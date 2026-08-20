import { asc, eq } from "drizzle-orm";

import {
  MAX_ACTIVE_STOP_COUNT,
  createActiveStopMap,
  isValidActiveStopMapSnapshot,
  type ActiveStopMap,
  type ActiveStopMapSnapshot,
  type ActiveStopMapStore,
} from "@/domain/transit/stop-map";
import type { GtfsCoverageCounts } from "@/domain/transit/gtfs-validation";
import { db as applicationDatabase } from "@/server/db/client";
import { transitFeedSnapshots, transitStops } from "@/server/db/schema/transit";

type Database = typeof applicationDatabase;

const COUNT_KEYS = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;

type SnapshotIdentity = Pick<
  ActiveStopMapSnapshot,
  "snapshotId" | "feedHash" | "counts"
>;

function parseCounts(value: unknown): GtfsCoverageCounts | null {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as { counts?: unknown }).counts;
  if (!candidate || typeof candidate !== "object") return null;
  const counts = candidate as Partial<GtfsCoverageCounts>;
  if (
    COUNT_KEYS.some((key) => {
      const count = counts[key];
      return !Number.isSafeInteger(count) || Number(count) < 0;
    })
  ) {
    return null;
  }
  return {
    stops: Number(counts.stops),
    routes: Number(counts.routes),
    trips: Number(counts.trips),
    stopTimes: Number(counts.stopTimes),
    services: Number(counts.services),
    shapePoints: Number(counts.shapePoints),
  };
}

function identity(row: {
  id: string;
  feedHash: string;
  coverage: unknown;
}): SnapshotIdentity | null {
  const counts = parseCounts(row.coverage);
  if (!counts) return null;
  return {
    snapshotId: row.id,
    feedHash: row.feedHash,
    counts,
  };
}

function sameIdentity(left: SnapshotIdentity, right: SnapshotIdentity) {
  return (
    left.snapshotId === right.snapshotId &&
    left.feedHash === right.feedHash &&
    COUNT_KEYS.every((key) => left.counts[key] === right.counts[key])
  );
}

export class PostgresActiveStopMapStore implements ActiveStopMapStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  private async activeIdentity() {
    const row = await this.database.query.transitFeedSnapshots.findFirst({
      columns: { id: true, feedHash: true, coverage: true },
      where: eq(transitFeedSnapshots.status, "active"),
      orderBy: (snapshot, { desc }) => [desc(snapshot.acceptedAt)],
    });
    return row ? identity(row) : null;
  }

  async getActiveStopSnapshot(): Promise<ActiveStopMapSnapshot | null> {
    try {
      const active = await this.activeIdentity();
      if (!active) return null;

      // The map read path intentionally touches only the active snapshot and
      // its stop rows. Route/stop-time associations do not belong in this seam.
      const rows = await this.database
        .select({
          id: transitStops.stopId,
          name: transitStops.stopName,
          code: transitStops.stopCode,
          locationType: transitStops.locationType,
          parentStationId: transitStops.parentStationId,
          latitude: transitStops.latitude,
          longitude: transitStops.longitude,
        })
        .from(transitStops)
        .where(eq(transitStops.snapshotId, active.snapshotId))
        .orderBy(asc(transitStops.stopId))
        // Read one extra row so an oversized active snapshot fails closed
        // without materializing an unbounded result in this public seam.
        .limit(MAX_ACTIVE_STOP_COUNT + 1);

      const rechecked = await this.activeIdentity();
      if (!rechecked || !sameIdentity(active, rechecked)) return null;

      const snapshot = {
        snapshotId: active.snapshotId,
        feedHash: active.feedHash,
        counts: active.counts,
        stops: rows,
      } satisfies ActiveStopMapSnapshot;
      return isValidActiveStopMapSnapshot(snapshot) ? snapshot : null;
    } catch {
      return null;
    }
  }
}

let singleton: ActiveStopMap | undefined;

export function getActiveStopMap() {
  singleton ??= createActiveStopMap(new PostgresActiveStopMapStore());
  return singleton;
}

export const PostgresStopMapStore = PostgresActiveStopMapStore;
