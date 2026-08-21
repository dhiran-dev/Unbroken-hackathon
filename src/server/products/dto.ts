/**
 * PulseRank public API — pure DTO mappers (Agent A8).
 *
 * Maps a trusted product observation row onto the published
 * `PublicProductDto`. Pure functions only: no database access, no network,
 * no clock reads — identical input always yields identical output.
 *
 * Plan reference: PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §"Agent A8 —
 * Public API → DTO rules":
 * - trusted records only (the caller feeds rows obtained through
 *   `queries.ts`, which follows `products.current_trusted_observation_id`
 *   and additionally constrains `product_observations.status = 'trusted'`;
 *   candidate/quarantined/rejected rows are unreachable by construction),
 * - explicit field states preserved verbatim — a sparse field stays
 *   `not_published`, an explicit zero stays `0` with state `present`
 *   (never coerced between the two),
 * - source observation time surfaced as `observedAt`,
 * - ranking eligibility with machine-readable reasons,
 * - source attribution on every record,
 * - field-publication policy enforced here (extended nutrition fields are
 *   gated behind `PULSERANK_PUBLIC_EXTENDED_FIELDS`),
 * - no long raw source text (`rawText` never leaves the server),
 * - no audit-only image URL (images surface only when the stored
 *   publication state is `allowed`).
 */

import { pulserankServerFlags } from "@/config/pulserank-flags";
import type { CanonicalCategory, ConcentrationResult } from "@/server/ingestion/normalize";
import type {
  TrustedMetricPoint,
  TrustedProductRecord,
} from "@/server/ingestion/promote";

/** Fixed public attribution for the single registered upstream source. */
export const SOURCE_ATTRIBUTION = "Caffeine Informer";

/** Current public schema version reported by every endpoint. */
export const PUBLIC_SCHEMA_VERSION = "1.0";

// ---------------------------------------------------------------------------
// Stored trusted-record shapes (what the ingestion writer persists)
// ---------------------------------------------------------------------------

/** Media block carried by a trusted observation (from the scrape row's media). */
export type TrustedMediaBlock = {
  imageUrl: string | null;
  publicationState: "audit_only" | "allowed" | "blocked";
};

/**
 * The exact jsonb payload the ingestion writer (A7) persists into
 * `pulse.product_observations.normalized` for `status = 'trusted'` rows: the
 * promoted trusted record (A5 `TrustedProductRecord`) plus the two derived
 * blocks the public DTO needs (concentration result and media publication
 * state).
 */
export type TrustedObservationPayload = TrustedProductRecord & {
  /** Optional for legacy trusted rows written before derived blocks existed. */
  concentration?: ConcentrationResult | null;
  /** Optional for legacy trusted rows; absent media is never publishable. */
  media?: TrustedMediaBlock | null;
};

/** One trusted product row as handed from `queries.ts` to the mappers. */
export type TrustedProductRow = {
  product: {
    slug: string;
    name: string;
    categoryLabel: string | null;
  };
  observation: {
    id: string;
    /** Fallback timestamp; the payload's own observedAt wins when present. */
    observedAt: Date;
    status: string;
  };
  payload: TrustedObservationPayload;
};

// ---------------------------------------------------------------------------
// Public DTO shapes
// ---------------------------------------------------------------------------

export type PublicCaffeineDto = {
  /**
   * Point caffeine value in mg. Null for ranges and non-numeric states — a
   * range is never silently coerced to a point value.
   */
  mg: number | null;
  /** Range bounds; non-null only when the qualifier is `range`. */
  min: number | null;
  max: number | null;
  /** Verbatim qualifier passthrough: exact | range | approximate | estimated | unknown. */
  qualifier: TrustedMetricPoint["qualifier"];
  /** Extraction state is published so sparse/conflicting values remain explicit. */
  state: TrustedMetricPoint["state"];
  /** Source-level band as published by the upstream source. */
  sourceLevel: TrustedProductRecord["sourceLevel"];
};

export type PublicServingDto = {
  value: number | null;
  unit: TrustedProductRecord["serving"]["unit"];
  form: TrustedProductRecord["serving"]["form"];
  state: TrustedProductRecord["serving"]["state"];
};

