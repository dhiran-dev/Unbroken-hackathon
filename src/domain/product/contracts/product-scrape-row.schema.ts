/**
 * Zod schemas for the PulseRank V1 product scrape row contract.
 *
 * Mirrors the static types in field-states.ts, observations.ts, and
 * product-scrape-row.ts, which are copied verbatim from
 * PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §8.2–§8.5.
 *
 * PROVISIONAL contract: frozen only at G3, pending the A1 page-shape matrix and
 * real A2 collector output. See docs/handoffs/A3-contract.md.
 *
 * Validation semantics beyond the bare shapes (no new fields are introduced):
 * - Physical quantities (values, bounds, candidates, normalizedMl) must be
 *   non-negative when present: a negative milligram/gram reading is a parser
 *   bug, never data (rejects the invalid-negative fixture class from §8.6).
 * - min must not exceed max when both are present.
 * - source.url must point at caffeineinformer.com (rejects the wrong-host
 *   fixture class from §8.6).
 * - observedAt must be an ISO 8601 timestamp.
 */

import { z } from "zod";

export const fieldStateSchema = z.enum([
  "present",
  "not_published",
  "unparseable",
  "conflicting",
  "not_applicable",
]);

const nonNegativeNumberOrNull = z.number().min(0).nullable();

export const numberObservationSchema = z
  .object({
    state: fieldStateSchema,
    value: nonNegativeNumberOrNull,
    min: nonNegativeNumberOrNull,
    max: nonNegativeNumberOrNull,
    qualifier: z.enum(["exact", "range", "approximate", "estimated", "unknown"]),
    rawText: z.string().nullable(),
    // Plan §8.3: candidates is number[] — parsed numeric readings, never null.
    candidates: z.array(z.number().min(0)),
  })
  .refine(
    (observation) => observation.min === null || observation.max === null || observation.min <= observation.max,
    {
      message: "min must be less than or equal to max when both are present",
      path: ["max"],
    },
  );

export const servingUnitSchema = z.enum([
  "ml",
  "fl_oz",
  "oz",
  "g",
  "cup",
  "can",
  "bottle",
  "shot",
  "mint",
  "candy",
  "gum_piece",
  "tablet",
  "packet",
  "serving",
  "item",
  "unknown",
]);

export const servingFormSchema = z.enum([
  "drink",
  "concentrate",
  "mix",
  "food",
  "supplement",
  "item",
  "unknown",
]);

export const servingObservationSchema = z.object({
  state: fieldStateSchema,
  value: nonNegativeNumberOrNull,
  unit: servingUnitSchema.nullable(),
  form: servingFormSchema,
  normalizedMl: nonNegativeNumberOrNull,
  rawText: z.string().nullable(),
});

export const availabilitySchema = z.enum([
  "listed",
  "appears_inactive",
  "explicitly_discontinued",
  "unknown",
]);

export const sourceLevelSchema = z.enum([
  "caffeine_free",
  "low",
  "moderate",
  "high",
  "very_high",
  "extreme",
  "unknown",
]);

export const caffeineRelationSchema = z.enum([
  "same_as_primary",
  "exact",
  "range",
  "different",
  "unknown",
]);

export const flavourEvidenceSchema = z.enum([
  "normal_text",
  "strikethrough",
  "explicit_text",
  "unknown",
]);

export const publicationStateSchema = z.enum(["audit_only", "allowed", "blocked"]);

function isCaffeineInformerHost(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === "caffeineinformer.com" || hostname.endsWith(".caffeineinformer.com");
  } catch {
    return false;
  }
}

export const sourceSchema = z.object({
  sourceId: z.literal("caffeine-informer"),
  url: z
    .url()
    .refine(isCaffeineInformerHost, {
      message: "source.url must point at caffeineinformer.com",
    }),
  slug: z.string().min(1),
  observedAt: z.iso.datetime(),
  pageFingerprint: z.string().min(1),
});

export const identitySchema = z.object({
  name: z.string().min(1),
  categoryLabel: z.string().nullable(),
  categoryProvenance: z
    .enum(["source_listing", "source_pdp", "legacy_broad"])
    .optional(),
  pageTitle: z.string().nullable(),
});

export const primarySchema = z.object({
  caffeineMg: numberObservationSchema,
  sourceLevel: sourceLevelSchema,
  serving: servingObservationSchema,
  caloriesKcal: numberObservationSchema,
  sugarG: numberObservationSchema,
});

export const variantSchema = z.object({
  name: z.string().min(1),
  caffeineMg: numberObservationSchema,
  serving: servingObservationSchema,
  caloriesKcal: numberObservationSchema,
  sugarG: numberObservationSchema,
  region: z.string().nullable(),
  availability: availabilitySchema,
  rawText: z.string().nullable(),
});

export const flavourSchema = z.object({
  name: z.string().min(1),
  availability: availabilitySchema,
  caffeineRelation: caffeineRelationSchema,
  caffeineMg: numberObservationSchema,
  serving: servingObservationSchema,
  evidence: flavourEvidenceSchema,
  rawText: z.string().nullable(),
});

export const ingredientsSchema = z.object({
  state: fieldStateSchema,
  text: z.string().nullable(),
  appliesTo: z.string().nullable(),
});

export const mediaSchema = z.object({
  imageUrl: z.url().nullable(),
  publicationState: publicationStateSchema,
});

export const evidenceSchema = z.object({
  sectionsPresent: z.array(z.string()),
  sourceLinks: z.array(z.string()),
  warnings: z.array(z.string()),
});

export const extractionSchema = z.object({
  collectorId: z.string().min(1),
  collectionId: z.string().nullable(),
  templateFamily: z.string().nullable(),
  parserVersion: z.string().min(1),
});

export const productScrapeRowV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  source: sourceSchema,
  identity: identitySchema,
  primary: primarySchema,
  variants: z.array(variantSchema),
  flavours: z.array(flavourSchema),
  ingredients: ingredientsSchema,
  media: mediaSchema,
  evidence: evidenceSchema,
  extraction: extractionSchema,
});
