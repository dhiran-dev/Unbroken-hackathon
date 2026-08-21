/**
 * PulseRank ingestion — field-level promotion decisions (Agent A5).
 *
 * Pure function mandate (A5): no database access, no network access, no clock
 * reads. `promoteCandidate` is a pure function of the normalized candidate and
 * its context; identical input always yields identical output.
 *
 * Implements PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §"Agent A5" →
 * "Field-level behavior", exactly:
 *
 * | Condition                    | Decision                                        |
 * |------------------------------|-------------------------------------------------|
 * | state `not_published`        | valid sparse record (verdict `sparse`)          |
 * | present value 0              | explicit zero is DATA (verdict `zero`; caffeine |
 * |                              | qualifies for caffeine-free boards)             |
 * | `unparseable`                | preserve prior trusted value (`preservePrior`)  |
 * |                              | + open an incident (`openIncident`)             |
 * | serving absent/not_published | totalCaffeineEligible=true,                     |
 * |                              | concentrationEligible=false                     |
 * | qualifier `range`            | displayable as range, exactBoardEligible=false  |
 * | `conflicting`                | metric excluded everywhere, evidence retained   |
 * | page missing                 | preservePrior=true + sourceStatus="missing"     |
 *
 * Record-level outcome: `overall` is "quarantined" exactly when at least one
 * incident was opened (unparseable fields cannot be replaced by new data and
 * require the heal flow before the candidate may rewrite the trusted record —
 * plan §"Failure and healing": failed candidate is quarantined, prior trusted
 * product remains public). Sparse data, explicit zeros, ranges, and excluded
 * conflicting metrics never quarantine: they are valid data with restricted
 * eligibility.
 */

import type { FieldState } from "@/domain/product/contracts/field-states";
import type {
  NumberObservation,
  ServingObservation,
} from "@/domain/product/contracts/observations";
import type {
  CanonicalCategory,
  NormalizedCandidate,
  NormalizedServing,
} from "@/server/ingestion/normalize";

// ---------------------------------------------------------------------------
// Trusted record shapes (output of a successful promotion)
// ---------------------------------------------------------------------------

/** A promoted, trusted metric point. */
export type TrustedMetricPoint = {
  state: FieldState;
  value: number | null;
  min: number | null;
  max: number | null;
  qualifier: NumberObservation["qualifier"];
  unit: "mg" | "kcal" | "g";
  /** Raw page text retained as evidence; conflicts keep it for display. */
  rawText: string | null;
};

/** A promoted, trusted serving point. */
export type TrustedServingPoint = {
  state: FieldState;
  value: number | null;
  unit: ServingObservation["unit"];
  form: ServingObservation["form"];
  normalizedMl: number | null;
};

export type TrustedVariant = {
  name: string;
  region: string | null;
  availability: NormalizedCandidate["variants"][number]["availability"];
  caffeineMg: TrustedMetricPoint;
  caloriesKcal: TrustedMetricPoint;
  sugarG: TrustedMetricPoint;
  serving: TrustedServingPoint;
};

export type TrustedFlavour = {
  name: string;
  availability: NormalizedCandidate["flavours"][number]["availability"];
  caffeineRelation: NormalizedCandidate["flavours"][number]["caffeineRelation"];
  caffeineMg: TrustedMetricPoint;
};

/**
 * A trusted product record as it lives in the trusted snapshot. This is the
 * record shape consumed by change detection (trusted-to-trusted diffs only).
 */
export type TrustedProductRecord = {
  schemaVersion: "1.0";
  sourceId: string;
  slug: string;
  name: string;
  category: CanonicalCategory;
  sourceUrl: string;
  observedAt: string;
  pageFingerprint: string;
  sourceLevel: NormalizedCandidate["sourceLevel"];
  caffeineMg: TrustedMetricPoint;
  caloriesKcal: TrustedMetricPoint;
  sugarG: TrustedMetricPoint;
  serving: TrustedServingPoint;
  variants: TrustedVariant[];
  flavours: TrustedFlavour[];
  /** "missing" when the source page disappeared (prior record preserved). */
  sourceStatus: "active" | "missing";
};

