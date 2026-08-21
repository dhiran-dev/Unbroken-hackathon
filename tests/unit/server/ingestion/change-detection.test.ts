/**
 * Unit tests for trusted-to-trusted change detection (Agent A5).
 *
 * Covers all 13 event types, the trusted-to-trusted gate (no events unless
 * both records exist), the exact event shape {type, field?, before, after,
 * observedAt}, and determinism. Timestamps are always parameters — the suite
 * itself would catch any clock read because events must echo the passed
 * observedAt exactly.
 */

import { describe, expect, it } from "vitest";

import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";

import multiVariant from "@/domain/product/fixtures/multi-variant.json";
import standardFull from "@/domain/product/fixtures/standard-full.json";

import { normalizeRow } from "@/server/ingestion/normalize";
import {
  CHANGE_EVENT_TYPES,
  diffTrustedRecords,
} from "@/server/ingestion/change-detection";
import { promoteCandidate } from "@/server/ingestion/promote";
import type { TrustedProductRecord } from "@/server/ingestion/promote";

const T1 = "2026-08-21T09:00:00Z";

function asRow(row: unknown): ProductScrapeRowV1 {
  return row as ProductScrapeRowV1;
}

function recordOf(fixture: unknown): TrustedProductRecord {
  return promoteCandidate(normalizeRow(asRow(fixture))).record;
}

const prev = recordOf(standardFull);

function nextWith(
  mutate: (row: ProductScrapeRowV1) => void,
): TrustedProductRecord {
  const row = structuredClone(asRow(standardFull));
  mutate(row);
  return promoteCandidate(normalizeRow(row)).record;
}

function types(events: ReturnType<typeof diffTrustedRecords>): string[] {
  return events.map((e) => e.type);
}

describe("diffTrustedRecords — trusted-to-trusted gate", () => {
  it("emits nothing for a first observation (null previous)", () => {
    expect(diffTrustedRecords(null, prev, T1)).toEqual([]);
  });

  it("emits nothing when nothing new was trusted (null next)", () => {
    expect(diffTrustedRecords(prev, null, T1)).toEqual([]);
  });

  it("emits nothing for identical records", () => {
    expect(diffTrustedRecords(prev, structuredClone(prev), T1)).toEqual([]);
  });

  it("refuses to diff across different products", () => {
    const other = structuredClone(prev);
    other.slug = "monster-energy";
    expect(diffTrustedRecords(prev, other, T1)).toEqual([]);
  });
});

describe("diffTrustedRecords — metric changes", () => {
  it("emits caffeine_changed with before/after points and observedAt", () => {
    const next = nextWith((row) => {
      row.primary.caffeineMg.value = 160;
    });
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events)).toEqual(["caffeine_changed"]);
    const event = events[0];
    expect(event).toMatchObject({
      type: "caffeine_changed",
      field: "caffeine_mg",
      observedAt: T1,
    });
    expect(event?.before).toEqual({ value: 80, qualifier: "exact", unit: "mg" });
    expect(event?.after).toEqual({ value: 160, qualifier: "exact", unit: "mg" });
  });

  it("echoes the observedAt parameter verbatim (never a clock)", () => {
    const next = nextWith((row) => {
      row.primary.caffeineMg.value = 114;
    });
    const events = diffTrustedRecords(prev, next, "2027-01-01T00:00:00Z");
    for (const event of events) {
      expect(event.observedAt).toBe("2027-01-01T00:00:00Z");
    }
  });

  it("emits calories_changed and sugar_changed independently", () => {
    const next = nextWith((row) => {
      row.primary.caloriesKcal.value = 42;
      row.primary.sugarG.value = 1;
    });
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events).sort()).toEqual(["calories_changed", "sugar_changed"]);
    const calories = events.find((e) => e.type === "calories_changed");
    expect(calories?.before?.value).toBe(110);
    expect(calories?.after?.value).toBe(42);
    expect(calories?.after?.unit).toBe("kcal");
    const sugar = events.find((e) => e.type === "sugar_changed");
    expect(sugar?.before?.value).toBe(27);
    expect(sugar?.after?.unit).toBe("g");
  });

  it("emits serving_changed when the serving moves", () => {
    const next = nextWith((row) => {
      row.primary.serving.value = 355;
      row.primary.serving.normalizedMl = 355;
    });
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events)).toEqual(["serving_changed"]);
    expect(events[0]?.field).toBe("serving");
    expect(events[0]?.before).toEqual({ value: 250, qualifier: null, unit: "ml" });
    expect(events[0]?.after).toEqual({ value: 355, qualifier: null, unit: "ml" });
  });

  it("emits caffeine_changed on a qualifier-only change (exact -> estimated)", () => {
    const next = nextWith((row) => {
      row.primary.caffeineMg.qualifier = "estimated";
    });
    const events = diffTrustedRecords(prev, next, T1);
    expect(types(events)).toEqual(["caffeine_changed"]);
    expect(events[0]?.before?.qualifier).toBe("exact");
    expect(events[0]?.after?.qualifier).toBe("estimated");
  });

  it("emits source_level_changed", () => {
    const next = nextWith((row) => {
      row.primary.sourceLevel = "high";
    });
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events)).toEqual(["source_level_changed"]);
    expect(events[0]?.before).toEqual({
      value: "moderate",
      qualifier: null,
      unit: null,
    });
    expect(events[0]?.after).toEqual({ value: "high", qualifier: null, unit: null });
  });
});

