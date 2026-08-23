import { describe, expect, it } from "vitest";

import {
  caffeinePresentation,
  categoryProvenanceLabel,
  sugarScale,
} from "@/components/pulserank/product-passport/product-passport-model";
import type { PublicCaffeineDto } from "@/server/products/dto";

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

  it("uses the actual category provenance vocabulary", () => {
    expect(categoryProvenanceLabel("source_listing")).toBe("Source category list");
    expect(categoryProvenanceLabel("source_pdp")).toBe("Source product page");
    expect(categoryProvenanceLabel("legacy_broad")).toBe("Legacy catalog classification");
  });
});
