/**
 * Unit tests for deterministic normalization (Agent A5).
 *
 * Covers every fixture class plus inline minimal cases for the canonical
 * category mapping and the concentration-only-when-exact+ml rule.
 */

import { describe, expect, it } from "vitest";

import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";

import conflictingVariant from "@/domain/product/fixtures/conflicting-variant.json";
import estimatedCaffeine from "@/domain/product/fixtures/estimated-caffeine.json";
import explicitZeroCaffeine from "@/domain/product/fixtures/explicit-zero-caffeine.json";
import explicitZeroSugar from "@/domain/product/fixtures/explicit-zero-sugar.json";
import multiVariant from "@/domain/product/fixtures/multi-variant.json";
import perItemMint from "@/domain/product/fixtures/per-item-mint.json";
import rangeCaffeine from "@/domain/product/fixtures/range-caffeine.json";
import standardFull from "@/domain/product/fixtures/standard-full.json";
import standardSparse from "@/domain/product/fixtures/standard-sparse.json";

import {
  computeConcentration,
  normalizeCategoryLabel,
  normalizeRow,
} from "@/server/ingestion/normalize";

function clone(row: ProductScrapeRowV1): ProductScrapeRowV1 {
  return structuredClone(row);
}

/** JSON imports widen literals; the contract suite proves these are valid rows. */
function asRow(row: unknown): ProductScrapeRowV1 {
  return row as ProductScrapeRowV1;
}

const rows = {
  standardFull: asRow(standardFull),
  standardSparse: asRow(standardSparse),
  explicitZeroCaffeine: asRow(explicitZeroCaffeine),
  explicitZeroSugar: asRow(explicitZeroSugar),
  perItemMint: asRow(perItemMint),
  rangeCaffeine: asRow(rangeCaffeine),
  estimatedCaffeine: asRow(estimatedCaffeine),
  multiVariant: asRow(multiVariant),
  conflictingVariant: asRow(conflictingVariant),
};

describe("normalizeCategoryLabel — canonical category mapping", () => {
  it("maps the canonical set in rule order", () => {
    expect(normalizeCategoryLabel("Energy Drinks")).toBe("energy-drink");
    expect(normalizeCategoryLabel("Energy Shots")).toBe("energy-shot");
    expect(normalizeCategoryLabel("Coffee")).toBe("coffee");
    expect(normalizeCategoryLabel("Iced Tea")).toBe("tea");
    expect(normalizeCategoryLabel("Soda")).toBe("soda");
    expect(normalizeCategoryLabel("Sparkling Water")).toBe("water");
    expect(normalizeCategoryLabel("Caffeinated Gum")).toBe("gum");
    expect(normalizeCategoryLabel("Caffeine Candies & Mints")).toBe("food");
  });

  it("falls through to other for null, empty, and unmatched labels", () => {
    expect(normalizeCategoryLabel(null)).toBe("other");
    expect(normalizeCategoryLabel("")).toBe("other");
    expect(normalizeCategoryLabel("   ")).toBe("other");
    expect(normalizeCategoryLabel("Mystery Elixir")).toBe("other");
  });
});