/**
 * The prior trusted state of the fields of one product, used to preserve
 * values on unparseable observations and page disappearance. Pass `null`
 * when there is no prior trusted record (first observation).
 */
export type PriorTrustedFields = {
  caffeineMg?: Partial<TrustedMetricPoint> | undefined;
  caloriesKcal?: Partial<TrustedMetricPoint> | undefined;
  sugarG?: Partial<TrustedMetricPoint> | undefined;
  serving?: Partial<TrustedServingPoint> | undefined;
};

export type PromoteContext = {
  /** Prior trusted field values for this product, when any. */
  previousTrusted?: PriorTrustedFields | null | undefined;
  /** True when the source page did not come back on this observation run. */
  pageMissing?: boolean | undefined;
};

// ---------------------------------------------------------------------------
// Field verdict shapes
// ---------------------------------------------------------------------------

export type FieldVerdict =
  /** A trusted numeric value (exact, approximate, or estimated). */
  | "value"
  /** An explicit published 0 — data, never "missing". */
  | "zero"
  /** Field legitimately not published — valid sparse record. */
  | "sparse"
  /** A well-formed min<=max range — displayable, never exact-board material. */
  | "range"
  /** Conflicting candidates — metric excluded everywhere, evidence retained. */
  | "conflict"
  /** Unparseable (or invalid) — prior trusted value preserved, incident open. */
  | "preserved_prior";

export type MetricFieldVerdict = {
  verdict: FieldVerdict;
  field: "caffeine_mg" | "calories_kcal" | "sugar_g";
  unit: "mg" | "kcal" | "g";
  state: FieldState;
  /** Promoted value (prior trusted value when preserved). */
  value: number | null;
  min: number | null;
  max: number | null;
  qualifier: NumberObservation["qualifier"];
  /** Raw page text retained as evidence (conflicts keep it for display). */
  rawText: string | null;
  /** Usable on some numeric ranking board (value or well-formed range). */
  rankable: boolean;
  /** Usable on exact-only boards. */
  exactBoardEligible: boolean;
  /** Caffeine only: explicit zero qualifies for caffeine-free boards. */
  caffeineFreeBoardEligible: boolean;
  /** True when this verdict carries a prior trusted value forward. */
  preservePrior: boolean;
  /** True when promotion opened an incident for this field. */
  openIncident: boolean;
};

export type ServingFieldVerdict = {
  verdict: FieldVerdict;
  field: "serving";
  state: FieldState;
  value: number | null;
  unit: ServingObservation["unit"];
  /** Total-caffeine boards stay usable regardless of the serving. */
  totalCaffeineEligible: boolean;
  /** Concentration needs a published, ml-normalizable serving. */
  concentrationEligible: boolean;
  preservePrior: boolean;
  openIncident: boolean;
};

export type PromotionIncident = {
  field: "caffeine_mg" | "calories_kcal" | "sugar_g" | "serving";
  code: "unparseable" | "invalid_value" | "conflict";
  detail: string;
};

export type PromotionDecision = {
  fieldVerdicts: {
    caffeine_mg: MetricFieldVerdict;
    calories_kcal: MetricFieldVerdict;
    sugar_g: MetricFieldVerdict;
    serving: ServingFieldVerdict;
  };
  /** "quarantined" exactly when incidents were opened. */
  overall: "trusted" | "quarantined";
  incidents: PromotionIncident[];
  /** Record-level page state: "missing" preserves the prior trusted record. */
  sourceStatus: "active" | "missing";
  /** Record-level preserve flag (page missing). */
  preservePrior: boolean;
  /** The promoted trusted record (or the preserved prior one when missing). */
  record: TrustedProductRecord;
};

// ---------------------------------------------------------------------------
// Metric promotion
// ---------------------------------------------------------------------------

