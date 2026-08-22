import { describe, expect, it } from "vitest";

import {
  categoryForSourceCode,
  resolveTaxonomyEntry,
  type TaxonomyManifest,
} from "@/server/ingestion/taxonomy";
import {
  buildTaxonomyManifest,
  type CapturedListing,
} from "@/server/ingestion/taxonomy-capture";

describe("source-backed taxonomy", () => {
  it("maps every documented drink-listing code without product-name inference", () => {
    expect(categoryForSourceCode("ED")).toBe("energy-drink");
    expect(categoryForSourceCode("C")).toBe("coffee");
    expect(categoryForSourceCode("S")).toBe("soda");
    expect(categoryForSourceCode("T")).toBe("tea");
    expect(categoryForSourceCode("ES")).toBe("energy-shot");
    expect(categoryForSourceCode("W")).toBe("water");
    expect(categoryForSourceCode("FOOD")).toBe("food");
    expect(categoryForSourceCode("GUM")).toBe("gum");
    expect(categoryForSourceCode("SUPPLEMENT")).toBe("other");
    expect(categoryForSourceCode("UNKNOWN")).toBe("other");
  });

  it("resolves category evidence by exact source slug", () => {
    const manifest: TaxonomyManifest = {
      manifestId: "caffeine-informer-taxonomy-v1",
      capturedAt: "2026-08-22T00:00:00.000Z",
      fingerprint: "sha256:test",
      listings: [
        {
          url: "https://www.caffeineinformer.com/the-caffeine-database",
          sourceCode: "DRINKS",
          fingerprint: "sha256:listing",
          entryCount: 1,
        },
      ],
      entries: {
        "red-bull": {
          sourceCode: "ED",
          category: "energy-drink",
          listingUrl: "https://www.caffeineinformer.com/the-caffeine-database",
        },
      },
    };

    expect(resolveTaxonomyEntry(manifest, "red-bull")).toEqual({
      sourceCode: "ED",
      category: "energy-drink",
      listingUrl: "https://www.caffeineinformer.com/the-caffeine-database",
    });
    expect(resolveTaxonomyEntry(manifest, "Red-Bull")).toBeNull();
    expect(resolveTaxonomyEntry(manifest, "missing")).toBeNull();
  });

  it("builds a deterministic manifest with explicit listing precedence", () => {
    const capturedAt = "2026-08-22T00:00:00.000Z";
    const listings: CapturedListing[] = [
      {
        url: "https://www.caffeineinformer.com/caffeine-in-candy",
        sourceCode: "FOOD",
        bodyFingerprint: "sha256:food",
        entries: [{ slug: "shared-product", sourceCode: "FOOD" }],
      },
      {
        url: "https://www.caffeineinformer.com/efs-guide-to-caffeine-gum",
        sourceCode: "GUM",
        bodyFingerprint: "sha256:gum",
        entries: [{ slug: "shared-product", sourceCode: "GUM" }],
      },
      {
        url: "https://www.caffeineinformer.com/the-caffeine-database",
        sourceCode: "DRINKS",
        bodyFingerprint: "sha256:drinks",
        entries: [
          { slug: "shared-product", sourceCode: "ED" },
          { slug: "plain-water", sourceCode: "W" },
        ],
      },
    ];

    const manifest = buildTaxonomyManifest(listings, capturedAt);

    expect(manifest.entries["shared-product"]).toMatchObject({
      sourceCode: "ED",
      category: "energy-drink",
      listingUrl: "https://www.caffeineinformer.com/the-caffeine-database",
    });
    expect(manifest.entries["plain-water"]?.category).toBe("water");
    expect(manifest.fingerprint).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
