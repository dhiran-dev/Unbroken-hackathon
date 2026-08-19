import { getServerEnv } from "@/lib/env";
import { createBrightDataStopRelocationCollector } from "@/server/transit/stop-relocation-collector";
import { PostgresStopRelocationStore } from "@/server/transit/stop-relocation-store";
import { refreshStopRelocations } from "@/server/transit/stop-relocations";

export async function runConfiguredStopRelocationRefresh(at = new Date()) {
  const env = getServerEnv();
  if (!env.CITYWIDE_DATA_ENABLED) {
    throw new Error("Citywide data refresh is disabled.");
  }
  return refreshStopRelocations(
    { at },
    {
      collector: createBrightDataStopRelocationCollector(
        env.BRIGHTDATA_API_TOKEN,
      ),
      store: new PostgresStopRelocationStore(),
    },
  );
}