function isInvalidNumber(value: number | null): boolean {
  return value !== null && (!Number.isFinite(value) || value < 0);
}

function trustedPoint(
  field: MetricFieldVerdict["field"],
  unit: MetricFieldVerdict["unit"],
  metric: NormalizedCandidate["caffeineMg"],
  prior: Partial<TrustedMetricPoint> | null | undefined,
  options: { preservePrior: boolean; openIncident: boolean },
): MetricFieldVerdict {
  return {
    verdict: "preserved_prior",
    field,
    unit,
    state: metric.state,
    value: prior?.value ?? null,
    min: prior?.min ?? null,
    max: prior?.max ?? null,
    qualifier: prior?.qualifier ?? "unknown",
    rawText: metric.rawText,
    rankable: prior?.value != null || (prior?.min != null && prior?.max != null),
    exactBoardEligible: prior?.qualifier === "exact" && prior?.value != null,
    caffeineFreeBoardEligible: field === "caffeine_mg" && prior?.value === 0,
    preservePrior: options.preservePrior,
    openIncident: options.openIncident,
  };
}

function promoteMetric(
  field: MetricFieldVerdict["field"],
  unit: MetricFieldVerdict["unit"],
  metric: NormalizedCandidate["caffeineMg"],
  prior: Partial<TrustedMetricPoint> | null | undefined,
  incidents: PromotionIncident[],
): MetricFieldVerdict {
  const base = {
    field,
    unit,
    state: metric.state,
    value: metric.value,
    min: metric.min,
    max: metric.max,
    qualifier: metric.qualifier,
    rawText: metric.rawText,
    preservePrior: false,
    openIncident: false,
  };

  // Valid sparse record — not published is data about the page, not a gap.
  if (metric.state === "not_published" || metric.state === "not_applicable") {
    return {
      ...base,
      verdict: "sparse",
      value: null,
      min: null,
      max: null,
      rankable: false,
      exactBoardEligible: false,
      caffeineFreeBoardEligible: false,
    };
  }

  if (metric.state === "present") {
    // Negative or non-finite readings are parser bugs, never data (A3
    // non-negativity rule). Treat like unparseable: preserve prior + incident.
    if (isInvalidNumber(metric.value) || isInvalidNumber(metric.min) || isInvalidNumber(metric.max)) {
      const verdict = trustedPoint(field, unit, metric, prior, {
        preservePrior: true,
        openIncident: true,
      });
      incidents.push({
        field,
        code: "invalid_value",
        detail:
          `present observation carries an invalid numeric reading ` +
          `(value=${String(metric.value)}, min=${String(metric.min)}, ` +
          `max=${String(metric.max)}); prior trusted value preserved`,
      });
      return verdict;
    }

    // Explicit zero — data, rankable, and caffeine-zero is caffeine-free board
    // material.
    if (metric.value === 0) {
      return {
        ...base,
        verdict: "zero",
        rankable: true,
        exactBoardEligible: metric.qualifier === "exact",
        caffeineFreeBoardEligible: field === "caffeine_mg",
      };
    }

    // Well-formed range: displayable as a range, never on exact-only boards.
    if (
      metric.qualifier === "range" &&
      metric.min !== null &&
      metric.max !== null &&
      metric.min <= metric.max
    ) {
      return {
        ...base,
        verdict: "range",
        rankable: true,
        exactBoardEligible: false,
        caffeineFreeBoardEligible: false,
      };
    }

    // Ordinary trusted numeric value (exact, approximate, estimated).
    if (metric.value !== null) {
      return {
        ...base,
        verdict: "value",
        rankable: true,
        exactBoardEligible: metric.qualifier === "exact",
        caffeineFreeBoardEligible: false,
      };
    }

    // Present but structurally broken (no value, no range): preserve prior.
    const verdict = trustedPoint(field, unit, metric, prior, {
      preservePrior: true,
      openIncident: true,
    });
    incidents.push({
      field,
      code: "unparseable",
      detail:
        "present observation carries neither a value nor a well-formed " +
        "range; prior trusted value preserved",
    });
    return verdict;
  }

  // Conflicting: the metric is excluded everywhere; evidence (raw text) is
  // retained for display. No incident — a conflict is valid, reviewed data.
  if (metric.state === "conflicting") {
    return {
      ...base,
      verdict: "conflict",
      value: null,
      min: null,
      max: null,
      rankable: false,
      exactBoardEligible: false,
      caffeineFreeBoardEligible: false,
    };
  }

  // Unparseable: preserve the prior trusted value and open an incident.
  const verdict = trustedPoint(field, unit, metric, prior, {
    preservePrior: true,
    openIncident: true,
  });
  incidents.push({
    field,
    code: "unparseable",
    detail: prior
      ? "unparseable observation; prior trusted value preserved pending heal"
      : "unparseable observation and no prior trusted value to preserve",
  });
  return verdict;
}

