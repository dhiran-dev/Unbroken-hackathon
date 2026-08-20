import { and, desc, eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import {
  collectionRuns,
  transitFeedSnapshots,
  transitRoutes,
  transitStops,
  trustedSnapshots,
} from "@/server/db/schema";
import { getPublicAccessibility } from "@/server/services/public-accessibility";

import { createAccessibilityElevatorReader } from "./accessibility-elevator-read";
import {
  createActiveTransitEntitiesReader,
  createExactAccessibilityResolvers,
} from "./accessibility-evidence-resolvers";

const activeTransitEntitiesStore = {
  async getActiveSnapshotId() {
    const active = await db.query.transitFeedSnapshots.findFirst({
      columns: { id: true },
      where: eq(transitFeedSnapshots.status, "active"),
    });
    return active?.id ?? null;
  },
  async load(snapshotId: string) {
    const [stops, routes] = await Promise.all([
      db
        .select({
          stopId: transitStops.stopId,
          stopName: transitStops.stopName,
        })
        .from(transitStops)
        .where(eq(transitStops.snapshotId, snapshotId)),
      db
        .select({ routeId: transitRoutes.routeId })
        .from(transitRoutes)
        .where(eq(transitRoutes.snapshotId, snapshotId)),
    ]);
    return {
      snapshotId,
      stops,
      routeIds: routes.map((route) => route.routeId),
    };
  },
};

const readActiveTransitEntities = createActiveTransitEntitiesReader(
  activeTransitEntitiesStore,
);

async function readTrustedElevatorMetadata() {
  const [row] = await db
    .select({
      snapshotId: trustedSnapshots.id,
      sourceValidAt: trustedSnapshots.sourceValidAt,
      checkedAt: trustedSnapshots.collectedAt,
    })
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
    .limit(1);
  return row ?? null;
}

export const readAccessibilityElevators = createAccessibilityElevatorReader({
  readMetadata: readTrustedElevatorMetadata,
  readPublic: getPublicAccessibility,
});
export const exactAccessibilityResolvers = createExactAccessibilityResolvers(
  readActiveTransitEntities,
);
