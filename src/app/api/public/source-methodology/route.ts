/**
 * GET /api/public/source-methodology — static methodology statement (A8).
 *
 * Thin handler over a constant object. This is the machine-readable version
 * of the publication policy: exactly ONE upstream source, attributed on every
 * record; no derived scores; sparse fields published AS states rather than
 * being imputed; extended nutrition fields gated behind a feature flag.
 */

export const dynamic = "force-dynamic";

const SOURCE_METHODOLOGY = {
  schemaVersion: "1.0",
  policy: {
    sources: "one-source",
    description:
      "Every published caffeine figure comes from exactly one registered " +
      "upstream source. Figures are republished as observed: point values, " +
      "ranges, approximations, and estimates keep their qualifier, and a " +
      "field the source does not publish is reported as not_published — " +
      "never imputed, averaged, or filled in from another source.",
    derivedScores:
      "none — no confidence score, rating, or health index is computed " +
      "anywhere in this pipeline",
  },
  attribution: {
    name: "Caffeine Informer",
    url: "https://www.caffeineinformer.com",
    note: "Product data sourced from Caffeine Informer (caffeineinformer.com).",
  },
  fieldPublication: {
    sparseStatesPreserved: true,
    extendedNutritionGatedByFlag: "PULSERANK_PUBLIC_EXTENDED_FIELDS",
    auditOnlyImagesSuppressed: true,
  },
} as const;

export async function GET(): Promise<Response> {
  return Response.json(SOURCE_METHODOLOGY, {
    status: 200,
    headers: { "Cache-Control": "public, s-maxage=60" },
  });
}
