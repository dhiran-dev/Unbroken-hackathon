import { collectBrightData } from "@/server/services/bright-data";
import {
  STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  type StopAccessibilityGuideCollector,
} from "@/server/transit/stop-accessibility-guides";

export function createBrightDataStopAccessibilityGuideCollector(
  apiToken: string,
): StopAccessibilityGuideCollector {
  return {
    async collect() {
      const result = await collectBrightData({
        BRIGHTDATA_API_TOKEN: apiToken,
        BRIGHTDATA_COLLECTOR_ID: STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
        SFMTA_SOURCE_URL: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
      });
      return {
        collectorId: STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
        sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
        collectedAt: result.collectedAt,
        datasetComplete: result.payload.length === 1,
        envelope: result.payload.length === 1 ? result.payload[0] : null,
      };
    },
  };
}
