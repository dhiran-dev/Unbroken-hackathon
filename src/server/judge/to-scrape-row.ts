/**
 * Judge cockpit — collector record → ProductScrapeRowV1 mapping (Agent A12).
 *
 * Maps one Bright Data Scraper Studio product record (the shape produced by
 * collector `c_mt2yacvcyvyvim56d`, see docs/handoffs/A2-collector.md) onto the
 * PulseRank V1 scrape-row contract (src/domain/product/contracts).
 *
 * Mapping rules (all honest, none invented):
 * - Fields the collector does not publish (calories, sugar, ingredients,
 *   variants, flavours, page title) are mapped as `not_published` per the V1
 *   contract — sparse is data about the page, never a fabricated value.
 * - The collector publishes TWO independent caffeine figures:
 *   `caffeine_mg_per_serving` and `caffeine_mg_per_100ml`. When a serving
 *   volume in ml is available, the per-100ml figure implies
 *   `implied = mg_per_100ml × ml / 100`. When the two figures agree within a
 *   documented tolerance (5% relative or 1 mg absolute — the published
 *   per-100ml value itself carries only 2 decimal places of precision), the
 *   row maps caffeine as `present`/exact with both readings kept in
 *   `candidates`. When they disagree (the 72250-vs-71.975 unit bug), the row
 *   maps caffeine as `conflicting` with both candidates retained as evidence —
 *   the contract's representation for "independent source values disagree".
 * - `observedAt` comes from the artifact file mtime supplied by the caller
 *   (the collector envelope carries no timestamp). This module stays pure:
 *   no clock reads, no fs access.
 * - `pageFingerprint` is derived (sha256 over the stable record content) and
 *   labelled as such; it fingerprints THIS record, not the source page HTML.
 */

import { createHash } from "node:crypto";

import type { FieldState } from "@/domain/product/contracts/field-states";
import type {
  NumberObservation,
  ServingObservation,
} from "@/domain/product/contracts/observations";
import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";

/** The PulseRank collector identity permitted in runtime code. */
export const JUDGE_COLLECTOR_ID = "c_mt2yacvcyvyvim56d";

/**
 * Tolerance for the two published caffeine figures to count as agreeing.
 * The per-100ml figure is published rounded to 2 decimals, so an absolute
 * slack of 1 mg plus 5% relative slack absorbs pure rounding noise while
 * still separating it cleanly from the ~1000× unit bug.
 */
export const UNIT_CONSISTENCY_ABS_TOL_MG = 1;
export const UNIT_CONSISTENCY_REL_TOL = 0.05;

/** Raw shape of one Bright Data collector product record (plus input echo). */
export type CollectorProductRecord = {
  product_name?: unknown;
  brand?: unknown;
  beverage_type?: unknown;
  serving_size?: unknown;
  caffeine_mg_per_serving?: unknown;
  caffeine_mg_per_100ml?: unknown;
  caffeine_strength_level?: unknown;
  input?: unknown;
};

export type ToScrapeRowOptions = {
  /** ISO-8601 observation time (artifact file mtime), supplied by caller. */
  observedAt: string;
  /** Collector id recorded into the extraction block. */
  collectorId?: string;
  /** Template family recorded into the extraction block. */
  templateFamily?: string | null;
};

// ---------------------------------------------------------------------------
// Small honest parsers
// ---------------------------------------------------------------------------

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const SOURCE_LEVELS = new Set([
  "caffeine_free",
  "low",
  "moderate",
  "high",
  "very_high",
  "extreme",
]);

/** "MODERATE" / "Very High" → contract source level; anything else unknown. */
function toSourceLevel(value: unknown): ProductScrapeRowV1["primary"]["sourceLevel"] {
  const raw = asString(value);
  if (raw === null) return "unknown";
  const normalized = raw.toLowerCase().replace(/[\s-]+/g, "_");
  return SOURCE_LEVELS.has(normalized)
    ? (normalized as ProductScrapeRowV1["primary"]["sourceLevel"])
    : "unknown";
}

type ParsedServing = {
  value: number;
  unit: NonNullable<ServingObservation["unit"]>;
  rawText: string;
};

