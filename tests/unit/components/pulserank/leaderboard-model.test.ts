import { describe, expect, it } from "vitest";

import {
  isEligibleForBoard,
  servingText,
  summarizeEligibility,
} from "@/app/leaderboards/leaderboard-model";
import {
  emptyLeaderboardCopy,
  mergeLeaderboardRows,
  sourceForDisplay,
} from "@/app/leaderboards/leaderboard-results-model";
import type { PublicProductDto } from "@/server/products/dto";

function product(overrides: Partial<PublicProductDto> = {}): PublicProductDto {
  return {
    slug: "sample",
    name: "Sample Drink",
    category: "energy-drink",
    categoryProvenance: "source_pdp",
    caffeine: {
      mg: 120,
      min: null,
      max: null,
      qualifier: "exact",
      state: "present",
      sourceLevel: "high",
    },
    serving: {
      value: 12,
      normalizedMl: 355,
      unit: "fl_oz",
      form: "drink",
      state: "present",
    },
    concentration: { mgPer100Ml: 33.8 },
    observedAt: "2026-08-21T09:30:00.000Z",
    rankingEligibility: { totalCaffeine: true, concentration: true, reasons: [] },
    image: null,
    sourceAttribution: "Caffeine Informer",
    sourceUrl: "https://www.caffeineinformer.com/caffeine-content/sample",
    ...overrides,
  };
}

describe("leaderboard exact eligibility", () => {
  it("admits only exact point values to the total-caffeine board", () => {
    expect(isEligibleForBoard("highest-total-caffeine", product())).toBe(true);
    expect(isEligibleForBoard("highest-total-caffeine", product({
      caffeine: {
        ...product().caffeine,
        mg: null,
        min: 100,
        max: 140,
        qualifier: "range",
      },
    }))).toBe(false);
  });

  it("requires exact caffeine and normalized volume for concentration", () => {
    expect(isEligibleForBoard("highest-exact-concentration", product())).toBe(true);
    expect(isEligibleForBoard("highest-exact-concentration", product({
      serving: { ...product().serving, normalizedMl: null },
      concentration: { mgPer100Ml: null },
      rankingEligibility: {
        totalCaffeine: true,
        concentration: false,
        reasons: ["concentration_requires_ml_volume"],
      },
    }))).toBe(false);
  });

  it("counts exclusions from explicit DTO states instead of placeholder totals", () => {
    const conflicting = product({
      slug: "conflict",
      caffeine: { ...product().caffeine, mg: null, state: "conflicting" },
    });
    const sparse = product({
      slug: "sparse",
      caffeine: { ...product().caffeine, mg: null, state: "not_published" },
    });
    expect(summarizeEligibility("highest-total-caffeine", [product(), conflicting, sparse])).toEqual({
      eligibleCount: 1,
      excludedCount: 2,
      reasons: [
        { label: "Conflicting values", count: 1 },
        { label: "Not published", count: 1 },
      ],
    });
  });

  it("keeps serving context and normalized milliliters together", () => {
    expect(servingText(product())).toEqual({ primary: "12 fl oz", secondary: "(355 ml)" });
  });

  it("preserves immutable ranks while deduplicating cursor pages", () => {
    const first = { entry: { productId: "one", rank: 200 }, product: product({ slug: "one" }) } as never;
    const duplicate = { entry: { productId: "one", rank: 200 }, product: product({ slug: "one" }) } as never;
    const next = { entry: { productId: "two", rank: 201 }, product: product({ slug: "two" }) } as never;
    expect(mergeLeaderboardRows([first], [duplicate, next]).map((row) => row.entry.rank)).toEqual([200, 201]);
  });

  it("uses an honest unavailable source label and distinguishes no snapshot", () => {
    expect(sourceForDisplay(null)).toBe("Source unavailable");
    expect(emptyLeaderboardCopy(false).title).toBe("No leaderboard snapshot yet");
    expect(emptyLeaderboardCopy(true).title).toBe("No exact entries match these filters");
  });
});