describe("diffTrustedRecords — conflict transitions", () => {
  it("emits conflict_introduced when a trusted metric turns conflicting", () => {
    const next = nextWith((row) => {
      row.primary.caffeineMg = {
        state: "conflicting",
        value: null,
        min: null,
        max: null,
        qualifier: "unknown",
        rawText: "80 mg or 114 mg?",
        candidates: [80, 114],
      };
    });
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events)).toEqual(["conflict_introduced"]);
    expect(events[0]?.field).toBe("caffeine_mg");
    expect(events[0]?.before?.value).toBe(80);
    expect(events[0]?.after?.value).toBeNull();
  });

  it("emits conflict_resolved when a conflict becomes a trusted value", () => {
    const conflicted = nextWith((row) => {
      row.primary.caffeineMg = {
        state: "conflicting",
        value: null,
        min: null,
        max: null,
        qualifier: "unknown",
        rawText: "80 mg or 114 mg?",
        candidates: [80, 114],
      };
    });
    const events = diffTrustedRecords(conflicted, prev, T1);

    expect(types(events)).toEqual(["conflict_resolved"]);
    const event = events[0];
    expect(event?.field).toBe("caffeine_mg");
    expect(event?.before?.value).toBeNull(); // conflicting side carries no value
    expect(event?.after?.value).toBe(80); // resolved trusted value
    expect(event?.after?.qualifier).toBe("exact");
  });

  it("stays silent while a metric remains conflicting", () => {
    const conflictedA = nextWith((row) => {
      row.primary.caffeineMg.state = "conflicting";
    });
    const conflictedB = nextWith((row) => {
      row.primary.caffeineMg.state = "conflicting";
      row.primary.caffeineMg.rawText = "different evidence";
    });
    expect(diffTrustedRecords(conflictedA, conflictedB, T1)).toEqual([]);
  });
});

describe("diffTrustedRecords — variants and flavours", () => {
  it("emits variant_added for new variant names", () => {
    const row = structuredClone(asRow(standardFull));
    row.variants.push({
      name: "Red Bull Red Edition",
      caffeineMg: structuredClone(row.primary.caffeineMg),
      serving: structuredClone(row.primary.serving),
      caloriesKcal: structuredClone(row.primary.caloriesKcal),
      sugarG: structuredClone(row.primary.sugarG),
      region: null,
      availability: "listed",
      rawText: null,
    });
    const next = promoteCandidate(normalizeRow(row)).record;
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events)).toEqual(["variant_added"]);
    const added = events[0];
    expect(added?.field).toBe("variants");
    expect(added?.before).toBeNull();
    expect(added?.after?.value).toBe("Red Bull Red Edition");
  });

  it("emits variant_changed with a dotted entity path per changed metric", () => {
    const start = recordOf(multiVariant);
    const row = structuredClone(asRow(multiVariant));
    row.variants[0]!.caffeineMg.value = 999;
    const changed = promoteCandidate(normalizeRow(row)).record;

    const events = diffTrustedRecords(start, changed, T1);
    expect(types(events)).toEqual(["variant_changed"]);
    expect(events[0]?.field).toBe("variant:Monster Energy Original.caffeine_mg");
    expect(events[0]?.before?.value).toBe(160);
    expect(events[0]?.after?.value).toBe(999);
  });

  it("emits variant_changed when availability changes", () => {
    const start = recordOf(multiVariant);
    const row = structuredClone(asRow(multiVariant));
    row.variants[0]!.availability = "appears_inactive";
    const changed = promoteCandidate(normalizeRow(row)).record;

    const events = diffTrustedRecords(start, changed, T1);
    expect(types(events)).toEqual(["variant_changed"]);
    expect(events[0]?.field).toBe("variant:Monster Energy Original.availability");
    expect(events[0]?.before?.value).toBe("listed");
    expect(events[0]?.after?.value).toBe("appears_inactive");
  });

  it("emits flavour_added for new flavour names", () => {
    const row = structuredClone(asRow(standardFull));
    row.flavours.push({
      name: "Tropical",
      availability: "listed",
      caffeineRelation: "same_as_primary",
      caffeineMg: structuredClone(row.flavours[0]!.caffeineMg),
      serving: structuredClone(row.flavours[0]!.serving),
      evidence: "normal_text",
      rawText: null,
    });
    const next = promoteCandidate(normalizeRow(row)).record;

    const events = diffTrustedRecords(prev, next, T1);
    expect(types(events)).toEqual(["flavour_added"]);
    expect(events[0]?.after?.value).toBe("Tropical");
  });

  it("emits flavour_state_changed when flavour availability flips", () => {
    const row = structuredClone(asRow(standardFull));
    row.flavours[0]!.availability = "explicitly_discontinued";
    const next = promoteCandidate(normalizeRow(row)).record;

    const events = diffTrustedRecords(prev, next, T1);
    expect(types(events)).toEqual(["flavour_state_changed"]);
    expect(events[0]?.field).toBe("flavour:Original");
    expect(events[0]?.before?.value).toBe("listed");
    expect(events[0]?.after?.value).toBe("explicitly_discontinued");
  });
});

