/**
 * Contract tests for the PROVISIONAL PulseRank V1 product scrape row.
 *
 * Every positive fixture under src/domain/product/fixtures/ must parse against
 * productScrapeRowV1Schema; the two negative fixtures must be rejected for the
 * specific reason their name describes. Fixture classes follow
 * docs/plans/pulserank-master-implementation-plan.md §8.6.
 */

import { describe, expect, it } from "vitest";

import { productScrapeRowV1Schema } from "@/domain/product/contracts/product-scrape-row.schema";

import conflictingVariant from "@/domain/product/fixtures/conflicting-variant.json";
import estimatedCaffeine from "@/domain/product/fixtures/estimated-caffeine.json";
import explicitZeroCaffeine from "@/domain/product/fixtures/explicit-zero-caffeine.json";
import explicitZeroSugar from "@/domain/product/fixtures/explicit-zero-sugar.json";
import invalidNegative from "@/domain/product/fixtures/invalid-negative.json";
import multiVariant from "@/domain/product/fixtures/multi-variant.json";
import perItemMint from "@/domain/product/fixtures/per-item-mint.json";
import rangeCaffeine from "@/domain/product/fixtures/range-caffeine.json";
import standardFull from "@/domain/product/fixtures/standard-full.json";
import standardSparse from "@/domain/product/fixtures/standard-sparse.json";
import wrongHost from "@/domain/product/fixtures/wrong-host.json";

const validFixtures = [
  ["standard-full.json", standardFull],
  ["standard-sparse.json", standardSparse],
  ["explicit-zero-caffeine.json", explicitZeroCaffeine],
  ["explicit-zero-sugar.json", explicitZeroSugar],
  ["per-item-mint.json", perItemMint],
  ["range-caffeine.json", rangeCaffeine],
  ["estimated-caffeine.json", estimatedCaffeine],
  ["multi-variant.json", multiVariant],
  ["conflicting-variant.json", conflictingVariant],
] as const;

describe("ProductScrapeRowV1 contract (PROVISIONAL v1.0)", () => {
  describe("valid fixtures parse", () => {
    it.each(validFixtures)("%s validates against the V1 schema", (_name, row) => {
      const result = productScrapeRowV1Schema.safeParse(row);
      if (!result.success) {
        throw new Error(
          `fixture failed validation: ${JSON.stringify(result.error.issues, null, 2)}`,
        );
      }
      expect(result.success).toBe(true);
    });
  });

  describe("semantic guarantees encoded by the fixtures", () => {
    it("keeps explicit zero caffeine distinct from missing (zero != missing)", () => {
      expect(explicitZeroCaffeine.primary.caffeineMg).toMatchObject({
        state: "present",
        value: 0,
        qualifier: "exact",
      });
      expect(explicitZeroCaffeine.primary.sourceLevel).toBe("caffeine_free");
    });

    it("keeps explicit zero sugar distinct from missing (zero != missing)", () => {
      expect(explicitZeroSugar.primary.sugarG).toMatchObject({
        state: "present",
        value: 0,
        qualifier: "exact",
      });
    });

    it("preserves per-item units instead of forcing a volume conversion", () => {
      expect(perItemMint.primary.serving).toMatchObject({
        state: "present",
        value: 1,
        unit: "mint",
        form: "item",
        normalizedMl: null,
      });
    });

    it("keeps range qualifiers explicit with min/max and no invented point value", () => {
      expect(rangeCaffeine.primary.caffeineMg).toMatchObject({
        state: "present",
        value: null,
        min: 95,
        max: 200,
        qualifier: "range",
      });
    });

    it("keeps estimated qualifiers explicit", () => {
      expect(estimatedCaffeine.primary.caffeineMg.qualifier).toBe("estimated");
    });

    it("keeps conflicts unranked: state conflicting, no single value chosen", () => {
      expect(conflictingVariant.primary.caffeineMg).toMatchObject({
        state: "conflicting",
        value: null,
      });
      expect(conflictingVariant.primary.caffeineMg.candidates).toHaveLength(2);
      expect(conflictingVariant.evidence.warnings.length).toBeGreaterThan(0);
    });
  });

  describe("invalid fixtures are rejected", () => {
    it("invalid-negative.json fails: negative caffeine mg is never valid data", () => {
      const result = productScrapeRowV1Schema.safeParse(invalidNegative);
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((issue) => issue.path.join("."));
        expect(paths.some((path) => path.includes("caffeineMg"))).toBe(true);
      }
    });

    it("wrong-host.json fails: source.url must point at caffeineinformer.com", () => {
      const result = productScrapeRowV1Schema.safeParse(wrongHost);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((issue) => issue.message);
        expect(messages.some((message) => message.includes("caffeineinformer.com"))).toBe(true);
      }
    });
  });
});
