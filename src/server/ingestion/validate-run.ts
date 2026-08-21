/**
 * PulseRank ingestion — run-level validation (Agent A5).
 *
 * Pure function mandate (A5): no database access, no network access, no clock
 * reads. `validateRun` is a pure function of its inputs; identical input always
 * yields identical output.
 *
 * Implements PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §"Agent A5" →
 * "Run-level checks":
 *
 * | Check                  | Severity | Trigger                                   |
 * |------------------------|----------|-------------------------------------------|
 * | expected_host          | fail     | any row URL off caffeineinformer.com      |
 * | schema_version         | fail     | any row with schemaVersion !== "1.0"      |
 * | duplicate_slug_rate    | fail     | duplicate slugs > 2% of the run           |
 * | invalid_caffeine_values| fail     | negative / non-finite caffeine readings   |
 * | row_contraction        | fail     | run shrank > 10% vs previous run count    |
 * | zero_value_spike       | warn     | > 30% zeros among present sugar/calories  |
 * | unknown_unit_spike     | warn     | > 20% unknown units among servings        |
 *
 * `ok` is true exactly when no finding has severity "fail". Warnings never
 * block a run; they are surfaced for the incident/heal flow.
 *
 * The input is the *parsed* row shape and deliberately looser than
 * `ProductScrapeRowV1`: a run must be inspectable even when it is wrong about
 * its host or schema version (those are findings, not type errors). Any
 * `ProductScrapeRowV1` is structurally assignable to `ValidatableRow`.
 */

import type { FieldState } from "@/domain/product/contracts/field-states";

// ---------------------------------------------------------------------------
// Public shapes
// ---------------------------------------------------------------------------

export const EXPECTED_HOST = "caffeineinformer.com";

export const RUN_SCHEMA_VERSION = "1.0";

/** Duplicate-slug rate above which the run fails (> 2%). */
export const DUPLICATE_SLUG_FAIL_RATE = 0.02;

/** Run-size drop vs the previous run above which the run fails (> 10%). */
export const ROW_CONTRACTION_FAIL_RATE = 0.1;

/** Zero share among present sugar/calories above which the run warns (> 30%). */
export const ZERO_VALUE_WARN_RATE = 0.3;

/** Unknown-unit share among servings above which the run warns (> 20%). */
export const UNKNOWN_UNIT_WARN_RATE = 0.2;

export type RunFindingCheck =
  | "expected_host"
  | "schema_version"
  | "duplicate_slug_rate"
  | "invalid_caffeine_values"
  | "row_contraction"
  | "zero_value_spike"
  | "unknown_unit_spike";

export type RunFindingSeverity = "fail" | "warn";

export type RunFinding = {
  check: RunFindingCheck;
  severity: RunFindingSeverity;
  detail: string;
};

export type RunValidationResult = {
  /** True exactly when no finding has severity "fail". */
  ok: boolean;
  findings: RunFinding[];
};

/**
 * Permissive structural view of one parsed scrape row. Accepts any
 * `ProductScrapeRowV1` directly; only the fields inspected here are required.
 */
export type ValidatableRow = {
  schemaVersion: string;
  source: {
    url: string;
    slug: string;
  };
  primary: {
    caffeineMg: {
      state: FieldState;
      value: number | null;
      min?: number | null;
      max?: number | null;
    };
    serving: {
      unit: string | null | undefined;
    };
    caloriesKcal: {
      state: FieldState;
      value: number | null;
    };
    sugarG: {
      state: FieldState;
      value: number | null;
    };
  };
  variants?: ReadonlyArray<{ serving?: { unit: string | null | undefined } }>;
  flavours?: ReadonlyArray<{ serving?: { unit: string | null | undefined } }>;
};

