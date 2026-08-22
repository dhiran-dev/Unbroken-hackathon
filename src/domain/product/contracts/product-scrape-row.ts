/**
 * PulseRank V1 product scrape row.
 *
 * Source of truth: PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §8.5 (copied verbatim).
 *
 * PROVISIONAL contract: frozen only at G3, pending the A1 page-shape matrix and
 * real A2 collector output. See docs/handoffs/A3-contract.md.
 */

import type { FieldState } from "./field-states";
import type { NumberObservation, ServingObservation } from "./observations";

export type ProductScrapeRowV1 = {
  schemaVersion: "1.0";

  source: {
    sourceId: "caffeine-informer";
    url: string;
    slug: string;
    observedAt: string;
    pageFingerprint: string;
  };

  identity: {
    name: string;
    categoryLabel: string | null;
    categoryProvenance?: "source_listing" | "source_pdp" | "legacy_broad";
    pageTitle: string | null;
  };

  primary: {
    caffeineMg: NumberObservation;
    sourceLevel:
      | "caffeine_free"
      | "low"
      | "moderate"
      | "high"
      | "very_high"
      | "extreme"
      | "unknown";
    serving: ServingObservation;
    caloriesKcal: NumberObservation;
    sugarG: NumberObservation;
  };

  variants: Array<{
    name: string;
    caffeineMg: NumberObservation;
    serving: ServingObservation;
    caloriesKcal: NumberObservation;
    sugarG: NumberObservation;
    region: string | null;
    availability: "listed" | "appears_inactive" | "explicitly_discontinued" | "unknown";
    rawText: string | null;
  }>;

  flavours: Array<{
    name: string;
    availability: "listed" | "appears_inactive" | "explicitly_discontinued" | "unknown";
    caffeineRelation: "same_as_primary" | "exact" | "range" | "different" | "unknown";
    caffeineMg: NumberObservation;
    serving: ServingObservation;
    evidence: "normal_text" | "strikethrough" | "explicit_text" | "unknown";
    rawText: string | null;
  }>;

  ingredients: {
    state: FieldState;
    text: string | null;
    appliesTo: string | null;
  };

  media: {
    imageUrl: string | null;
    publicationState: "audit_only" | "allowed" | "blocked";
  };

  evidence: {
    sectionsPresent: string[];
    sourceLinks: string[];
    warnings: string[];
  };

  extraction: {
    collectorId: string;
    collectionId: string | null;
    templateFamily: string | null;
    parserVersion: string;
  };
};