const SERVING_UNIT_PATTERNS: ReadonlyArray<{
  unit: NonNullable<ServingObservation["unit"]>;
  pattern: RegExp;
}> = [
  { unit: "fl_oz", pattern: /^(?:fl\.?\s*oz|fluid\s*ounces?)$/i },
  { unit: "ml", pattern: /^(?:ml|millilit(?:er|re)s?)$/i },
  { unit: "g", pattern: /^(?:g|grams?)$/i },
  { unit: "cup", pattern: /^cups?$/i },
  { unit: "can", pattern: /^cans?$/i },
  { unit: "bottle", pattern: /^bottles?$/i },
  { unit: "shot", pattern: /^shots?$/i },
  { unit: "mint", pattern: /^mints?$/i },
  { unit: "candy", pattern: /^cand(?:y|ies)$/i },
  { unit: "gum_piece", pattern: /^(?:gum(?:\s*pieces?)?|pieces?)$/i },
  { unit: "tablet", pattern: /^tablets?$/i },
  { unit: "packet", pattern: /^packets?$/i },
  { unit: "oz", pattern: /^(?:oz|ounces?)$/i },
];

/** Parse "250 ml" / "8.4 fl oz" into a bounded serving reading. */
export function parseServingSize(raw: unknown): ParsedServing | null {
  const text = asString(raw);
  if (text === null) return null;
  const match = /^([0-9]+(?:\.[0-9]+)?)\s*(.+)$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const unitText = match[2]?.trim() ?? "";
  for (const { unit, pattern } of SERVING_UNIT_PATTERNS) {
    if (pattern.test(unitText)) {
      return { value, unit, rawText: text };
    }
  }
  return { value, unit: "unknown", rawText: text };
}

const ML_PER_FL_OZ = 29.5735295625;

function normalizedMlFor(serving: ParsedServing | null): number | null {
  if (serving === null) return null;
  if (serving.unit === "ml") return serving.value;
  if (serving.unit === "fl_oz") return serving.value * ML_PER_FL_OZ;
  return null;
}

/** `/caffeine-content/sting` → `sting`; falls back to last path segment. */
export function slugFromCollectorUrl(value: unknown): string {
  const raw = asString(value);
  if (raw === null) return "unknown";
  try {
    const url = new URL(raw);
    const segments = url.pathname.split("/").filter((segment) => segment !== "");
    const last = segments.at(-1);
    if (last !== undefined && last !== "") return last;
    return url.hostname;
  } catch {
    return "unknown";
  }
}

function notPublishedNumber(): NumberObservation {
  return {
    state: "not_published",
    value: null,
    min: null,
    max: null,
    qualifier: "unknown",
    rawText: null,
    candidates: [],
  };
}

// ---------------------------------------------------------------------------
// Caffeine mapping with the two-figure consistency rule
// ---------------------------------------------------------------------------

export type UnitConsistencyCheck = {
  /** Published mg-per-serving reading (null when absent/unparseable). */
  perServingMg: number | null;
  /** Value implied by the published mg-per-100ml × serving volume. */
  impliedPerServingMg: number | null;
  /** True when both figures exist and agree within the documented tolerance. */
  consistent: boolean | null;
};

export function checkUnitConsistency(
  record: CollectorProductRecord,
  servingMl: number | null,
): UnitConsistencyCheck {
  const perServingMg = asFiniteNumber(record.caffeine_mg_per_serving);
  const per100ml = asFiniteNumber(record.caffeine_mg_per_100ml);
  const impliedPerServingMg =
    per100ml !== null && servingMl !== null ? (per100ml * servingMl) / 100 : null;
  let consistent: boolean | null = null;
  if (perServingMg !== null && impliedPerServingMg !== null) {
    const tolerance = Math.max(
      UNIT_CONSISTENCY_ABS_TOL_MG,
      UNIT_CONSISTENCY_REL_TOL * Math.abs(impliedPerServingMg),
    );
    consistent = Math.abs(perServingMg - impliedPerServingMg) <= tolerance;
  }
  return { perServingMg, impliedPerServingMg, consistent };
}

