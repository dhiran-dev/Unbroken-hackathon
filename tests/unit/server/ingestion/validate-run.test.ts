/**
 * Unit tests for run-level validation (Agent A5).
 *
 * Covers every run check: expected host, schema version, duplicate slug rate,
 * negative/invalid caffeine values, row contraction, zero-value spike, and
 * unknown-unit spike — including the exact threshold boundaries (>2%, >10%,
 * >30%, >20%: equal to a threshold never trips it).
 */

import { describe, expect, it } from "vitest";

import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";

import invalidNegative from "@/domain/product/fixtures/invalid-negative.json";
import multiVariant from "@/domain/product/fixtures/multi-variant.json";
import standardFull from "@/domain/product/fixtures/standard-full.json";
import standardSparse from "@/domain/product/fixtures/standard-sparse.json";
import wrongHost from "@/domain/product/fixtures/wrong-host.json";

import { validateRun } from "@/server/ingestion/validate-run";

function asRow(row: unknown): ProductScrapeRowV1 {
  return row as ProductScrapeRowV1;
}

const base = asRow(standardFull);

function rowWith(
  slug: string,
  mutate: (row: ProductScrapeRowV1) => void,
): ProductScrapeRowV1 {
  const row = structuredClone(base);
  row.source.slug = slug;
  row.source.url = `https://www.caffeineinformer.com/caffeine-content/${slug}`;
  mutate(row);
  return row;
}

/** Build N distinct valid rows with unique slugs and no variants/flavours. */
function rowsOf(n: number): ProductScrapeRowV1[] {
  return Array.from({ length: n }, (_, i) => {
    const row = rowWith(`product-${i}`, () => {});
    row.variants = [];
    row.flavours = [];
    return row;
  });
}

function cloneAt(rows: readonly ProductScrapeRowV1[], i: number): ProductScrapeRowV1 {
  const row = rows[i];
  if (!row) throw new Error(`no row at index ${i}`);
  return structuredClone(row);
}

function findingChecks(result: ReturnType<typeof validateRun>): string[] {
  return result.findings.map((f) => f.check);
}

describe("validateRun — clean runs", () => {
  it("accepts the standard fixtures with no findings", () => {
    const result = validateRun([standardFull, standardSparse, multiVariant].map(asRow));
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it("accepts an empty run with no previous count", () => {
    const result = validateRun([]);
    expect(result.ok).toBe(true);
    expect(result.findings).toEqual([]);
  });
});

describe("validateRun — expected host", () => {
  it("fails when any row resolves off caffeineinformer.com", () => {
    const result = validateRun([base, asRow(wrongHost)]);
    expect(result.ok).toBe(false);
    expect(findingChecks(result)).toContain("expected_host");
    const hostFinding = result.findings.find((f) => f.check === "expected_host");
    expect(hostFinding?.severity).toBe("fail");
    expect(hostFinding?.detail).toContain("coffee");
  });

  it("accepts subdomains of caffeineinformer.com", () => {
    const row = structuredClone(base);
    row.source.url = "https://www.caffeineinformer.com/caffeine-content/red-bull";
    expect(validateRun([row]).ok).toBe(true);
  });

  it("fails unparseable URLs", () => {
    const row = structuredClone(base);
    row.source.url = "not-a-url";
    const result = validateRun([row]);
    expect(result.ok).toBe(false);
    expect(findingChecks(result)).toContain("expected_host");
  });
});

describe("validateRun — schema version", () => {
  it("fails rows whose schemaVersion is not 1.0", () => {
    const row = structuredClone(base);
    // Simulate an older parser output arriving in the run.
    (row as unknown as { schemaVersion: string }).schemaVersion = "0.9";
    const result = validateRun([base, row]);
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.check === "schema_version");
    expect(finding?.severity).toBe("fail");
    expect(finding?.detail).toContain("red-bull");
  });

  it("does not blame rows that are still on 1.0", () => {
    expect(validateRun([base]).findings).toEqual([]);
  });
});

describe("validateRun — duplicate slug rate", () => {
  it("passes at exactly the 2% boundary", () => {
    // 50 rows, 1 duplicate = 2% -> not > 2%.
    const rows = rowsOf(49);
    rows.push(cloneAt(rows, 0));
    expect(rows).toHaveLength(50);
    const result = validateRun(rows);
    expect(findingChecks(result)).not.toContain("duplicate_slug_rate");
    expect(result.ok).toBe(true);
  });

  it("fails above the 2% boundary", () => {
    // 50 rows, 2 duplicates = 4% -> fail.
    const rows = rowsOf(48);
    rows.push(cloneAt(rows, 0));
    rows.push(cloneAt(rows, 0));
    const result = validateRun(rows);
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.check === "duplicate_slug_rate");
    expect(finding?.severity).toBe("fail");
    expect(finding?.detail).toContain("product-0");
  });

  it("fails a fully duplicated small run", () => {
    const rows = [base, structuredClone(base)];
    const result = validateRun(rows);
    expect(result.ok).toBe(false);
    expect(findingChecks(result)).toContain("duplicate_slug_rate");
  });
});

describe("validateRun — negative / invalid caffeine values", () => {
  it("fails the invalid-negative fixture", () => {
    const result = validateRun([base, asRow(invalidNegative)]);
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.check === "invalid_caffeine_values");
    expect(finding?.severity).toBe("fail");
    expect(finding?.detail).toContain("broken-parser-row");
  });

  it("ignores non-present caffeine states", () => {
    const row = rowWith("sparse-row", (r) => {
      r.primary.caffeineMg = {
        state: "not_published",
        value: null,
        min: null,
        max: null,
        qualifier: "unknown",
        rawText: null,
        candidates: [],
      };
    });
    expect(validateRun([row]).ok).toBe(true);
  });
});

