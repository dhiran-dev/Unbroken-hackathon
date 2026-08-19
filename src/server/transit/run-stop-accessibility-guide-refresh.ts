import { getServerEnv } from "@/lib/env";
import { createBrightDataStopAccessibilityGuideCollector } from "@/server/transit/stop-accessibility-guide-collector";
import { PostgresStopAccessibilityGuideStore } from "@/server/transit/stop-accessibility-guide-store";
import { refreshStopAccessibilityGuides } from "@/server/transit/stop-accessibility-guides";

export async function runConfiguredStopAccessibilityGuideRefresh(
  at = new Date(),
) {
  const env = getServerEnv();
  if (!env.CITYWIDE_DATA_ENABLED) {
    throw new Error("Citywide data refresh is disabled.");
  }
  return refreshStopAccessibilityGuides(
    { at },
    {
      collector: createBrightDataStopAccessibilityGuideCollector(
        env.BRIGHTDATA_API_TOKEN,
      ),
      store: new PostgresStopAccessibilityGuideStore(),
    },
  );
}
