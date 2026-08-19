import { and, asc, desc, eq } from "drizzle-orm";

import { SFMTA_STATIONS } from "@/domain/collection/catalog";
import {
  deriveRiderStationState,
  toElevatorState,
  type PublicAccessibility,
  type PublicElevator,
  type RiderStationState,
} from "@/domain/accessibility/model";
import { getReviewedElevatorRole } from "@/domain/accessibility/topology";
import { db } from "@/server/db/client";
import {
  collectionRuns,
  equipment,
  observations,
  stations,
  trustedSnapshots,
} from "@/server/db/schema";

const HEALTHY_FRESHNESS_SECONDS = 10 * 60;

export async function getPublicAccessibility(
  now = new Date(),
): Promise<PublicAccessibility | null> {
  const [[snapshotResult], [latestRun]] = await Promise.all([
    db
      .select({ snapshot: trustedSnapshots })
      .from(trustedSnapshots)
      .innerJoin(
        collectionRuns,
        eq(trustedSnapshots.collectionRunId, collectionRuns.id),
      )
      .where(
        and(
          eq(trustedSnapshots.trustState, "current"),
          eq(collectionRuns.status, "accepted"),
        ),
      )
      .orderBy(desc(trustedSnapshots.acceptedAt))
      .limit(1),
    db
      .select({
        id: collectionRuns.id,
        status: collectionRuns.status,
        createdAt: collectionRuns.createdAt,
      })
      .from(collectionRuns)
      .orderBy(desc(collectionRuns.createdAt))
      .limit(1),
  ]);

  const snapshot = snapshotResult?.snapshot;

  if (!snapshot) return null;

  const rows = await db
    .select({
      stationSlug: stations.slug,
      reportedStationState: observations.reportedStationAccessibility,
      equipmentSourceKey: equipment.sourceKey,
      equipmentName: equipment.displayName,
      equipmentState: observations.equipmentStatus,
      sourceLastChangedAt: observations.sourceLastChangedAt,
    })
    .from(observations)
    .innerJoin(stations, eq(observations.stationId, stations.id))
    .innerJoin(equipment, eq(observations.equipmentId, equipment.id))
    .where(eq(observations.collectionRunId, snapshot.collectionRunId))
    .orderBy(asc(stations.corridorOrder), asc(equipment.displayName));

  const rowsByStation = new Map<string, typeof rows>();
  for (const row of rows) {
    const stationRows = rowsByStation.get(row.stationSlug) ?? [];
    stationRows.push(row);
    rowsByStation.set(row.stationSlug, stationRows);
  }

  const publicStations = SFMTA_STATIONS.map((definition) => {
    const stationRows = rowsByStation.get(definition.slug) ?? [];
    const elevatorStates = stationRows.map((row) => ({
      sourceKey: row.equipmentSourceKey,
      name: row.equipmentName,
      state: toElevatorState(row.equipmentState),
      lastChangedAt: row.sourceLastChangedAt,
    }));
    const elevators: PublicElevator[] = elevatorStates.map((elevator) => {
      const role = getReviewedElevatorRole(
        definition.slug,
        elevator.sourceKey,
      );
      const alternativeName = role?.alternatives
        .map((sourceKey) =>
          elevatorStates.find(
            (candidate) => candidate.sourceKey === sourceKey,
          ),
        )
        .find(
          (candidate) =>
            candidate?.sourceKey !== elevator.sourceKey &&
            candidate?.state === "working",
        )?.name;
      return {
        ...elevator,
        role: role?.label ?? "Elevator access",
        alternativeName: alternativeName ?? null,
      };
    });
    const reportedState = stationRows[0]?.reportedStationState ?? "unknown";

    return {
      slug: definition.slug,
      name: definition.displayName,
      corridorOrder: definition.corridorOrder,
      state: deriveRiderStationState(
        reportedState,
        elevators.map((elevator) => elevator.state),
      ),
      elevators,
    };
  });

  const counts: Record<RiderStationState, number> = {
    accessible: 0,
    limited: 0,
    unavailable: 0,
    unknown: 0,
  };
  for (const station of publicStations) counts[station.state] += 1;

  const ageSeconds = Math.max(
    0,
    Math.floor((now.getTime() - snapshot.sourceValidAt.getTime()) / 1_000),
  );
  const newerUpdateHeld = Boolean(
    latestRun &&
      latestRun.id !== snapshot.collectionRunId &&
      latestRun.createdAt > snapshot.acceptedAt &&
      latestRun.status !== "accepted",
  );

  return {
    trust: {
      state:
        ageSeconds <= HEALTHY_FRESHNESS_SECONDS && !newerUpdateHeld
          ? "current"
          : "older",
      sourceValidAt: snapshot.sourceValidAt,
      ageSeconds,
    },
    counts,
    stations: publicStations,
  };
}
