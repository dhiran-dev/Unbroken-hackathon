import { collectBrightData } from "@/server/services/bright-data";
import {
  STOP_RELOCATION_COLLECTOR_ID,
  STOP_RELOCATION_SOURCE_URL,
  type StopRelocationCollector,
} from "@/server/transit/stop-relocations";

export function createBrightDataStopRelocationCollector(
  apiToken: string,
): StopRelocationCollector {
  return {
    async collect() {
      const result = await collectBrightData({
        BRIGHTDATA_API_TOKEN: apiToken,
        BRIGHTDATA_COLLECTOR_ID: STOP_RELOCATION_COLLECTOR_ID,
        SFMTA_SOURCE_URL: STOP_RELOCATION_SOURCE_URL,
      });
      return {
        collectorId: STOP_RELOCATION_COLLECTOR_ID,
        sourceUrl: STOP_RELOCATION_SOURCE_URL,
        collectedAt: result.collectedAt,
        datasetComplete: result.payload.length === 1,
        envelope: result.payload.length === 1 ? result.payload[0] : null,
      };
    },
  };
}
