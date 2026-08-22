/**
 * Mapping tests: Bright Data collector record → PulseRank V1 scrape row
 * (Agent A12).
 *
 * Runs against a COPY of the real post-heal artifact (tests/fixtures/judge/)
 * so the suite never depends on the artifacts directory being present.
 */

import { describe, expect, it } from "vitest";

import { productScrapeRowV1Schema } from "@/domain/product/contracts/product-scrape-row.schema";
import {
  checkUnitConsistency,
  JUDGE_COLLECTOR_ID,
  parseServingSize,
  slugFromCollectorUrl,
  toScrapeRow,
} from "@/server/judge/to-scrape-row";

import postHealRun from "../../../fixtures/judge/run-standard-post-heal.json";
import preHealRun from "../../../fixtures/judge/run-standard.json";

const OBSERVED_AT = "2026-08-21T10:00:00.000Z";

const postHealRecord = postHealRun[0]!;
const preHealRecord = preHealRun[0]!;

function mapPostHeal() {
  return toScrapeRow(postHealRecord, {
    observedAt: OBSERVED_AT,
    collectorId: JUDGE_COLLECTOR_ID,
    templateFamily: "caffeine-pdp",
  });
}

describe("toScrapeRow — post-heal record (72 mg)", () => {
  const row = mapPostHeal();

  it("maps identity and source from the collector envelope", () => {
    expect(row.schemaVersion).toBe("1.0");
    expect(row.source.sourceId).toBe("caffeine-informer");
    expect(row.source.url).toBe("https://www.caffeineinformer.com/caffeine-content/sting");
    expect(row.source.slug).toBe("sting");
    expect(row.source.observedAt).toBe(OBSERVED_AT);
    expect(row.source.pageFingerprint.startsWith("sha256:")).toBe(true);
    expect(row.identity.name).toBe("Sting Energy Drink");
    expect(row.identity.categoryLabel).toBe("Energy Drink");
    // The collector never publishes a page title — mapped as null, not invented.
    expect(row.identity.pageTitle).toBeNull();
  });

  it("maps the consistent caffeine figures as present + exact with both candidates", () => {
    const caffeine = row.primary.caffeineMg;
    expect(caffeine.state).toBe("present");
    expect(caffeine.value).toBe(72);
    expect(caffeine.qualifier).toBe("exact");
    expect(caffeine.candidates).toEqual([72, 71.975]); // published + implied
    expect(row.primary.sourceLevel).toBe("moderate"); // "MODERATE" normalized
  });

  it("maps the published serving", () => {
    const serving = row.primary.serving;
    expect(serving.state).toBe("present");
    expect(serving.value).toBe(250);
    expect(serving.unit).toBe("ml");
    expect(serving.form).toBe("drink");
    expect(serving.normalizedMl).toBe(250);
    expect(serving.rawText).toBe("250 ml");
  });

  it("marks fields the collector never publishes as not_published", () => {
    expect(row.primary.caloriesKcal).toMatchObject({
      state: "not_published",
      value: null,
      candidates: [],
    });
    expect(row.primary.sugarG.state).toBe("not_published");
    expect(row.ingredients).toEqual({ state: "not_published", text: null, appliesTo: null });
    expect(row.variants).toEqual([]);
    expect(row.flavours).toEqual([]);
    // Media is audit-only per the source publication policy.
    expect(row.media).toEqual({ imageUrl: null, publicationState: "audit_only" });
  });

  it("records the real extraction provenance", () => {
    expect(row.extraction.collectorId).toBe("c_mt33nlnkq376z132b");
    expect(row.extraction.templateFamily).toBe("caffeine-pdp");
    expect(row.extraction.parserVersion.length).toBeGreaterThan(0);
  });

  it("passes the production zod contract", () => {
    const parsed = productScrapeRowV1Schema.safeParse(row);
    expect(parsed.success).toBe(true);
  });

  it("computes no conflict warnings when the figures agree", () => {
    expect(row.evidence.warnings).toEqual([]);
  });
});