describe("normalizeRow — full fixtures", () => {
  it("normalizes the standard-full fixture (Red Bull)", () => {
    const candidate = normalizeRow(rows.standardFull);

    expect(candidate.schemaVersion).toBe("1.0");
    expect(candidate.identity).toEqual({
      sourceId: "caffeine-informer",
      slug: "red-bull",
    });
    expect(candidate.name).toBe("Red Bull");
    expect(candidate.category).toBe("energy-drink");
    expect(candidate.categoryLabel).toBe("Energy Drinks");

    expect(candidate.caffeineMg).toMatchObject({
      field: "caffeine_mg",
      unit: "mg",
      state: "present",
      value: 80,
      qualifier: "exact",
      rankable: true,
      exactRankable: true,
    });
    expect(candidate.serving.normalizedMl).toBe(250);
    // 80 mg / 250 ml * 100 = 32.0 mg per 100 ml.
    expect(candidate.concentration).toEqual({
      mgPer100Ml: 32,
      basis: "computed",
    });
    expect(candidate.variants).toHaveLength(1);
    expect(candidate.flavours).toHaveLength(1);
    expect(candidate.media).toEqual({
      imageUrl: "https://www.caffeineinformer.com/images/content/red-bull-can.jpg",
      publicationState: "allowed",
    });
  });

  it("keeps sparse fields as valid data (standard-sparse)", () => {
    const candidate = normalizeRow(rows.standardSparse);

    expect(candidate.category).toBe("other"); // null label -> other
    expect(candidate.caloriesKcal).toMatchObject({
      state: "not_published",
      value: null,
      rankable: false,
      exactRankable: false,
    });
    expect(candidate.sugarG).toMatchObject({
      state: "unparseable",
      value: null,
      rankable: false,
    });
    // Serving not published -> no concentration even though caffeine is exact.
    expect(candidate.serving.state).toBe("not_published");
    expect(candidate.concentration).toEqual({
      mgPer100Ml: null,
      basis: "no_normalized_ml",
    });
  });

  it("treats an explicit zero as exact rankable data (explicit-zero-caffeine)", () => {
    const candidate = normalizeRow(rows.explicitZeroCaffeine);

    expect(candidate.caffeineMg).toMatchObject({
      state: "present",
      value: 0,
      qualifier: "exact",
      rankable: true,
      exactRankable: true,
    });
    expect(candidate.concentration).toEqual({
      mgPer100Ml: 0,
      basis: "computed",
    });
  });

  it("treats an explicit zero sugar as data (explicit-zero-sugar)", () => {
    const candidate = normalizeRow(rows.explicitZeroSugar);

    expect(candidate.sugarG).toMatchObject({
      state: "present",
      value: 0,
      rankable: true,
      exactRankable: true,
    });
  });

  it("never computes concentration for per-item servings (per-item-mint)", () => {
    const candidate = normalizeRow(rows.perItemMint);

    expect(candidate.serving).toMatchObject({
      unit: "mint",
      normalizedMl: null,
    });
    expect(candidate.concentration).toEqual({
      mgPer100Ml: null,
      basis: "no_normalized_ml",
    });
  });

  it("keeps ranges displayable but not exact-rankable (range-caffeine)", () => {
    const candidate = normalizeRow(rows.rangeCaffeine);

    expect(candidate.caffeineMg).toMatchObject({
      state: "present",
      value: null,
      min: 95,
      max: 200,
      qualifier: "range",
      rankable: true,
      exactRankable: false,
    });
    expect(candidate.concentration).toEqual({
      mgPer100Ml: null,
      basis: "no_exact_caffeine",
    });
  });

  it("never treats estimates as exact values (estimated-caffeine)", () => {
    const candidate = normalizeRow(rows.estimatedCaffeine);

    expect(candidate.caffeineMg).toMatchObject({
      state: "present",
      value: 95,
      qualifier: "estimated",
      rankable: true,
      exactRankable: false,
    });
    expect(candidate.concentration).toEqual({
      mgPer100Ml: null,
      basis: "no_exact_caffeine",
    });
  });

  it("normalizes every variant with its own metrics (multi-variant)", () => {
    const candidate = normalizeRow(rows.multiVariant);

    expect(candidate.variants.map((v) => v.availability)).toEqual([
      "listed",
      "appears_inactive",
      "explicitly_discontinued",
    ]);
    for (const variant of candidate.variants) {
      expect(variant.caffeineMg.rankable).toBe(true);
      expect(variant.serving).toBeDefined();
    }
  });

  it("excludes conflicting metrics from ranking but keeps evidence (conflicting-variant)", () => {
    const candidate = normalizeRow(rows.conflictingVariant);

    expect(candidate.caffeineMg).toMatchObject({
      state: "conflicting",
      value: null,
      rankable: false,
      exactRankable: false,
    });
    expect(candidate.caffeineMg.rawText).toBeTruthy();
    expect(candidate.concentration).toEqual({
      mgPer100Ml: null,
      basis: "no_exact_caffeine",
    });
  });
});

describe("normalizeRow — determinism and identity", () => {
  it("is a pure function: same row in, deep-equal candidate out", () => {
    const a = normalizeRow(rows.multiVariant);
    const b = normalizeRow(rows.multiVariant);
    expect(a).toEqual(b);
  });

  it("does not mutate its input", () => {
    const row = clone(rows.standardFull);
    const before = JSON.stringify(row);
    normalizeRow(row);
    expect(JSON.stringify(row)).toBe(before);
  });

  it("preserves slug identity and never rewrites it", () => {
    for (const row of Object.values(rows)) {
      const candidate = normalizeRow(row);
      expect(candidate.identity.slug).toBe(row.source.slug);
      expect(candidate.identity.sourceId).toBe(row.source.sourceId);
    }
  });
});

describe("computeConcentration — exact + positive ml only", () => {
  const exactCaffeine = normalizeRow(rows.standardFull).caffeineMg;
  const zeroCaffeine = normalizeRow(rows.explicitZeroCaffeine).caffeineMg;
  const rangeCaffeineField = normalizeRow(rows.rangeCaffeine).caffeineMg;
  const serving250ml = normalizeRow(rows.standardFull).serving;

  it("computes for exact caffeine and positive ml", () => {
    expect(computeConcentration(exactCaffeine, serving250ml)).toEqual({
      mgPer100Ml: 32,
      basis: "computed",
    });
  });

  it("rounds to one decimal deterministically", () => {
    // 72 mg / 355 ml * 100 = 20.2817... -> 20.3
    const result = computeConcentration(
      normalizeRow(rows.standardSparse).caffeineMg,
      normalizeRow(rows.explicitZeroCaffeine).serving,
    );
    expect(result).toEqual({ mgPer100Ml: 20.3, basis: "computed" });
  });

  it("returns 0 for an explicit zero (not missing)", () => {
    expect(computeConcentration(zeroCaffeine, serving250ml)).toEqual({
      mgPer100Ml: 0,
      basis: "computed",
    });
  });

  it("refuses non-exact caffeine", () => {
    expect(computeConcentration(rangeCaffeineField, serving250ml)).toEqual({
      mgPer100Ml: null,
      basis: "no_exact_caffeine",
    });
  });

  it("refuses non-positive serving volumes", () => {
    const badServing = { ...serving250ml, normalizedMl: 0 };
    expect(computeConcentration(exactCaffeine, badServing)).toEqual({
      mgPer100Ml: null,
      basis: "non_positive_serving_ml",
    });
  });
});
