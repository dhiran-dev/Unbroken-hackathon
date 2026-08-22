import type { CanonicalCategory } from "@/server/ingestion/normalize";
import manifestJson from "@/server/ingestion/caffeine-informer-taxonomy-v1.json";

export const TAXONOMY_MANIFEST_ID = "caffeine-informer-taxonomy-v1" as const;

export type TaxonomySourceCode =
  | "ED"
  | "C"
  | "S"
  | "T"
  | "ES"
  | "W"
  | "FOOD"
  | "GUM"
  | "SUPPLEMENT";

export type TaxonomyEntry = {
  sourceCode: TaxonomySourceCode;
  category: CanonicalCategory;
  listingUrl: string;
};

export type TaxonomyManifest = {
  manifestId: typeof TAXONOMY_MANIFEST_ID;
  capturedAt: string;
  fingerprint: string;
  listings: Array<{
    url: string;
    sourceCode: "DRINKS" | "FOOD" | "GUM" | "SUPPLEMENT";
    fingerprint: string;
    entryCount: number;
  }>;
  entries: Record<string, TaxonomyEntry>;
};

const SOURCE_CODE_CATEGORIES: Readonly<Record<TaxonomySourceCode, CanonicalCategory>> =
  Object.freeze({
    ED: "energy-drink",
    C: "coffee",
    S: "soda",
    T: "tea",
    ES: "energy-shot",
    W: "water",
    FOOD: "food",
    GUM: "gum",
    SUPPLEMENT: "other",
  });

/** Map only source-defined codes. Unsupported groups deliberately stay other. */
export function categoryForSourceCode(code: string): CanonicalCategory {
  return SOURCE_CODE_CATEGORIES[code as TaxonomySourceCode] ?? "other";
}

/** Exact-slug lookup; callers must use the source URL slug unchanged. */
export function resolveTaxonomyEntry(
  manifest: TaxonomyManifest,
  slug: string,
): TaxonomyEntry | null {
  return manifest.entries[slug] ?? null;
}

/** Captured, source-backed evidence used by every collector-row mapping path. */
export const caffeineInformerTaxonomyManifest = Object.freeze(
  manifestJson as unknown as TaxonomyManifest,
);