export type PublicConcentrationDto = {
  /** mg per 100 ml — a number ONLY when eligible (exact caffeine + ml volume). */
  mgPer100Ml: number | null;
};

export type PublicCaloriesDto = {
  /** Explicit zero stays 0; sparse/unparseable stay null with their state. */
  kcal: number | null;
  state: TrustedMetricPoint["state"];
};

export type PublicSugarDto = {
  /** Explicit zero stays 0; sparse/unparseable stay null with their state. */
  g: number | null;
  state: TrustedMetricPoint["state"];
};

export type PublicRankingEligibilityDto = {
  /** Usable on total-caffeine boards (point value or well-formed range). */
  totalCaffeine: boolean;
  /** Usable for concentration (needs EXACT caffeine plus positive ml volume). */
  concentration: boolean;
  /** Machine-readable exclusion reasons; empty when fully eligible. */
  reasons: string[];
};

export type PublicProductDto = {
  slug: string;
  name: string;
  category: CanonicalCategory;
  caffeine: PublicCaffeineDto;
  serving: PublicServingDto;
  concentration: PublicConcentrationDto;
  /** Source observation time (ISO 8601). */
  observedAt: string;
  rankingEligibility: PublicRankingEligibilityDto;
  /**
   * Image URL only when the stored media publication state is `allowed`;
   * `audit_only`/`blocked` media always suppresses to null.
   */
  image: string | null;
  sourceAttribution: typeof SOURCE_ATTRIBUTION;
  /** Canonical source page for provenance; raw page text is never exposed. */
  sourceUrl: string;
  /** Extended nutrition fields — present only when extended fields are enabled. */
  calories?: PublicCaloriesDto;
  sugar?: PublicSugarDto;
};

export type ToPublicProductDtoOptions = {
  /**
   * Override for the `PULSERANK_PUBLIC_EXTENDED_FIELDS` gate. When omitted,
   * the server flag decides. Tests pass this explicitly.
   */
  extendedFields?: boolean;
};

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

function isFiniteNumber(value: number | null | undefined): value is number {
  return value !== null && Number.isFinite(value);
}

/** True when the trusted point carries a well-formed min <= max range. */
function isWellFormedRange(point: TrustedMetricPoint): boolean {
  return (
    point.qualifier === "range" &&
    isFiniteNumber(point.min) &&
    isFiniteNumber(point.max) &&
    point.min <= point.max
  );
}

function concentrationCaffeineSideEligible(caffeine: TrustedMetricPoint): boolean {
  return (
    caffeine.state === "present" &&
    caffeine.qualifier === "exact" &&
    isFiniteNumber(caffeine.value) &&
    caffeine.value >= 0
  );
}

/**
 * Concentration eligibility, re-derived independently of the stored block so
 * a buggy writer can never leak an unearned number: EXACT finite non-negative
 * caffeine value AND a positive ml-normalized serving volume. Ranges,
 * approximations, estimates, conflicts, and per-item servings never produce a
 * concentration figure.
 */
function concentrationEligible(
  caffeine: TrustedMetricPoint,
  serving: TrustedProductRecord["serving"],
): boolean {
  return (
    concentrationCaffeineSideEligible(caffeine) &&
    isFiniteNumber(serving.normalizedMl) &&
    serving.normalizedMl > 0
  );
}

/**
 * Point value for display: exact/approximate/estimated/zero values pass
 * through; a range NEVER collapses into `mg` (bounds ride along instead).
 */
function displayMg(point: TrustedMetricPoint): number | null {
  if (point.qualifier === "range" || isWellFormedRange(point)) return null;
  return isFiniteNumber(point.value) ? point.value : null;
}

function mapCaffeine(payload: TrustedObservationPayload): PublicCaffeineDto {
  const point = payload.caffeineMg;
  const range = point.qualifier === "range" && isWellFormedRange(point);
  return {
    mg: displayMg(point),
    min: range ? point.min : null,
    max: range ? point.max : null,
    qualifier: point.qualifier,
    state: point.state,
    sourceLevel: payload.sourceLevel,
  };
}

function mapServing(payload: TrustedObservationPayload): PublicServingDto {
  const serving = payload.serving;
  return {
    value: isFiniteNumber(serving.value) ? serving.value : null,
    unit: serving.unit,
    form: serving.form,
    state: serving.state,
  };
}