function mapCaffeine(
  record: CollectorProductRecord,
  servingMl: number | null,
): { observation: NumberObservation; consistency: UnitConsistencyCheck } {
  const consistency = checkUnitConsistency(record, servingMl);
  const perServingMg = asFiniteNumber(record.caffeine_mg_per_serving);

  // Not published at all — valid sparse field.
  if (
    record.caffeine_mg_per_serving === undefined ||
    record.caffeine_mg_per_serving === null ||
    (asString(record.caffeine_mg_per_serving) === null && perServingMg === null)
  ) {
    return {
      observation: notPublishedNumber(),
      consistency,
    };
  }

  // Published but not a finite number — unparseable extraction.
  if (perServingMg === null) {
    return {
      observation: {
        state: "unparseable",
        value: null,
        min: null,
        max: null,
        qualifier: "unknown",
        rawText: String(record.caffeine_mg_per_serving),
        candidates: [],
      },
      consistency,
    };
  }

  const implied = consistency.impliedPerServingMg;
  const candidates =
    implied !== null ? [perServingMg, implied] : [perServingMg];

  // Two published figures disagree beyond tolerance — conflicting evidence.
  if (consistency.consistent === false) {
    return {
      observation: {
        state: "conflicting",
        value: null,
        min: null,
        max: null,
        qualifier: "unknown",
        rawText: null,
        candidates,
      },
      consistency,
    };
  }

  // Consistent (or single-figure) exact reading.
  return {
    observation: {
      state: "present",
      value: perServingMg,
      min: null,
      max: null,
      qualifier: "exact",
      rawText: null,
      candidates,
    },
    consistency,
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function stableRecordJson(record: CollectorProductRecord): string {
  return JSON.stringify(record, Object.keys(record).sort());
}

export function toScrapeRow(
  record: CollectorProductRecord,
  options: ToScrapeRowOptions,
): ProductScrapeRowV1 {
  const serving = parseServingSize(record.serving_size);
  const servingNormalizedMl = normalizedMlFor(serving);
  const { observation: caffeineMg, consistency } = mapCaffeine(record, servingNormalizedMl);

  const url = asString(
    (record.input !== null && typeof record.input === "object"
      ? (record.input as { url?: unknown }).url
      : undefined) ?? undefined,
  );
  const warnings: string[] = [];
  if (consistency.consistent === false) {
    warnings.push(
      `collector caffeine figures disagree: caffeine_mg_per_serving=${String(
        consistency.perServingMg,
      )} vs caffeine_mg_per_100ml implying ${String(consistency.impliedPerServingMg)} mg per serving`,
    );
  }

  const servingObservation: ServingObservation = serving
    ? {
        state: "present",
        value: serving.value,
        unit: serving.unit,
        form: serving.unit === "ml" || serving.unit === "fl_oz" ? "drink" : "item",
        normalizedMl: servingNormalizedMl,
        rawText: serving.rawText,
      }
    : {
        state: "not_published",
        value: null,
        unit: null,
        form: "unknown",
        normalizedMl: null,
        rawText: null,
      };

  const fingerprintInput = stableRecordJson(record);
  const pageFingerprint = `sha256:${createHash("sha256").update(fingerprintInput).digest("hex")}`;

  return {
    schemaVersion: "1.0",
    source: {
      sourceId: "caffeine-informer",
      url: url ?? "https://www.caffeineinformer.com/",
      slug: slugFromCollectorUrl(url),
      observedAt: options.observedAt,
      pageFingerprint,
    },
    identity: {
      name: asString(record.product_name) ?? "",
      categoryLabel: asString(record.beverage_type),
      pageTitle: null,
    },
    primary: {
      caffeineMg,
      sourceLevel: toSourceLevel(record.caffeine_strength_level),
      serving: servingObservation,
      caloriesKcal: notPublishedNumber(),
      sugarG: notPublishedNumber(),
    },
    variants: [],
    flavours: [],
    ingredients: {
      state: "not_published" satisfies FieldState,
      text: null,
      appliesTo: null,
    },
    media: {
      imageUrl: null,
      publicationState: "audit_only",
    },
    evidence: {
      sectionsPresent: [],
      sourceLinks: [],
      warnings,
    },
    extraction: {
      collectorId: options.collectorId ?? JUDGE_COLLECTOR_ID,
      collectionId: null,
      templateFamily: options.templateFamily ?? "caffeine-pdp",
      parserVersion: "brightdata-scraper-template",
    },
  };
}
