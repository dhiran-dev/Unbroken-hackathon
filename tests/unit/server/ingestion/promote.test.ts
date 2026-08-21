/**
 * Unit tests for field-level promotion decisions (Agent A5).
 *
 * Covers every row of the promotion table exactly:
 * - not_published        => valid sparse record (verdict "sparse")
 * - present value 0      => explicit zero is DATA (verdict "zero"; caffeine
 *                           eligible for caffeine-free boards)
 * - unparseable          => preserve prior trusted value + open incident
 * - serving absent       => totalCaffeineEligible=true, concentrationEligible=false
 * - qualifier range      => displayable as range, exactBoardEligible=false
 * - conflicting          => metric excluded everywhere, evidence retained
 * - page missing         => preservePrior=true + sourceStatus="missing"
 */

import { describe, expect, it } from "vitest";

import { normalizeRow } from "@/server/ingestion/normalize";
import { promoteCandidate } from "@/server/ingestion/promote";
import type { TrustedProductRecord } from "@/server/ingestion/promote";

import conflictingVariant from "@/domain/product/fixtures/conflicting-variant.json";
import estimatedCaffeine from "@/domain/product/fixtures/estimated-caffeine.json";
import explicitZeroCaffeine from "@/domain/product/fixtures/explicit-zero-caffeine.json";
import explicitZeroSugar from "@/domain/product/fixtures/explicit-zero-sugar.json";
import perItemMint from "@/domain/product/fixtures/per-item-mint.json";
import rangeCaffeine from "@/domain/product/fixtures/range-caffeine.json";
import standardFull from "@/domain/product/fixtures/standard-full.json";
import standardSparse from "@/domain/product/fixtures/standard-sparse.json";

function asRow(row: unknown): Parameters<typeof normalizeRow>[0] {
  return row as Parameters<typeof normalizeRow>[0];
}

function promote(
  fixture: unknown,
  context?: Parameters<typeof promoteCandidate>[1],
) {
  return promoteCandidate(normalizeRow(asRow(fixture)), context);
}

function trustedRecord(overrides: Partial<TrustedProductRecord>): TrustedProductRecord {
  const decision = promote(standardFull);
  return { ...decision.record, ...overrides };
}

describe("promoteCandidate — sparse is valid data", () => {
  it("maps not_published to the sparse verdict with no incident", () => {
    const decision = promote(standardSparse);

    expect(decision.fieldVerdicts.calories_kcal.verdict).toBe("sparse");
    expect(decision.fieldVerdicts.calories_kcal.rankable).toBe(false);
    expect(decision.fieldVerdicts.calories_kcal.preservePrior).toBe(false);
    expect(decision.fieldVerdicts.calories_kcal.openIncident).toBe(false);
    // Sparse itself never quarantines: any quarantine here comes from the
    // fixture's separate unparseable sugar cell, not from the sparse field.
    expect(decision.incidents.some((i) => i.field === "calories_kcal")).toBe(
      false,
    );
  });

  it("never promotes an unparseable field as sparse", () => {
    const decision = promote(standardSparse);
    expect(decision.fieldVerdicts.sugar_g.verdict).not.toBe("sparse");
  });
});

describe("promoteCandidate — explicit zero is DATA", () => {
  it("gives caffeine zero the zero verdict and caffeine-free eligibility", () => {
    const decision = promote(explicitZeroCaffeine);
    const caffeine = decision.fieldVerdicts.caffeine_mg;

    expect(caffeine.verdict).toBe("zero");
    expect(caffeine.value).toBe(0);
    expect(caffeine.rankable).toBe(true);
    expect(caffeine.caffeineFreeBoardEligible).toBe(true);
    expect(caffeine.exactBoardEligible).toBe(true);
    expect(decision.overall).toBe("trusted");
    expect(decision.record.caffeineMg.value).toBe(0); // zero is not missing
  });

  it("gives sugar zero the zero verdict without caffeine-free eligibility", () => {
    const decision = promote(explicitZeroSugar);
    const sugar = decision.fieldVerdicts.sugar_g;

    expect(sugar.verdict).toBe("zero");
    expect(sugar.rankable).toBe(true);
    expect(sugar.caffeineFreeBoardEligible).toBe(false); // not a caffeine field
  });
});

describe("promoteCandidate — unparseable preserves prior + opens incident", () => {
  it("carries the prior trusted value and flags preservePrior + openIncident", () => {
    const decision = promote(standardSparse, {
      previousTrusted: {
        sugarG: {
          value: 25,
          min: null,
          max: null,
          qualifier: "exact",
          unit: "g",
          state: "present",
          rawText: "25 g",
        },
      },
    });
    const sugar = decision.fieldVerdicts.sugar_g;

    expect(sugar.verdict).toBe("preserved_prior");
    expect(sugar.preservePrior).toBe(true);
    expect(sugar.openIncident).toBe(true);
    expect(sugar.value).toBe(25); // prior trusted value survives
    expect(sugar.rawText).toBe("n/a"); // new evidence retained alongside
    expect(decision.incidents).toHaveLength(1);
    expect(decision.incidents[0]).toMatchObject({
      field: "sugar_g",
      code: "unparseable",
    });
    // An open incident quarantines the candidate until healed.
    expect(decision.overall).toBe("quarantined");
  });

  it("still opens an incident when there is no prior value to preserve", () => {
    const decision = promote(standardSparse);
    const sugar = decision.fieldVerdicts.sugar_g;

    expect(sugar.verdict).toBe("preserved_prior");
    expect(sugar.preservePrior).toBe(true);
    expect(sugar.openIncident).toBe(true);
    expect(sugar.value).toBeNull();
    expect(decision.overall).toBe("quarantined");
    expect(decision.incidents).toHaveLength(1);
  });

  it("treats an invalid negative reading as unparseable (parser bug, never data)", () => {
    const row = structuredClone(asRow(standardFull));
    row.primary.caffeineMg.value = -5;
    const decision = promote(row, {
      previousTrusted: {
        caffeineMg: { value: 80, qualifier: "exact", unit: "mg", state: "present" },
      },
    });
    const caffeine = decision.fieldVerdicts.caffeine_mg;

    expect(caffeine.verdict).toBe("preserved_prior");
    expect(caffeine.value).toBe(80);
    expect(caffeine.openIncident).toBe(true);
    expect(decision.incidents[0]?.code).toBe("invalid_value");
  });
});

