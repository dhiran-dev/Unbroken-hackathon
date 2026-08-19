import { collectBrightData } from "@/server/services/bright-data";
import {
  ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  type AccessibilityAdvisoryCollector,
} from "@/server/transit/accessibility-advisories";

export function createBrightDataAccessibilityAdvisoryCollector(
  apiToken: string,
): AccessibilityAdvisoryCollector {
  return {
    async collect() {
      const result = await collectBrightData({
        BRIGHTDATA_API_TOKEN: apiToken,
        BRIGHTDATA_COLLECTOR_ID: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
        SFMTA_SOURCE_URL: ACCESSIBILITY_ADVISORY_SOURCE_URL,
      });
      const listingComplete = result.payload.length >= 11;
      const detailNavigationComplete = result.payload.every(
        (row) =>
          row !== null &&
          typeof row === "object" &&
          "detail_url" in row &&
          typeof row.detail_url === "string" &&
          row.detail_url.trim().length > 0 &&
          "body_text" in row &&
          typeof row.body_text === "string" &&
          row.body_text.trim().length > 0,
      );
      return {
        collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
        sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
        rows: result.payload,
        collectedAt: result.collectedAt,
        listingComplete,
        detailNavigationComplete,
      };
    },
  };
}
