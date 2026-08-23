import { describe, expect, it } from "vitest";

import {
  appendUniqueProducts,
  exploreVolumeAxisTicks,
  exploreVolumePosition,
  isExactPlotProduct,
  niceAxisMaximum,
  toExplorePlotPoint,
} from "@/components/pulserank/explore/explore-model";
import type { PublicProductDto } from "@/server/products/dto";

function product(
  slug: string,
  overrides: Partial<PublicProductDto> = {},
): PublicProductDto {
  return {
    slug,
    name: slug,
    category: "energy-drink",
    categoryProvenance: "source_listing",
    caffeine: {
      mg: 80,
      min: null,
      max: null,
      qualifier: "exact",
      state: "present",
      sourceLevel: "moderate",
    },
    serving: {
      value: 8.4,
      normalizedMl: 248.4,
      unit: "fl_oz",
      form: "drink",
      state: "present",
    },
    concentration: { mgPer100Ml: 32.2 },
    observedAt: "2026-08-22T00:00:00.000Z",
    rankingEligibility: {
      totalCaffeine: true,
      concentration: true,
      reasons: [],
    },
    image: null,
    sourceAttribution: "Caffeine Informer",
    sourceUrl: `https://www.caffeineinformer.com/caffeine-content/${slug}`,
    ...overrides,
  };
}

describe("Explore exact-value plot model", () => {
  it("plots against normalized milliliters rather than the source serving number", () => {
    const point = toExplorePlotPoint(product("red-bull"), "total");
    expect(point).toEqual({ xMl: 248.4, yValue: 80 });
  });

  it("excludes ranges even when they have numeric bounds", () => {
    const ranged = product("range", {
      caffeine: {
        mg: null,
        min: 70,
        max: 90,
        qualifier: "range",
        state: "present",
        sourceLevel: "moderate",
      },
    });
    expect(isExactPlotProduct(ranged, "total")).toBe(false);
    expect(toExplorePlotPoint(ranged, "total")).toBeNull();
  });

  it("excludes source servings that cannot be normalized to a positive volume", () => {
    const perItem = product("per-item", {
      serving: {
        value: 1,
        normalizedMl: null,
        unit: "item",
        form: "item",
        state: "present",
      },
    });
    expect(isExactPlotProduct(perItem, "total")).toBe(false);
  });

  it("uses the published concentration value only on concentration plots", () => {
    const exact = product("exact");
    expect(toExplorePlotPoint(exact, "concentration")).toEqual({
      xMl: 248.4,
      yValue: 32.2,
    });
    expect(
      isExactPlotProduct(
        product("ineligible", { concentration: { mgPer100Ml: null } }),
        "concentration",
      ),
    ).toBe(false);
  });

  it("rounds plot maxima up to stable readable buckets", () => {
    expect(niceAxisMaximum(0)).toBe(1);
    expect(niceAxisMaximum(114)).toBe(200);
    expect(niceAxisMaximum(501)).toBe(1000);
  });

  it("spreads typical servings across a logarithmic axis without hiding outliers", () => {
    expect(exploreVolumePosition(0, 20_000)).toBe(0);
    expect(exploreVolumePosition(250, 20_000)).toBeGreaterThan(0.5);
    expect(exploreVolumePosition(20_000, 20_000)).toBe(1);
    expect(exploreVolumeAxisTicks(20_000)).toEqual([0, 250, 1_000, 5_000, 20_000]);
  });

  it("defensively removes replayed products while preserving cursor order", () => {
    const first = product("a");
    const replay = product("a", { name: "replayed" });
    const second = product("b");
    expect(appendUniqueProducts([first], [replay, second])).toEqual([first, second]);
  });
});