describe("validateRun — sudden row contraction", () => {
  it("passes at exactly the 10% boundary", () => {
    // previous 10 -> current 9 = 10% drop, not > 10%.
    const result = validateRun(rowsOf(9), { previousRunCount: 10 });
    expect(findingChecks(result)).not.toContain("row_contraction");
    expect(result.ok).toBe(true);
  });

  it("fails above the 10% boundary", () => {
    // previous 10 -> current 8 = 20% drop.
    const result = validateRun(rowsOf(8), { previousRunCount: 10 });
    expect(result.ok).toBe(false);
    const finding = result.findings.find((f) => f.check === "row_contraction");
    expect(finding?.severity).toBe("fail");
    expect(finding?.detail).toContain("10");
  });

  it("fails a run that lost everything", () => {
    const result = validateRun([], { previousRunCount: 25 });
    expect(result.ok).toBe(false);
    expect(findingChecks(result)).toContain("row_contraction");
  });

  it("skips the check without a previous count", () => {
    expect(validateRun(rowsOf(3)).findings).toEqual([]);
  });
});

describe("validateRun — zero-value spike", () => {
  function withZeros(zeroCount: number, nonzeroCount: number): ProductScrapeRowV1[] {
    const rows: ProductScrapeRowV1[] = [];
    for (let i = 0; i < zeroCount; i += 1) {
      rows.push(
        rowWith(`zero-${i}`, (r) => {
          r.primary.sugarG.value = 0;
          r.primary.caloriesKcal.value = 0;
        }),
      );
    }
    for (let i = 0; i < nonzeroCount; i += 1) {
      rows.push(
        rowWith(`nonzero-${i}`, (r) => {
          r.primary.sugarG.value = 20;
          r.primary.caloriesKcal.value = 100;
        }),
      );
    }
    return rows;
  }

  it("warns (but stays ok) above the 30% boundary", () => {
    // 2 rows x (sugar + calories) = 4 present observations, 2 zeros = 50%.
    const rows = withZeros(1, 1);
    const result = validateRun(rows);
    const finding = result.findings.find((f) => f.check === "zero_value_spike");
    expect(finding?.severity).toBe("warn");
    expect(result.ok).toBe(true); // warnings never fail a run
  });

  it("stays silent at or below the 30% boundary", () => {
    // 5 rows x 2 fields = 10 present observations, exactly 3 zeros = 30%
    // -> not > 30%, no finding.
    const rows = rowsOf(5);
    for (const [index, row] of rows.entries()) {
      row.primary.caloriesKcal.value = 100;
      row.primary.sugarG.value = index < 3 ? 0 : 20;
    }
    expect(validateRun(rows).findings).toEqual([]);
  });

  it("ignores runs with no present sugar/calorie observations", () => {
    const row = rowWith("all-sparse", (r) => {
      for (const key of ["caloriesKcal", "sugarG"] as const) {
        r.primary[key] = {
          state: "not_published",
          value: null,
          min: null,
          max: null,
          qualifier: "unknown",
          rawText: null,
          candidates: [],
        };
      }
    });
    expect(validateRun([row]).findings).toEqual([]);
  });
});

describe("validateRun — unknown-unit spike", () => {
  it("warns (but stays ok) above the 20% boundary", () => {
    const rows = rowsOf(5);
    const first = rows[0];
    const second = rows[1];
    if (!first || !second) throw new Error("expected 5 rows");
    first.primary.serving.unit = "unknown";
    second.primary.serving.unit = null;
    // 2 of 5 servings unknown = 40% > 20%.
    const result = validateRun(rows);
    const finding = result.findings.find((f) => f.check === "unknown_unit_spike");
    expect(finding?.severity).toBe("warn");
    expect(result.ok).toBe(true);
  });

  it("counts variant and flavour servings too", () => {
    const rows = [asRow(multiVariant)]; // 1 primary + 3 variant servings = 4
    const result = validateRun(rows);
    expect(findingChecks(result)).not.toContain("unknown_unit_spike");

    const broken = structuredClone(asRow(multiVariant));
    broken.primary.serving.unit = "unknown";
    for (const variant of broken.variants) {
      variant.serving.unit = "unknown";
    }
    // 4 of 4 unknown = 100%.
    const warnResult = validateRun([broken]);
    expect(warnResult.findings.map((f) => f.check)).toContain("unknown_unit_spike");
    expect(warnResult.ok).toBe(true);
  });

  it("stays silent at or below the 20% boundary", () => {
    // 5 servings, 1 unknown = 20% -> not > 20%.
    const rows = rowsOf(5);
    const first = rows[0];
    if (!first) throw new Error("expected 5 rows");
    first.primary.serving.unit = "unknown";
    expect(validateRun(rows).findings).toEqual([]);
  });
});

describe("validateRun — determinism", () => {
  it("is a pure function of its inputs", () => {
    const rows = [base, asRow(wrongHost), asRow(invalidNegative)];
    const a = validateRun(rows, { previousRunCount: 100 });
    const b = validateRun(rows, { previousRunCount: 100 });
    expect(a).toEqual(b);
  });

  it("emits findings in a fixed order regardless of row order", () => {
    const one = validateRun([asRow(wrongHost), base]);
    const two = validateRun([base, asRow(wrongHost)]);
    expect(one.findings).toEqual(two.findings);
  });
});