// ---------------------------------------------------------------------------
// Serving promotion
// ---------------------------------------------------------------------------

function promoteServing(
  serving: NormalizedServing,
  caffeine: NormalizedCandidate["caffeineMg"],
  prior: Partial<TrustedServingPoint> | null | undefined,
  incidents: PromotionIncident[],
): ServingFieldVerdict {
  const base = {
    field: "serving" as const,
    state: serving.state,
    value: serving.value,
    unit: serving.unit,
    preservePrior: false,
    openIncident: false,
  };
  const totalCaffeineEligible = caffeine.rankable;

  // Absent / not published: total caffeine stays eligible, concentration
  // is ineligible (no volume basis). Valid sparse serving.
  if (serving.state === "not_published" || serving.state === "not_applicable") {
    return {
      ...base,
      verdict: "sparse",
      value: null,
      unit: null,
      totalCaffeineEligible,
      concentrationEligible: false,
    };
  }

  if (serving.state === "present") {
    // Published serving. Concentration additionally needs an exact caffeine
    // value and a positive ml normalization (per-item servings have none).
    return {
      ...base,
      verdict: "value",
      totalCaffeineEligible,
      concentrationEligible:
        caffeine.exactRankable &&
        serving.normalizedMl !== null &&
        serving.normalizedMl > 0,
    };
  }

  if (serving.state === "conflicting") {
    return {
      ...base,
      verdict: "conflict",
      value: null,
      unit: null,
      totalCaffeineEligible,
      concentrationEligible: false,
    };
  }

  // Unparseable serving: preserve prior, open incident.
  incidents.push({
    field: "serving",
    code: "unparseable",
    detail: prior
      ? "unparseable serving observation; prior trusted serving preserved pending heal"
      : "unparseable serving observation and no prior trusted serving to preserve",
  });
  return {
    field: "serving",
    state: serving.state,
    verdict: "preserved_prior",
    value: prior?.value ?? null,
    unit: prior?.unit ?? null,
    totalCaffeineEligible,
    concentrationEligible:
      caffeine.exactRankable &&
      (prior?.normalizedMl ?? 0) > 0,
    preservePrior: true,
    openIncident: true,
  };
}

// ---------------------------------------------------------------------------
// Promotion entry point
// ---------------------------------------------------------------------------

function toTrustedMetricPoint(verdict: MetricFieldVerdict): TrustedMetricPoint {
  return {
    state: verdict.state,
    value: verdict.value,
    min: verdict.min,
    max: verdict.max,
    qualifier: verdict.qualifier,
    unit: verdict.unit,
    rawText: verdict.rawText,
  };
}

/** Variant/flavour metrics promote as their normalized points (evidence kept). */
function normalizedToTrustedPoint(
  metric: NormalizedCandidate["caffeineMg"],
): TrustedMetricPoint {
  return {
    state: metric.state,
    value: metric.value,
    min: metric.min,
    max: metric.max,
    qualifier: metric.qualifier,
    unit: metric.unit,
    rawText: metric.rawText,
  };
}

