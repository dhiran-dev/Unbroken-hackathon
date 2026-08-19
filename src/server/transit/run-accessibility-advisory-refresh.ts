import { getServerEnv } from "@/lib/env";
import { refreshAccessibilityAdvisories } from "@/server/transit/accessibility-advisories";
import { createBrightDataAccessibilityAdvisoryCollector } from "@/server/transit/accessibility-advisory-collector";
import { PostgresAccessibilityAdvisoryStore } from "@/server/transit/accessibility-advisory-store";

export async function runConfiguredAccessibilityAdvisoryRefresh(
  at = new Date(),
) {
  const env = getServerEnv();
  if (!env.CITYWIDE_DATA_ENABLED) {
    throw new Error("Citywide data refresh is disabled.");
  }
  return refreshAccessibilityAdvisories(
    { at },
    {
      collector: createBrightDataAccessibilityAdvisoryCollector(
        env.BRIGHTDATA_API_TOKEN,
      ),
      store: new PostgresAccessibilityAdvisoryStore(),
    },
  );
}
