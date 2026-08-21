/**
 * PulseRank ingestion — deterministic normalization (Agent A5).
 *
 * ProductScrapeRowV1 -> NormalizedCandidate.
 *
 * Pure function mandate (A5): no database access, no network access, no clock
 * reads. Every value below is a pure function of its input; identical input
 * always yields identical output.
 *
 * Rules implemented (PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §"Agent A5",
 * deterministic normalization step):
 * - Slug identity is stable: `{ sourceId, slug }` identifies a product across
 *   runs; the slug is never rewritten here.
 * - `identity.categoryLabel` free text is mapped onto the canonical category
 *   set energy-drink | energy-shot | coffee | tea | soda | water | food | gum
 *   | other. Unmatched or null labels fall through to "other".
 * - Concentration (`mgPer100Ml`) is computed ONLY when primary caffeine is an
 *   exact, finite, non-negative value AND the serving carries a positive
 *   normalizedMl. Ranges, estimates, approximations, conflicts, and per-item
 *   servings never produce a concentration number.
 * - Per-field ranking eligibility flags are derived per the promotion table:
 *   ranges stay range-displayable but never rank on exact-only boards;
 *   conflicts rank nowhere; sparse fields are valid data, not failures.
 */

import type { FieldState } from "@/domain/product/contracts/field-states";
import type {
  NumberObservation,
  ServingObservation,
} from "@/domain/product/contracts/observations";
import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";

// ---------------------------------------------------------------------------
// Canonical categories
// ---------------------------------------------------------------------------

export const CANONICAL_CATEGORIES = [
  "energy-drink",
  "energy-shot",
  "coffee",
  "tea",
  "soda",
  "water",
  "food",
  "gum",
  "other",
] as const;

export type CanonicalCategory = (typeof CANONICAL_CATEGORIES)[number];

/**
 * Ordered keyword rules. First match wins; order is part of the contract so
 * "Energy Shots" resolves to energy-shot before the generic energy rule and
 * "Caffeinated Gum" to gum regardless of other keywords. All matching runs
 * against a lowercased label with word boundaries.
 */
const CATEGORY_RULES_FINAL: ReadonlyArray<{
  category: CanonicalCategory;
  patterns: readonly RegExp[];
}> = [
  { category: "gum", patterns: [/\bgums?\b/] },
  { category: "energy-shot", patterns: [/\bshots?\b/] },
  { category: "water", patterns: [/\bwaters?\b/] },
  { category: "tea", patterns: [/\bteas?\b/, /\biced tea\b/] },
  {
    category: "coffee",
    patterns: [
      /\bcoffees?\b/,
      /\bespresso\b/,
      /\blatte\b/,
      /\bmocha\b/,
      /\bcappuccino\b/,
      /cold brew/,
    ],
  },
  {
    category: "food",
    patterns: [
      /\bcand(?:y|ies)\b/,
      /\bmints?\b/,
      /chocolate/,
      /\bcocoa\b/,
      /\bsnacks?\b/,
      /dessert/,
      /ice cream/,
      /\bjerky\b/,
      /peanut butter/,
      /\bfoods?\b/,
    ],
  },
  {
    category: "soda",
    patterns: [/\bsodas?\b/, /soft drinks?/, /\bcolas?\b/],
  },
  { category: "energy-drink", patterns: [/energy drinks?/, /\benergy\b/] },
];