function toTrustedServingPoint(
  candidate: NormalizedCandidate,
  verdict: ServingFieldVerdict,
): TrustedServingPoint {
  if (verdict.verdict === "preserved_prior" || verdict.verdict === "conflict") {
    return {
      state: verdict.state,
      value: verdict.value,
      unit: verdict.unit,
      form: candidate.serving.form,
      normalizedMl: candidate.serving.normalizedMl,
    };
  }
  return {
    state: candidate.serving.state,
    value: candidate.serving.value,
    unit: candidate.serving.unit,
    form: candidate.serving.form,
    normalizedMl: candidate.serving.normalizedMl,
  };
}

function toTrustedRecord(
  candidate: NormalizedCandidate,
  caffeine: MetricFieldVerdict,
  calories: MetricFieldVerdict,
  sugar: MetricFieldVerdict,
  serving: ServingFieldVerdict,
  sourceStatus: "active" | "missing",
): TrustedProductRecord {
  return {
    schemaVersion: "1.0",
    sourceId: candidate.identity.sourceId,
    slug: candidate.identity.slug,
    name: candidate.name,
    category: candidate.category,
    sourceUrl: candidate.sourceUrl,
    observedAt: candidate.observedAt,
    pageFingerprint: candidate.pageFingerprint,
    sourceLevel: candidate.sourceLevel,
    caffeineMg: toTrustedMetricPoint(caffeine),
    caloriesKcal: toTrustedMetricPoint(calories),
    sugarG: toTrustedMetricPoint(sugar),
    serving: toTrustedServingPoint(candidate, serving),
    variants: candidate.variants.map((variant) => ({
      name: variant.name,
      region: variant.region,
      availability: variant.availability,
      caffeineMg: normalizedToTrustedPoint(variant.caffeineMg),
      caloriesKcal: normalizedToTrustedPoint(variant.caloriesKcal),
      sugarG: normalizedToTrustedPoint(variant.sugarG),
      serving: {
        state: variant.serving.state,
        value: variant.serving.value,
        unit: variant.serving.unit,
        form: variant.serving.form,
        normalizedMl: variant.serving.normalizedMl,
      },
    })),
    flavours: candidate.flavours.map((flavour) => ({
      name: flavour.name,
      availability: flavour.availability,
      caffeineRelation: flavour.caffeineRelation,
      caffeineMg: normalizedToTrustedPoint(flavour.caffeineMg),
    })),
    sourceStatus,
  };
}

/**
 * Decide the field-level promotion of one normalized candidate.
 * Deterministic: same candidate and context in, same decision out.
 */
export function promoteCandidate(
  candidate: NormalizedCandidate,
  context: PromoteContext = {},
): PromotionDecision {
  const incidents: PromotionIncident[] = [];
  const prior = context.previousTrusted ?? null;

  const caffeine = promoteMetric(
    "caffeine_mg",
    "mg",
    candidate.caffeineMg,
    prior?.caffeineMg,
    incidents,
  );
  const calories = promoteMetric(
    "calories_kcal",
    "kcal",
    candidate.caloriesKcal,
    prior?.caloriesKcal,
    incidents,
  );
  const sugar = promoteMetric(
    "sugar_g",
    "g",
    candidate.sugarG,
    prior?.sugarG,
    incidents,
  );
  const serving = promoteServing(
    candidate.serving,
    candidate.caffeineMg,
    prior?.serving,
    incidents,
  );

  // Page missing: preserve the prior trusted record and mark the source.
  const pageMissing = context.pageMissing === true;
  const sourceStatus: "active" | "missing" = pageMissing ? "missing" : "active";

  return {
    fieldVerdicts: {
      caffeine_mg: caffeine,
      calories_kcal: calories,
      sugar_g: sugar,
      serving,
    },
    overall: incidents.length > 0 ? "quarantined" : "trusted",
    incidents,
    sourceStatus,
    preservePrior: pageMissing,
    record: toTrustedRecord(candidate, caffeine, calories, sugar, serving, sourceStatus),
  };
}
