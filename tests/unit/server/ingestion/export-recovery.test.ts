import { describe, expect, it } from "vitest";

import {
  assertReferenceExportPreflight,
  preflightExportRows,
} from "@/server/ingestion/export-recovery";
import type { TaxonomyManifest } from "@/server/ingestion/taxonomy";

const manifest: TaxonomyManifest = {
  manifestId: "caffeine-informer-taxonomy-v1",
  capturedAt: "2026-08-22T00:00:00.000Z",
  fingerprint: "sha256:taxonomy",
  listings: [],
  entries: {
    alpha: {
      sourceCode: "ED",
      category: "energy-drink",
      listingUrl: "https://www.caffeineinformer.com/the-caffeine-database",
    },
  },
};

function product(slug: string, caffeine: number, per100Ml: number) {
  return {
    product_name: slug,
    serving_size: "250 ml",
    caffeine_mg_per_serving: caffeine,
    caffeine_mg_per_100ml: per100Ml,
    product_page_url: `https://www.caffeineinformer.com/caffeine-content/${slug}`,
  };
}

describe("export recovery preflight", () => {
  it("separates page warnings, validates products, and counts rank-ineligible conflicts", () => {
    const result = preflightExportRows(
      [
        product("alpha", 80, 32),
        product("beta", 80, 4),
        { error: "navigation failed", error_code: "dead_page" },
      ],
      {
        observedAt: "2026-08-22T00:00:00.000Z",
        taxonomyManifest: manifest,
      },
    );

    expect(result.summary).toEqual({
      objectCount: 3,
      validUniqueProducts: 2,
      collectorErrorWarnings: 1,
      invalidRows: 0,
      duplicateSlugs: 0,
      rankIneligibleCaffeineConflicts: 1,
      taxonomyMatched: 1,
      taxonomyUnmatched: 1,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.identity.categoryProvenance).toBe("source_listing");
    expect(result.rows[1]?.identity.categoryProvenance).toBe("legacy_broad");
  });

  it("requires the supplied production export's exact sanitized shape", () => {
    expect(() =>
      assertReferenceExportPreflight({
        objectCount: 663,
        validUniqueProducts: 661,
        collectorErrorWarnings: 2,
        invalidRows: 0,
        duplicateSlugs: 0,
        rankIneligibleCaffeineConflicts: 3,
        taxonomyMatched: 661,
        taxonomyUnmatched: 0,
      }),
    ).not.toThrow();

    expect(() =>
      assertReferenceExportPreflight({
        objectCount: 662,
        validUniqueProducts: 661,
        collectorErrorWarnings: 1,
        invalidRows: 0,
        duplicateSlugs: 0,
        rankIneligibleCaffeineConflicts: 3,
        taxonomyMatched: 661,
        taxonomyUnmatched: 0,
      }),
    ).toThrow(/reference export preflight failed/i);
  });
});
