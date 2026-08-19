import { getServerEnv } from "@/lib/env";
import { sql } from "@/server/db/client";
import { refreshGtfsSnapshot } from "@/server/transit/gtfs-refresh";
import { PostgresGtfsSnapshotStore } from "@/server/transit/gtfs-store";
import {
  createMuniGtfsArchiveLoader,
  MUNI_GTFS_VALIDATION_POLICY,
} from "@/server/transit/muni-gtfs";

const env = getServerEnv();
if (!env.CITYWIDE_DATA_ENABLED || !env.TRANSIT_511_API_TOKEN) {
  throw new Error("Citywide data refresh is disabled.");
}

try {
  const result = await refreshGtfsSnapshot(
    { at: new Date() },
    {
      archiveLoader: createMuniGtfsArchiveLoader({
        apiToken: env.TRANSIT_511_API_TOKEN,
      }),
      snapshotStore: new PostgresGtfsSnapshotStore(),
      validationPolicy: MUNI_GTFS_VALIDATION_POLICY,
    },
  );
  process.stdout.write(
    `${JSON.stringify({
      status: result.status,
      snapshotId: result.activeSnapshot?.snapshotId ?? null,
      checkedAt: result.activeSnapshot?.checkedAt.toISOString() ?? null,
      sourceUpdatedAt:
        result.activeSnapshot?.sourceUpdatedAt?.toISOString() ?? null,
      coverage: result.activeSnapshot?.coverage ?? null,
    })}\n`,
  );
} finally {
  await sql.end();
}