/** Deterministic mapping of a raw category label onto the canonical set. */
export function normalizeCategoryLabel(
  label: string | null,
): CanonicalCategory {
  if (label === null) return "other";
  const normalized = label.toLowerCase();
  if (normalized.trim() === "") return "other";
  for (const rule of CATEGORY_RULES_FINAL) {
    for (const pattern of rule.patterns) {
      if (pattern.test(normalized)) return rule.category;
    }
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Normalized shapes
// ---------------------------------------------------------------------------

export type MetricFieldName = "caffeine_mg" | "calories_kcal" | "sugar_g";

export type NormalizedMetricField = {
  field: MetricFieldName;
  unit: "mg" | "kcal" | "g";
  state: FieldState;
  value: number | null;
  min: number | null;
  max: number | null;
  qualifier: NumberObservation["qualifier"];
  /** Raw page text preserved as evidence; never altered by normalization. */
  rawText: string | null;
  /** Usable on some ranking board (numeric value or well-formed range). */
  rankable: boolean;
  /** Qualifies for exact-only boards (exact numeric values only). */
  exactRankable: boolean;
};

export type NormalizedServing = {
  state: FieldState;
  value: number | null;
  unit: ServingObservation["unit"];
  form: ServingObservation["form"];
  normalizedMl: number | null;
};

export type ConcentrationResult = {
  mgPer100Ml: number | null;
  basis:
    | "computed"
    | "no_exact_caffeine"
    | "no_normalized_ml"
    | "non_positive_serving_ml";
};

export type NormalizedVariant = {
  name: string;
  region: string | null;
  availability: ProductScrapeRowV1["variants"][number]["availability"];
  caffeineMg: NormalizedMetricField;
  caloriesKcal: NormalizedMetricField;
  sugarG: NormalizedMetricField;
  serving: NormalizedServing;
};

export type NormalizedFlavour = {
  name: string;
  availability: ProductScrapeRowV1["flavours"][number]["availability"];
  caffeineRelation: ProductScrapeRowV1["flavours"][number]["caffeineRelation"];
  evidence: ProductScrapeRowV1["flavours"][number]["evidence"];
  caffeineMg: NormalizedMetricField;
};

export type NormalizedCandidate = {
  schemaVersion: "1.0";
  identity: {
    sourceId: ProductScrapeRowV1["source"]["sourceId"];
    slug: string;
  };
  name: string;
  pageTitle: string | null;
  /** Original free-text category label, preserved as evidence. */
  categoryLabel: string | null;
  category: CanonicalCategory;
  sourceUrl: string;
  observedAt: string;
  pageFingerprint: string;
  caffeineMg: NormalizedMetricField;
  caloriesKcal: NormalizedMetricField;
  sugarG: NormalizedMetricField;
  sourceLevel: ProductScrapeRowV1["primary"]["sourceLevel"];
  serving: NormalizedServing;
  concentration: ConcentrationResult;
  variants: NormalizedVariant[];
  flavours: NormalizedFlavour[];
};

// ---------------------------------------------------------------------------
// Metric normalization
// ---------------------------------------------------------------------------

function normalizeMetric(
  field: MetricFieldName,
  unit: NormalizedMetricField["unit"],
  observation: NumberObservation,
): NormalizedMetricField {
  const state = observation.state;
  const hasExactValue =
    state === "present" &&
    observation.value !== null &&
    Number.isFinite(observation.value);
  const hasWellFormedRange =
    state === "present" &&
    observation.qualifier === "range" &&
    observation.min !== null &&
    observation.max !== null &&
    observation.min <= observation.max;

  return {
    field,
    unit,
    state,
    value: hasExactValue ? observation.value : null,
    min: observation.min,
    max: observation.max,
    qualifier: observation.qualifier,
    rawText: observation.rawText,
    // Conflicting, unparseable, sparse, and structurally broken observations
    // are never rankable; a clean number or a min<=max range is.
    rankable: hasExactValue || hasWellFormedRange,
    exactRankable: hasExactValue && observation.qualifier === "exact",
  };
}

function normalizeServing(serving: ServingObservation): NormalizedServing {
  return {
    state: serving.state,
    value: serving.value,
    unit: serving.unit,
    form: serving.form,
    normalizedMl: serving.normalizedMl,
  };
}

/**
 * mg per 100 ml — computed ONLY when caffeine is an exact finite non-negative
 * value AND the serving normalizes to a positive volume in ml. Rounded to one
 * decimal place deterministically (half away from zero via Math.round on the
 * scaled value).
 */
export function computeConcentration(
  caffeine: NormalizedMetricField,
  serving: NormalizedServing,
): ConcentrationResult {
  if (!caffeine.exactRankable || caffeine.value === null) {
    return { mgPer100Ml: null, basis: "no_exact_caffeine" };
  }
  if (serving.normalizedMl === null) {
    return { mgPer100Ml: null, basis: "no_normalized_ml" };
  }
  if (!(serving.normalizedMl > 0)) {
    return { mgPer100Ml: null, basis: "non_positive_serving_ml" };
  }
  const raw = (caffeine.value / serving.normalizedMl) * 100;
  return { mgPer100Ml: Math.round(raw * 10) / 10, basis: "computed" };
}

function normalizeVariant(variant: ProductScrapeRowV1["variants"][number]): NormalizedVariant {
  return {
    name: variant.name,
    region: variant.region,
    availability: variant.availability,
    caffeineMg: normalizeMetric("caffeine_mg", "mg", variant.caffeineMg),
    caloriesKcal: normalizeMetric("calories_kcal", "kcal", variant.caloriesKcal),
    sugarG: normalizeMetric("sugar_g", "g", variant.sugarG),
    serving: normalizeServing(variant.serving),
  };
}

function normalizeFlavour(flavour: ProductScrapeRowV1["flavours"][number]): NormalizedFlavour {
  return {
    name: flavour.name,
    availability: flavour.availability,
    caffeineRelation: flavour.caffeineRelation,
    evidence: flavour.evidence,
    caffeineMg: normalizeMetric("caffeine_mg", "mg", flavour.caffeineMg),
  };
}

/**
 * Normalize one contract-valid scrape row into a candidate.
 * Deterministic: same row in, same candidate out.
 */
export function normalizeRow(row: ProductScrapeRowV1): NormalizedCandidate {
  const caffeineMg = normalizeMetric(
    "caffeine_mg",
    "mg",
    row.primary.caffeineMg,
  );
  const caloriesKcal = normalizeMetric(
    "calories_kcal",
    "kcal",
    row.primary.caloriesKcal,
  );
  const sugarG = normalizeMetric("sugar_g", "g", row.primary.sugarG);
  const serving = normalizeServing(row.primary.serving);

  return {
    schemaVersion: row.schemaVersion,
    identity: {
      sourceId: row.source.sourceId,
      slug: row.source.slug,
    },
    name: row.identity.name,
    pageTitle: row.identity.pageTitle,
    categoryLabel: row.identity.categoryLabel,
    category: normalizeCategoryLabel(row.identity.categoryLabel),
    sourceUrl: row.source.url,
    observedAt: row.source.observedAt,
    pageFingerprint: row.source.pageFingerprint,
    caffeineMg,
    caloriesKcal,
    sugarG,
    sourceLevel: row.primary.sourceLevel,
    serving,
    concentration: computeConcentration(caffeineMg, serving),
    variants: row.variants.map(normalizeVariant),
    flavours: row.flavours.map(normalizeFlavour),
  };
}