describe("toScrapeRow — source-backed category evidence", () => {
  it("uses listing evidence without modifying or name-classifying the provider row", () => {
    const providerRecord = structuredClone(postHealRecord);
    const before = structuredClone(providerRecord);

    const row = toScrapeRow(providerRecord, {
      observedAt: OBSERVED_AT,
      taxonomyEntry: {
        sourceCode: "ED",
        category: "energy-drink",
        listingUrl: "https://www.caffeineinformer.com/the-caffeine-database",
      },
    });

    expect(providerRecord).toEqual(before);
    expect(row.identity.categoryLabel).toBe("energy-drink");
    expect(row.identity.categoryProvenance).toBe("source_listing");
    expect(row.evidence.sourceLinks).toContain(
      "https://www.caffeineinformer.com/the-caffeine-database",
    );
    expect(productScrapeRowV1Schema.parse(row).identity.categoryProvenance).toBe(
      "source_listing",
    );
  });
});

describe("toScrapeRow — pre-heal record (72250 unit bug)", () => {
  const row = toScrapeRow(preHealRecord, { observedAt: OBSERVED_AT });

  it("maps the contradicting figures as conflicting with candidates retained", () => {
    const caffeine = row.primary.caffeineMg;
    expect(caffeine.state).toBe("conflicting");
    expect(caffeine.value).toBeNull();
    expect(caffeine.qualifier).toBe("unknown");
    expect(caffeine.candidates).toEqual([72250, 71.975]);
  });

  it("carries a computed warning naming the disagreement", () => {
    expect(row.evidence.warnings).toHaveLength(1);
    expect(row.evidence.warnings[0]).toContain("72250");
    expect(row.evidence.warnings[0]).toContain("71.975");
  });

  it("still passes the zod contract (the contract checks shape, not plausibility)", () => {
    expect(productScrapeRowV1Schema.safeParse(row).success).toBe(true);
  });
});

describe("checkUnitConsistency", () => {
  it("flags the ~1000x unit bug", () => {
    const check = checkUnitConsistency(preHealRecord, 250);
    expect(check.perServingMg).toBe(72250);
    expect(check.impliedPerServingMg).toBe(71.975);
    expect(check.consistent).toBe(false);
  });

  it("accepts the healed pair within rounding tolerance", () => {
    const check = checkUnitConsistency(postHealRecord, 250);
    expect(check.perServingMg).toBe(72);
    expect(check.impliedPerServingMg).toBe(71.975);
    expect(check.consistent).toBe(true);
  });

  it("returns null (not false) when a second figure is unavailable", () => {
    const check = checkUnitConsistency({ caffeine_mg_per_serving: 72 }, 250);
    expect(check.consistent).toBeNull();
  });
});

describe("small honest parsers", () => {
  it("parses volume and container servings", () => {
    expect(parseServingSize("250 ml")).toMatchObject({ value: 250, unit: "ml" });
    expect(parseServingSize("8.4 fl oz")).toMatchObject({ value: 8.4, unit: "fl_oz" });
    expect(parseServingSize("16 oz")).toMatchObject({ value: 16, unit: "oz" });
    // Item-style text without a number is not a parseable serving.
    expect(parseServingSize("per mint")).toBeNull();
  });

  it("rejects non-numeric or unitless serving text", () => {
    expect(parseServingSize("unknown")).toBeNull();
    expect(parseServingSize(null)).toBeNull();
    expect(parseServingSize(42)).toBeNull();
  });

  it("derives slugs from collector URLs with safe fallbacks", () => {
    expect(slugFromCollectorUrl("https://www.caffeineinformer.com/caffeine-content/sting")).toBe(
      "sting",
    );
    expect(slugFromCollectorUrl("https://www.caffeineinformer.com")).toBe(
      "www.caffeineinformer.com",
    );
    expect(slugFromCollectorUrl("not a url")).toBe("unknown");
    expect(slugFromCollectorUrl(undefined)).toBe("unknown");
  });
});