export type ValidateRunOptions = {
  /** Number of rows in the previously accepted run, when known. */
  previousRunCount?: number | undefined;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isCaffeineInformerUrl(rawUrl: string): boolean {
  try {
    const hostname = new URL(rawUrl).hostname.toLowerCase();
    return (
      hostname === EXPECTED_HOST || hostname.endsWith(`.${EXPECTED_HOST}`)
    );
  } catch {
    return false;
  }
}

function percent(fraction: number): string {
  return `${(fraction * 100).toFixed(1)}%`;
}

function listSlugs(slugs: readonly string[]): string {
  return slugs.join(", ");
}

// ---------------------------------------------------------------------------
// Run validation
// ---------------------------------------------------------------------------

/**
 * Validate one parsed run. Deterministic: same rows and options in, same
 * findings out. Findings are emitted in a fixed check order regardless of
 * input ordering; slug lists inside details are sorted for stability.
 */
export function validateRun(
  rows: readonly ValidatableRow[],
  options: ValidateRunOptions = {},
): RunValidationResult {
  const findings: RunFinding[] = [];

  // -- expected host --------------------------------------------------------
  const wrongHostSlugs: string[] = [];
  for (const row of rows) {
    if (!isCaffeineInformerUrl(row.source.url)) {
      wrongHostSlugs.push(row.source.slug);
    }
  }
  if (wrongHostSlugs.length > 0) {
    wrongHostSlugs.sort();
    findings.push({
      check: "expected_host",
      severity: "fail",
      detail:
        `${wrongHostSlugs.length} row(s) do not resolve to ${EXPECTED_HOST}: ` +
        listSlugs(wrongHostSlugs),
    });
  }

  // -- schema version -------------------------------------------------------
  const wrongVersionSlugs: string[] = [];
  for (const row of rows) {
    if (row.schemaVersion !== RUN_SCHEMA_VERSION) {
      wrongVersionSlugs.push(row.source.slug);
    }
  }
  if (wrongVersionSlugs.length > 0) {
    wrongVersionSlugs.sort();
    findings.push({
      check: "schema_version",
      severity: "fail",
      detail:
        `${wrongVersionSlugs.length} row(s) report schemaVersion !== ` +
        `"${RUN_SCHEMA_VERSION}": ${listSlugs(wrongVersionSlugs)}`,
    });
  }

  // -- duplicate slug rate --------------------------------------------------
  const totalRows = rows.length;
  if (totalRows > 0) {
    const seen = new Map<string, number>();
    for (const row of rows) {
      seen.set(row.source.slug, (seen.get(row.source.slug) ?? 0) + 1);
    }
    const duplicateSlugs: string[] = [];
    let duplicateRowCount = 0;
    for (const [slug, count] of seen) {
      if (count > 1) {
        duplicateSlugs.push(slug);
        duplicateRowCount += count - 1;
      }
    }
    const duplicateRate = duplicateRowCount / totalRows;
    if (duplicateRate > DUPLICATE_SLUG_FAIL_RATE) {
      duplicateSlugs.sort();
      findings.push({
        check: "duplicate_slug_rate",
        severity: "fail",
        detail:
          `${duplicateRowCount} duplicate row(s) across ` +
          `${duplicateSlugs.length} slug(s) = ${percent(duplicateRate)} of ` +
          `${totalRows} rows (limit ${percent(DUPLICATE_SLUG_FAIL_RATE)}): ` +
          listSlugs(duplicateSlugs),
      });
    }
  }

  // -- negative / invalid caffeine values -----------------------------------
  const invalidCaffeineSlugs: string[] = [];
  for (const row of rows) {
    const caffeine = row.primary.caffeineMg;
    if (caffeine.state !== "present") continue;
    const badValue =
      caffeine.value !== null &&
      (!Number.isFinite(caffeine.value) || caffeine.value < 0);
    const badMin =
      caffeine.min != null && (!Number.isFinite(caffeine.min) || caffeine.min < 0);
    const badMax =
      caffeine.max != null && (!Number.isFinite(caffeine.max) || caffeine.max < 0);
    if (badValue || badMin || badMax) {
      invalidCaffeineSlugs.push(row.source.slug);
    }
  }
  if (invalidCaffeineSlugs.length > 0) {
    invalidCaffeineSlugs.sort();
    findings.push({
      check: "invalid_caffeine_values",
      severity: "fail",
      detail:
        `${invalidCaffeineSlugs.length} row(s) carry negative or non-finite ` +
        `caffeine values (parser bug, never data): ` +
        listSlugs(invalidCaffeineSlugs),
    });
  }

  // -- sudden row contraction ------------------------------------------------
  const { previousRunCount } = options;
  if (previousRunCount != null && previousRunCount > 0) {
    const contractionRate =
      Math.max(0, previousRunCount - totalRows) / previousRunCount;
    if (contractionRate > ROW_CONTRACTION_FAIL_RATE) {
      findings.push({
        check: "row_contraction",
        severity: "fail",
        detail:
          `run shrank from ${previousRunCount} to ${totalRows} row(s) = ` +
          `${percent(contractionRate)} contraction (limit ` +
          `${percent(ROW_CONTRACTION_FAIL_RATE)})`,
      });
    }
  }

  // -- zero-value spike among present sugar/calories -------------------------
  let presentSugarCalories = 0;
  let zeroSugarCalories = 0;
  for (const row of rows) {
    for (const observation of [row.primary.caloriesKcal, row.primary.sugarG]) {
      if (observation.state === "present") {
        presentSugarCalories += 1;
        if (observation.value === 0) {
          zeroSugarCalories += 1;
        }
      }
    }
  }
  if (presentSugarCalories > 0) {
    const zeroRate = zeroSugarCalories / presentSugarCalories;
    if (zeroRate > ZERO_VALUE_WARN_RATE) {
      findings.push({
        check: "zero_value_spike",
        severity: "warn",
        detail:
          `${zeroSugarCalories} of ${presentSugarCalories} present ` +
          `sugar/calorie observations are explicit zeros = ` +
          `${percent(zeroRate)} (warn threshold ` +
          `${percent(ZERO_VALUE_WARN_RATE)}) — template may be collapsing ` +
          `values to 0`,
      });
    }
  }

  // -- unknown-unit spike among servings --------------------------------------
  let servingsExamined = 0;
  let unknownUnits = 0;
  const countServing = (unit: string | null | undefined): void => {
    servingsExamined += 1;
    if (unit == null || unit === "unknown") {
      unknownUnits += 1;
    }
  };
  for (const row of rows) {
    countServing(row.primary.serving.unit);
    for (const variant of row.variants ?? []) {
      countServing(variant.serving?.unit);
    }
    for (const flavour of row.flavours ?? []) {
      countServing(flavour.serving?.unit);
    }
  }
  if (servingsExamined > 0) {
    const unknownRate = unknownUnits / servingsExamined;
    if (unknownRate > UNKNOWN_UNIT_WARN_RATE) {
      findings.push({
        check: "unknown_unit_spike",
        severity: "warn",
        detail:
          `${unknownUnits} of ${servingsExamined} serving observations have ` +
          `unknown units = ${percent(unknownRate)} (warn threshold ` +
          `${percent(UNKNOWN_UNIT_WARN_RATE)}) — parser may have lost the ` +
          `serving column`,
      });
    }
  }

  return {
    ok: !findings.some((finding) => finding.severity === "fail"),
    findings,
  };
}