/**
 * Sparse states are preserved AS STATES — never flattened to zero, and an
 * explicit published zero stays a zero with state `present`.
 */
function mapExtendedMetric(point: TrustedMetricPoint): {
  value: number | null;
  state: TrustedMetricPoint["state"];
} {
  const value =
    point.state === "present" && isFiniteNumber(point.value) ? point.value : null;
  return { value, state: point.state };
}

function mapRankingEligibility(
  payload: TrustedObservationPayload,
): PublicRankingEligibilityDto {
  const caffeine = payload.caffeineMg;
  const serving = payload.serving;
  const reasons: string[] = [];

  const totalCaffeine =
    (caffeine.state === "present" && isFiniteNumber(caffeine.value)) ||
    isWellFormedRange(caffeine);

  if (!totalCaffeine) {
    switch (caffeine.state) {
      case "conflicting":
        reasons.push("caffeine_conflicting_excluded");
        break;
      case "not_published":
      case "not_applicable":
        reasons.push("caffeine_sparse");
        break;
      case "unparseable":
        reasons.push("caffeine_unparseable");
        break;
      case "present":
        reasons.push("caffeine_no_usable_value");
        break;
    }
  }

  if (!concentrationEligible(caffeine, serving)) {
    reasons.push(
      concentrationCaffeineSideEligible(caffeine)
        ? "concentration_requires_ml_volume"
        : "concentration_requires_exact_caffeine",
    );
  }

  return { totalCaffeine, concentration: concentrationEligible(caffeine, serving), reasons };
}

function mapImage(media: TrustedMediaBlock | null | undefined): string | null {
  return media?.publicationState === "allowed" ? media.imageUrl : null;
}

/**
 * Read the stored concentration when present, but repair legacy rows that
 * predate the derived block from the same exact caffeine + ml inputs. The
 * eligibility check remains the authority, so sparse/range/conflicting rows
 * can never gain a concentration number through this fallback.
 */
function mapConcentration(payload: TrustedObservationPayload): number | null {
  if (!concentrationEligible(payload.caffeineMg, payload.serving)) return null;

  const stored = payload.concentration?.mgPer100Ml;
  if (isFiniteNumber(stored)) return stored;

  const caffeine = payload.caffeineMg.value;
  const servingMl = payload.serving.normalizedMl;
  if (!isFiniteNumber(caffeine) || !isFiniteNumber(servingMl) || servingMl <= 0) {
    return null;
  }
  return Math.round((caffeine / servingMl) * 1000) / 10;
}

function resolveObservedAt(row: TrustedProductRow): string {
  const fromPayload = row.payload.observedAt;
  if (typeof fromPayload === "string" && fromPayload.trim() !== "") {
    return fromPayload;
  }
  return row.observation.observedAt.toISOString();
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * Map one trusted product row onto the public DTO.
 *
 * Pure: same row in, same DTO out. Extended nutrition fields (calories,
 * sugar) are emitted ONLY when `PULSERANK_PUBLIC_EXTENDED_FIELDS` is enabled
 * (or overridden via options); when disabled the keys are omitted entirely,
 * not nulled.
 */
export function toPublicProductDto(
  row: TrustedProductRow,
  options: ToPublicProductDtoOptions = {},
): PublicProductDto {
  const payload = row.payload;
  const extendedFields =
    options.extendedFields ?? pulserankServerFlags.publicExtendedFields;

  const dto: PublicProductDto = {
    slug: row.product.slug,
    name: row.product.name,
    category: payload.category,
    caffeine: mapCaffeine(payload),
    serving: mapServing(payload),
    concentration: {
      mgPer100Ml: mapConcentration(payload),
    },
    observedAt: resolveObservedAt(row),
    rankingEligibility: mapRankingEligibility(payload),
    image: mapImage(payload.media),
    sourceAttribution: SOURCE_ATTRIBUTION,
    sourceUrl: payload.sourceUrl,
  };

  if (extendedFields) {
    const calories = mapExtendedMetric(payload.caloriesKcal);
    const sugar = mapExtendedMetric(payload.sugarG);
    dto.calories = { kcal: calories.value, state: calories.state };
    dto.sugar = { g: sugar.value, state: sugar.state };
  }

  return dto;
}
