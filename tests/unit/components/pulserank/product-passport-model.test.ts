import { describe, expect, it } from "vitest";

import {
  caffeinePresentation,
  categoryProvenanceLabel,
  nutritionPresentation,
  saveEligibility,
  servingPresentation,
  sugarScale,
} from "@/components/pulserank/product-passport/product-passport-model";
import type { PublicCaffeineDto, PublicProductDto } from "@/server/products/dto";

function caffeine(overrides: Partial<PublicCaffeineDto> = {}): PublicCaffeineDto {
  return {
    mg: 240,
    min: null,
    max: null,
    qualifier: "exact",
    sourceLevel: "very_high",
    state: "present",
    ...overrides,
  };
}

describe("Product Passport measurement presentation", () => {
  it("distinguishes exact values from an explicit published zero", () => {
    expect(caffeinePresentation(caffeine())).toMatchObject({
      state: "exact",
      stateLabel: "Exact value",
      value: "240",
    });
    expect(caffeinePresentation(caffeine({ mg: 0 }))).toMatchObject({
      state: "explicit-zero",
      stateLabel: "Explicit zero",
      value: "0",
    });
  });

  it("preserves range bounds without inventing a midpoint", () => {
    expect(caffeinePresentation(caffeine({
      max: 90,
      mg: null,
      min: 70,
      qualifier: "range",
    }))).toEqual({
      state: "range",
      stateLabel: "Published range",
      value: "70–90",
      unit: "mg",
    });
  });

  it("renders conflicting, unparseable, and not-published states without numbers", () => {
    expect(caffeinePresentation(caffeine({ mg: null, state: "conflicting" }))).toMatchObject({
      state: "conflicting",
      value: "Conflicting",
    });
    expect(caffeinePresentation(caffeine({ mg: null, state: "unparseable" }))).toMatchObject({
      state: "unparseable",
      value: "Unparseable",
    });
    expect(caffeinePresentation(caffeine({ mg: null, state: "not_published" }))).toMatchObject({
      state: "not-published",
      value: "Not published",
    });
  });

  it("keeps estimated and approximate qualifiers visible", () => {
    expect(caffeinePresentation(caffeine({ mg: 100, qualifier: "estimated" }))).toMatchObject({
      state: "estimated",
      stateLabel: "Estimated value",
    });
    expect(caffeinePresentation(caffeine({ mg: 95, qualifier: "approximate" }))).toMatchObject({
      state: "approximate",
      value: "~95",
    });
    expect(caffeinePresentation(caffeine({ mg: 0, qualifier: "estimated" }))).toMatchObject({
      state: "estimated",
      value: "0",
    });
    expect(caffeinePresentation(caffeine({ mg: 0, qualifier: "approximate" }))).toMatchObject({
      state: "approximate",
      value: "~0",
    });
  });

  it("marks malformed ranges as unavailable without inventing a point", () => {
    expect(caffeinePresentation(caffeine({
      max: 70,
      mg: 80,
      min: 90,
      qualifier: "range",
    }))).toEqual({
      state: "range",
      stateLabel: "Range unavailable",
      value: "Range unavailable",
      unit: null,
    });
  });

  it("lets serving state override preserved numeric storage", () => {
    expect(servingPresentation({
      form: "drink",
      normalizedMl: 250,
      state: "unparseable",
      unit: "ml",
      value: 250,
    })).toEqual({
      normalizedValue: "Unparseable",
      stateLabel: "Unparseable",
      value: "Unparseable",
    });
  });

  it("keeps present-without-value serving data unpublished", () => {
    expect(servingPresentation({
      form: "drink",
      normalizedMl: 250,
      state: "present",
      unit: "ml",
      value: null,
    })).toEqual({
      normalizedValue: "Not normalized",
      stateLabel: "Not published",
      value: "Not published",
    });
  });

  it("scales a published sugar value to the next 20 gram division", () => {
    const result = sugarScale({ g: 81, state: "present" });
    expect(result.maximum).toBe(100);
    expect(result.fillPercent).toBe(81);
    expect(result.ticks).toEqual([0, 20, 40, 60, 80, 100]);
    expect(result.valueLabel).toBe("81 g");
  });

  it("shows no sugar fill for zero or unavailable states", () => {
    expect(sugarScale({ g: 0, state: "present" })).toMatchObject({
      fillPercent: 0,
      state: "explicit-zero",
      valueLabel: "0 g",
    });
    expect(sugarScale({ g: null, state: "not_published" })).toMatchObject({
      fillPercent: null,
      state: "not-published",
      valueLabel: "Not published",
    });
    expect(sugarScale(undefined)).toMatchObject({
      fillPercent: null,
      state: "unknown",
    });
  });

  it("distinguishes permission-omitted nutrition from source not-published", () => {
    expect(nutritionPresentation(undefined, " g")).toEqual({
      detail: "Not included in public view",
      state: "omitted",
      value: "Unavailable",
    });
    expect(nutritionPresentation({ state: "not_published", value: null }, " g")).toEqual({
      detail: "Not published",
      state: "not_published",
      value: "Not published",
    });
    expect(nutritionPresentation({ state: "present", value: 0 }, " g")).toEqual({
      detail: "Published",
      state: "present",
      value: "0 g",
    });
    expect(nutritionPresentation({ state: "present", value: null }, " kcal")).toEqual({
      detail: "Not published",
      state: "not_published",
      value: "Not published",
    });
  });

  it("uses the actual category provenance vocabulary", () => {
    expect(categoryProvenanceLabel("source_listing")).toBe("Source category list");
    expect(categoryProvenanceLabel("source_pdp")).toBe("Source product page");
    expect(categoryProvenanceLabel("legacy_broad")).toBe("Legacy catalog classification");
  });

  it("allows saving only usable public numeric states", () => {
    const product = {
      caffeine: caffeine(),
      serving: {
        form: "drink",
        normalizedMl: 709,
        state: "present",
        unit: "ml",
        value: 709,
      },
    } as PublicProductDto;

    expect(saveEligibility(product).eligible).toBe(true);
    expect(saveEligibility({
      ...product,
      caffeine: caffeine({ mg: 240, state: "conflicting" }),
    }).eligible).toBe(false);
    expect(saveEligibility({
      ...product,
      caffeine: caffeine({ max: 260, mg: null, min: 220, qualifier: "range" }),
    }).eligible).toBe(false);
    expect(saveEligibility({
      ...product,
      serving: { ...product.serving, state: "not_published", value: 709 },
    }).eligible).toBe(false);
  });
});