describe("promoteCandidate — serving absent keeps caffeine eligible", () => {
  it("sets totalCaffeineEligible=true and concentrationEligible=false", () => {
    const decision = promote(standardSparse);
    const serving = decision.fieldVerdicts.serving;

    expect(serving.verdict).toBe("sparse");
    expect(serving.totalCaffeineEligible).toBe(true); // 72 mg exact still ranks
    expect(serving.concentrationEligible).toBe(false); // no volume basis
    expect(decision.record.serving.state).toBe("not_published");
  });

  it("keeps concentration ineligible for per-item servings", () => {
    const decision = promote(perItemMint);
    const serving = decision.fieldVerdicts.serving;

    expect(serving.verdict).toBe("value");
    expect(serving.totalCaffeineEligible).toBe(true);
    expect(serving.concentrationEligible).toBe(false); // mint has no normalizedMl
  });

  it("enables concentration for exact caffeine + positive ml serving", () => {
    const decision = promote(standardFull);
    const serving = decision.fieldVerdicts.serving;

    expect(serving.totalCaffeineEligible).toBe(true);
    expect(serving.concentrationEligible).toBe(true);
  });

  it("keeps concentration ineligible when caffeine is not exact", () => {
    const decision = promote(estimatedCaffeine);
    expect(decision.fieldVerdicts.serving.concentrationEligible).toBe(false);
  });
});

describe("promoteCandidate — ranges display but never rank exact", () => {
  it("maps qualifier range to the range verdict", () => {
    const decision = promote(rangeCaffeine);
    const caffeine = decision.fieldVerdicts.caffeine_mg;

    expect(caffeine.verdict).toBe("range");
    expect(caffeine.min).toBe(95);
    expect(caffeine.max).toBe(200);
    expect(caffeine.rankable).toBe(true); // displayable as a range
    expect(caffeine.exactBoardEligible).toBe(false); // never on exact-only boards
    expect(caffeine.caffeineFreeBoardEligible).toBe(false);
    expect(decision.overall).toBe("trusted");
  });
});

describe("promoteCandidate — conflicts exclude the metric, keep evidence", () => {
  it("excludes a conflicting metric everywhere while retaining raw evidence", () => {
    const decision = promote(conflictingVariant);
    const caffeine = decision.fieldVerdicts.caffeine_mg;

    expect(caffeine.verdict).toBe("conflict");
    expect(caffeine.rankable).toBe(false);
    expect(caffeine.exactBoardEligible).toBe(false);
    expect(caffeine.caffeineFreeBoardEligible).toBe(false);
    expect(caffeine.value).toBeNull();
    // Evidence retained for display.
    expect(caffeine.rawText).toBeTruthy();
    expect(decision.record.caffeineMg.rawText).toBeTruthy();
    // Conflicts are valid reviewed data: no incident, record stays trusted.
    expect(decision.incidents).toEqual([]);
    expect(decision.overall).toBe("trusted");
  });

  it("keeps other fields fully eligible around the conflict", () => {
    const decision = promote(conflictingVariant);
    expect(decision.fieldVerdicts.calories_kcal.verdict).toBe("value");
    expect(decision.fieldVerdicts.calories_kcal.rankable).toBe(true);
    expect(decision.fieldVerdicts.sugar_g.verdict).toBe("zero");
  });
});

describe("promoteCandidate — page missing preserves the prior record", () => {
  it("marks sourceStatus missing and flags preservePrior at record level", () => {
    const prior = trustedRecord({});
    const decision = promote(standardFull, { pageMissing: true });

    expect(decision.sourceStatus).toBe("missing");
    expect(decision.preservePrior).toBe(true);
    expect(decision.record.sourceStatus).toBe("missing");
    // The preserved record is still the trusted one (nothing untrusted promoted).
    expect(decision.overall).toBe("trusted");
    void prior;
  });

  it("leaves sourceStatus active for a normal observation", () => {
    const decision = promote(standardFull);
    expect(decision.sourceStatus).toBe("active");
    expect(decision.preservePrior).toBe(false);
  });
});

describe("promoteCandidate — output shape and determinism", () => {
  it("exposes verdicts for exactly the four promoted fields", () => {
    const decision = promote(standardFull);
    expect(Object.keys(decision.fieldVerdicts).sort()).toEqual([
      "caffeine_mg",
      "calories_kcal",
      "serving",
      "sugar_g",
    ]);
  });

  it("is a pure function of candidate + context", () => {
    const context = {
      previousTrusted: { sugarG: { value: 25, unit: "g" as const } },
    };
    expect(promote(standardSparse, context)).toEqual(
      promote(standardSparse, context),
    );
  });

  it("produces a trusted record carrying identity and observedAt from the row", () => {
    const decision = promote(standardFull);
    expect(decision.record).toMatchObject({
      schemaVersion: "1.0",
      sourceId: "caffeine-informer",
      slug: "red-bull",
      name: "Red Bull",
      sourceStatus: "active",
    });
    expect(decision.record.observedAt).toBe(standardFull.source.observedAt);
  });
});
