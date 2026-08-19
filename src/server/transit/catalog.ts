import { and, desc, eq, isNotNull, sql as drizzleSql } from "drizzle-orm";

import {
  createTransitCatalog,
  type CatalogSnapshot,
  type TransitCatalog,
  type TransitCatalogStore,
  type TransitCoverage,
} from "@/domain/transit/catalog";
import { db as applicationDatabase } from "@/server/db/client";
import {
  transitFeedSnapshots,
  transitLandmarks,
  transitRoutes,
  transitStops,
  transitStopTimes,
  transitTrips,
} from "@/server/db/schema/transit";

type Database = typeof applicationDatabase;

function routeName(route: {
  routeId: string;
  shortName: string | null;
  longName: string | null;
}) {
  if (route.shortName && route.longName) {
    return `${route.shortName} ${route.longName}`;
  }
  return route.shortName ?? route.longName ?? route.routeId;
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

const coverageKeys = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;

function parseCoverageCounts(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const counts = (value as { counts?: unknown }).counts;
  if (!counts || typeof counts !== "object") return null;
  const candidate = counts as Record<string, unknown>;
  if (
    coverageKeys.some(
      (key) =>
        !Number.isSafeInteger(candidate[key]) || Number(candidate[key]) < 0,
    )
  ) {
    return null;
  }
  return {
    stops: Number(candidate.stops),
    routes: Number(candidate.routes),
    trips: Number(candidate.trips),
    stopTimes: Number(candidate.stopTimes),
    services: Number(candidate.services),
    shapePoints: Number(candidate.shapePoints),
  };
}

export class PostgresTransitCatalogStore implements TransitCatalogStore {
  private readonly transitCache = new Map<string, CatalogSnapshot["stops"]>();
  private readonly transitLoads = new Map<
    string,
    Promise<CatalogSnapshot["stops"] | null>
  >();

  constructor(private readonly database: Database = applicationDatabase) {}

  private async queryTransitStops(
    snapshotId: string,
  ): Promise<CatalogSnapshot["stops"]> {
    const stopRows = await this.database
      .select({
        stopId: transitStops.stopId,
        stopCode: transitStops.stopCode,
        name: transitStops.stopName,
        latitude: transitStops.latitude,
        longitude: transitStops.longitude,
        locationType: transitStops.locationType,
        parentStationId: transitStops.parentStationId,
      })
      .from(transitStops)
      .where(eq(transitStops.snapshotId, snapshotId));

    // This is the one potentially large association scan for a cached snapshot.
    const associations = await this.database
      .selectDistinct({
        stopId: transitStopTimes.stopId,
        routeId: transitRoutes.routeId,
        shortName: transitRoutes.shortName,
        longName: transitRoutes.longName,
      })
      .from(transitStopTimes)
      .innerJoin(
        transitTrips,
        and(
          eq(transitTrips.snapshotId, transitStopTimes.snapshotId),
          eq(transitTrips.tripId, transitStopTimes.tripId),
        ),
      )
      .innerJoin(
        transitRoutes,
        and(
          eq(transitRoutes.snapshotId, transitTrips.snapshotId),
          eq(transitRoutes.routeId, transitTrips.routeId),
        ),
      )
      .where(eq(transitStopTimes.snapshotId, snapshotId));

    const routesByStop = new Map<string, Set<string>>();
    for (const association of associations) {
      const routes = routesByStop.get(association.stopId) ?? new Set<string>();
      routes.add(routeName(association));
      routesByStop.set(association.stopId, routes);
    }

    return stopRows.map((stop) => ({
      ...stop,
      routeNames: [...(routesByStop.get(stop.stopId) ?? [])].sort(compareText),
    }));
  }

  private async transitStopsFor(snapshotId: string) {
    const cached = this.transitCache.get(snapshotId);
    if (cached) return cached;
    const existing = this.transitLoads.get(snapshotId);
    if (existing) return existing;
    const promise = (async () => {
      const stops = await this.queryTransitStops(snapshotId);
      if ((await this.getActiveCatalogIdentity())?.snapshotId !== snapshotId) {
        return null;
      }
      this.transitCache.clear();
      this.transitCache.set(snapshotId, stops);
      return stops;
    })();
    this.transitLoads.set(snapshotId, promise);
    const clear = () => {
      if (this.transitLoads.get(snapshotId) === promise) {
        this.transitLoads.delete(snapshotId);
      }
    };
    void promise.then(clear, clear);
    return promise;
  }

  async getActiveCatalogIdentity() {
    const [identity] = await this.database
      .select({
        snapshotId: transitFeedSnapshots.id,
        landmarkRevision: drizzleSql<string>`coalesce(
          md5(
            string_agg(
              jsonb_build_array(
                ${transitLandmarks.id},
                ${transitLandmarks.name},
                ${transitLandmarks.description},
                ${transitLandmarks.latitude},
                ${transitLandmarks.longitude},
                ${transitLandmarks.aliases},
                ${transitLandmarks.stopIds},
                ${transitLandmarks.evidenceUrl},
                ${transitLandmarks.reviewedAt},
                ${transitLandmarks.updatedAt}
              )::text,
              ',' order by ${transitLandmarks.id}
            ) filter (where ${transitLandmarks.id} is not null)
          ),
          md5('')
        )`,
      })
      .from(transitFeedSnapshots)
      .leftJoin(
        transitLandmarks,
        and(
          eq(transitLandmarks.active, true),
          isNotNull(transitLandmarks.reviewedAt),
        ),
      )
      .where(eq(transitFeedSnapshots.status, "active"))
      .groupBy(transitFeedSnapshots.id, transitFeedSnapshots.acceptedAt)
      .orderBy(desc(transitFeedSnapshots.acceptedAt))
      .limit(1);
    return identity ?? null;
  }

  async loadSnapshot(snapshotId: string): Promise<CatalogSnapshot | null> {
    const active = await this.database.query.transitFeedSnapshots.findFirst({
      columns: { id: true },
      where: and(
        eq(transitFeedSnapshots.id, snapshotId),
        eq(transitFeedSnapshots.status, "active"),
      ),
    });
    if (!active) return null;

    const stops = await this.transitStopsFor(snapshotId);
    if (!stops) return null;

    const landmarks = await this.database
      .select({
        id: transitLandmarks.id,
        name: transitLandmarks.name,
        description: transitLandmarks.description,
        latitude: transitLandmarks.latitude,
        longitude: transitLandmarks.longitude,
        aliases: transitLandmarks.aliases,
        stopIds: transitLandmarks.stopIds,
      })
      .from(transitLandmarks)
      .where(
        and(
          eq(transitLandmarks.active, true),
          isNotNull(transitLandmarks.reviewedAt),
        ),
      );

    if ((await this.getActiveCatalogIdentity())?.snapshotId !== snapshotId) {
      return null;
    }
    return {
      snapshotId,
      stops,
      landmarks,
    };
  }

  async getCoverage(): Promise<TransitCoverage> {
    const active = await this.database.query.transitFeedSnapshots.findFirst({
      columns: { id: true, feedHash: true, coverage: true },
      where: eq(transitFeedSnapshots.status, "active"),
      orderBy: (table, { desc }) => [desc(table.acceptedAt)],
    });
    if (!active) return { available: false };
    const counts = parseCoverageCounts(active.coverage);
    if (!counts) return { available: false };
    if ((await this.getActiveCatalogIdentity())?.snapshotId !== active.id) {
      return { available: false };
    }
    return {
      available: true,
      snapshotId: active.id,
      feedHash: active.feedHash,
      counts,
    };
  }
}

let singleton: TransitCatalog | undefined;

export function getTransitCatalog() {
  singleton ??= createTransitCatalog(new PostgresTransitCatalogStore());
  return singleton;
}
