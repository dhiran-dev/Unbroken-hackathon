import { describe, expect, it } from "vitest";

import {
  caffeineMetric,
  caloriesMetric,
  concentrationMetric,
  eligibilityLabel,
  servingMetric,
  sugarMetric,
} from "@/components/pulserank/compare/compare-model";
import type { PublicProductDto } from "@/server/products/dto";

function syntheticProduct(
  overrides: Partial<PublicProductDto> = {},
): PublicProductDto {
  return {
    caffeine: {
      max: null,
      mg: 80,
      min: null,
      qualifier: "exact",
      sourceLevel: "high",
      state: "present",
    },
    calories: { kcal: 110, state: "present" },
    category: "energy-drink",
    categoryProvenance: "source_pdp",
    concentration: { mgPer100Ml: 32 },
    image: null,
    name: "Synthetic test product",
    observedAt: "2026-08-20T12:00:00.000Z",
    rankingEligibility: {
      concentration: true,
      reasons: [],
      totalCaffeine: true,
    },
    serving: {
      form: "drink",
      normalizedMl: 250,
      state: "present",
      unit: "ml",
      value: 250,
    },
    slug: "synthetic-test-product",
    sourceAttribution: "Caffeine Informer",
    sourceUrl: "https://www.caffeineinformer.com/caffeine-content/test",
    sugar: { g: 27, state: "present" },
    ...overrides,
  };
}

describe("compare model", () => {
  it("keeps explicit zero caffeine and nutrition values visible", () => {
    const product = syntheticProduct({
      caffeine: {
        max: null,
        mg: 0,
        min: null,
        qualifier: "exact",
        sourceLevel: "low",
        state: "present",
      },
      calories: { kcal: 0, state: "present" },
      sugar: { g: 0, state: "present" },
    });

    expect(caffeineMetric(product)).toMatchObject({ primary: "0 mg", badge: "Exact" });
    expect(caloriesMetric(product)).toMatchObject({ primary: "0 kcal", badge: "Exact" });
    expect(sugarMetric(product)).toMatchObject({ primary: "0 g", badge: "Exact" });
  });

  it("never turns a conflicting caffeine state into a number", () => {
    const product = syntheticProduct({
      caffeine: {
        max: null,
        mg: null,
        min: null,
        qualifier: "unknown",
        sourceLevel: "unknown",
        state: "conflicting",
      },
      concentration: { mgPer100Ml: null },
      rankingEligibility: {
        concentration: false,
        reasons: ["caffeine_conflicting_excluded"],
        totalCaffeine: false,
      },
    });

    expect(caffeineMetric(product)).toEqual({
      primary: "—",
      badge: "Conflicting",
      tone: "warning",
    });
    expect(concentrationMetric(product)).toMatchObject({
      primary: "—",
      badge: "Not eligible",
      tone: "warning",
    });
    expect(eligibilityLabel(product).eligible).toBe(false);
  });

  it("preserves a caffeine range without collapsing it to a point", () => {
    const product = syntheticProduct({
      caffeine: {
        max: 120,
        mg: null,
        min: 80,
        qualifier: "range",
        sourceLevel: "high",
        state: "present",
      },
      concentration: { mgPer100Ml: null },
    });

    expect(caffeineMetric(product)).toEqual({
      primary: "80–120 mg",
      badge: "Range",
      tone: "warning",
    });
  });

  it("marks a malformed range unavailable instead of calling it observed", () => {
    const product = syntheticProduct({
      caffeine: {
        max: null,
        mg: null,
        min: 80,
        qualifier: "range",
        sourceLevel: "high",
        state: "present",
      },
    });

    expect(caffeineMetric(product)).toEqual({
      primary: "—",
      badge: "Range unavailable",
      tone: "warning",
    });
  });

  it("shows raw serving context beside normalized milliliters", () => {
    const product = syntheticProduct({
      serving: {
        form: "drink",
        normalizedMl: 355,
        state: "present",
        unit: "fl_oz",
        value: 12,
      },
    });

    expect(servingMetric(product)).toMatchObject({
      primary: "12 fl oz",
      secondary: "355 ml · Drink",
    });
  });

  it("labels unpublished fields instead of displaying zero", () => {
    const product = syntheticProduct({
      calories: { kcal: null, state: "not_published" },
      sugar: { g: null, state: "not_published" },
    });

    expect(caloriesMetric(product)).toMatchObject({
      primary: "—",
      badge: "Not published",
    });
    expect(sugarMetric(product)).toMatchObject({
      primary: "—",
      badge: "Not published",
    });
  });

  it("does not label present fields without values as observed", () => {
    const product = syntheticProduct({
      calories: { kcal: null, state: "present" },
      serving: { form: "drink", normalizedMl: null, state: "present", unit: "ml", value: null },
      sugar: { g: null, state: "present" },
    });

    expect(servingMetric(product)).toMatchObject({ primary: "—", badge: "Not published" });
    expect(caloriesMetric(product)).toMatchObject({ primary: "—", badge: "Not published" });
    expect(sugarMetric(product)).toMatchObject({ primary: "—", badge: "Not published" });
  });
});
