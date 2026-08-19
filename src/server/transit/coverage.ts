import { classifyTransitCoverage } from "@/domain/transit/coverage";
import { PostgresGtfsSnapshotStore } from "@/server/transit/gtfs-store";

export async function getTransitCoverage(at = new Date()) {
  const snapshot = await new PostgresGtfsSnapshotStore().getActiveSnapshot();
  return snapshot
    ? {
        ...snapshot,
        state: classifyTransitCoverage(snapshot.coverage.serviceDate, at),
      }
    : null;
}