describe("diffTrustedRecords — record-level events", () => {
  it("emits product_renamed", () => {
    const next = nextWith((row) => {
      row.identity.name = "Red Bull Energy Drink";
    });
    const events = diffTrustedRecords(prev, next, T1);

    expect(types(events)).toEqual(["product_renamed"]);
    expect(events[0]?.field).toBe("name");
    expect(events[0]?.before?.value).toBe("Red Bull");
    expect(events[0]?.after?.value).toBe("Red Bull Energy Drink");
  });

  it("emits page_missing exactly when the source goes active -> missing", () => {
    const missing = structuredClone(prev);
    missing.sourceStatus = "missing";
    const events = diffTrustedRecords(prev, missing, T1);

    expect(types(events)).toEqual(["page_missing"]);
    expect(events[0]?.before?.value).toBe("active");
    expect(events[0]?.after?.value).toBe("missing");

    // Recovery is not page_missing; staying missing is not an event either.
    expect(diffTrustedRecords(missing, prev, T1)).toEqual([]);
    expect(diffTrustedRecords(missing, structuredClone(missing), T1)).toEqual([]);
  });

  it("combines multiple simultaneous changes in a fixed deterministic order", () => {
    const row = structuredClone(asRow(standardFull));
    row.identity.name = "Red Bull Red Edition";
    row.primary.caffeineMg.value = 114;
    row.primary.sourceLevel = "high";
    row.variants.push({
      name: "Red Bull Blue Edition",
      caffeineMg: structuredClone(row.primary.caffeineMg),
      serving: structuredClone(row.primary.serving),
      caloriesKcal: structuredClone(row.primary.caloriesKcal),
      sugarG: structuredClone(row.primary.sugarG),
      region: null,
      availability: "listed",
      rawText: null,
    });
    const next = promoteCandidate(normalizeRow(row)).record;
    next.sourceStatus = "missing";

    const events = diffTrustedRecords(prev, next, T1);
    expect(types(events)).toEqual([
      "product_renamed",
      "page_missing",
      "source_level_changed",
      "caffeine_changed",
      "variant_added",
    ]);
    // Determinism: same inputs, same output.
    expect(diffTrustedRecords(prev, next, T1)).toEqual(events);
  });
});

describe("diffTrustedRecords — event contract", () => {
  it("only ever emits the 13 planned event types", () => {
    expect(CHANGE_EVENT_TYPES).toHaveLength(13);
    const row = structuredClone(asRow(multiVariant));
    row.identity.name = "Monster Family";
    row.primary.caffeineMg.value = 200;
    const events = diffTrustedRecords(
      recordOf(multiVariant),
      promoteCandidate(normalizeRow(row)).record,
      T1,
    );
    for (const event of events) {
      expect(CHANGE_EVENT_TYPES).toContain(event.type);
    }
  });

  it("always carries before/after points with value+qualifier+unit keys", () => {
    const next = nextWith((r) => {
      r.primary.caffeineMg.value = 100;
    });
    for (const event of diffTrustedRecords(prev, next, T1)) {
      if (event.before !== null) {
        expect(Object.keys(event.before)).toEqual(
          expect.arrayContaining(["value", "qualifier", "unit"]),
        );
      }
      if (event.after !== null) {
        expect(Object.keys(event.after)).toEqual(
          expect.arrayContaining(["value", "qualifier", "unit"]),
        );
      }
    }
  });
});
