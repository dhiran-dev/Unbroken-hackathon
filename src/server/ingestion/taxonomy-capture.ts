import { createHash } from "node:crypto";

import {
  TAXONOMY_MANIFEST_ID,
  categoryForSourceCode,
  type TaxonomyManifest,
  type TaxonomySourceCode,
} from "@/server/ingestion/taxonomy";

export type CapturedTaxonomyEntry = {
  slug: string;
  sourceCode: TaxonomySourceCode;
};

export type CapturedListing = {
  url: string;
  sourceCode: TaxonomyManifest["listings"][number]["sourceCode"];
  bodyFingerprint: string;
  entries: CapturedTaxonomyEntry[];
};

const LISTINGS = Object.freeze([
  {
    url: "https://www.caffeineinformer.com/the-caffeine-database",
    sourceCode: "DRINKS" as const,
  },
  {
    url: "https://www.caffeineinformer.com/caffeine-in-candy",
    sourceCode: "FOOD" as const,
  },
  {
    url: "https://www.caffeineinformer.com/efs-guide-to-caffeine-gum",
    sourceCode: "GUM" as const,
  },
  {
    url: "https://www.caffeineinformer.com/caffeine-in-workout-supplements",
    sourceCode: "SUPPLEMENT" as const,
  },
  {
    url: "https://www.caffeineinformer.com/caffeine-content/caffeine-pills",
    sourceCode: "SUPPLEMENT" as const,
  },
  {
    url: "https://www.caffeineinformer.com/nootropics",
    sourceCode: "SUPPLEMENT" as const,
  },
]);

const DRINK_CODES = new Set<TaxonomySourceCode>([
  "ED",
  "C",
  "S",
  "T",
  "ES",
  "W",
]);

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function sourceSlug(value: string): string | null {
  try {
    const decoded = decodeURIComponent(value).trim();
    return decoded !== "" && !decoded.includes("/") ? decoded : null;
  } catch {
    return null;
  }
}

/** Parse the source's inline drink rows; the final tuple value is its category code. */
export function parseDrinkListingHtml(html: string): CapturedTaxonomyEntry[] {
  const match = /\bvar\s+tbldata\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (!match?.[1]) throw new Error("drink listing did not contain tbldata");

  let rows: unknown;
  try {
    rows = JSON.parse(match[1]);
  } catch {
    throw new Error("drink listing tbldata was not valid JSON");
  }
  if (!Array.isArray(rows)) throw new Error("drink listing tbldata was not an array");

  const entries = new Map<string, CapturedTaxonomyEntry>();
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const anchor = row[0];
    const code = row[5];
    if (typeof anchor !== "string" || typeof code !== "string") continue;
    if (!DRINK_CODES.has(code as TaxonomySourceCode)) continue;
    const href = /\/caffeine-content\/([^'\"?#>]+)/.exec(anchor)?.[1];
    const slug = href ? sourceSlug(href) : null;
    if (slug !== null) {
      entries.set(slug, { slug, sourceCode: code as TaxonomySourceCode });
    }
  }
  return [...entries.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Parse only the article's first evidence table, excluding navigation links. */
export function parseArticleListingHtml(
  html: string,
  sourceCode: "FOOD" | "GUM" | "SUPPLEMENT",
): CapturedTaxonomyEntry[] {
  const main = /<div\s+class=["']main["'][^>]*>([\s\S]*?)<\/div>\s*<!--\s*\.main\s*-->/.exec(
    html,
  )?.[1];
  if (!main) throw new Error(`${sourceCode.toLowerCase()} listing has no article body`);
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/.exec(main)?.[1];
  if (!table) throw new Error(`${sourceCode.toLowerCase()} listing has no evidence table`);

  const entries = new Map<string, CapturedTaxonomyEntry>();
  const hrefs = table.matchAll(
    /href=["'](?:https:\/\/www\.caffeineinformer\.com)?\/caffeine-content\/([^'\"?#>]+)/gi,
  );
  for (const match of hrefs) {
    const slug = match[1] ? sourceSlug(match[1]) : null;
    if (slug !== null) entries.set(slug, { slug, sourceCode });
  }
  return [...entries.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

const PRECEDENCE: Readonly<Record<CapturedListing["sourceCode"], number>> = {
  FOOD: 1,
  SUPPLEMENT: 2,
  GUM: 3,
  DRINKS: 4,
};

export function buildTaxonomyManifest(
  captured: readonly CapturedListing[],
  capturedAt: string,
): TaxonomyManifest {
  const entries: TaxonomyManifest["entries"] = {};
  const winningPrecedence = new Map<string, number>();

  for (const listing of captured) {
    for (const entry of listing.entries) {
      const precedence = PRECEDENCE[listing.sourceCode];
      if (precedence < (winningPrecedence.get(entry.slug) ?? 0)) continue;
      winningPrecedence.set(entry.slug, precedence);
      entries[entry.slug] = {
        sourceCode: entry.sourceCode,
        category: categoryForSourceCode(entry.sourceCode),
        listingUrl: listing.url,
      };
    }
  }

  const sortedEntries = Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  );
  const listings = captured.map((listing) => ({
    url: listing.url,
    sourceCode: listing.sourceCode,
    fingerprint: listing.bodyFingerprint,
    entryCount: listing.entries.length,
  }));
  const fingerprint = sha256(JSON.stringify({ listings, entries: sortedEntries }));

  return {
    manifestId: TAXONOMY_MANIFEST_ID,
    capturedAt,
    fingerprint,
    listings,
    entries: sortedEntries,
  };
}

export async function captureTaxonomyManifest(
  fetchImpl: typeof fetch = fetch,
  capturedAt = new Date().toISOString(),
): Promise<TaxonomyManifest> {
  const captured: CapturedListing[] = [];
  for (const listing of LISTINGS) {
    const response = await fetchImpl(listing.url, {
      headers: { Accept: "text/html", "User-Agent": "PulseRank taxonomy capture/1.0" },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`taxonomy listing returned HTTP ${response.status}: ${listing.url}`);
    }
    const html = await response.text();
    const entries =
      listing.sourceCode === "DRINKS"
        ? parseDrinkListingHtml(html)
        : parseArticleListingHtml(html, listing.sourceCode);
    captured.push({
      ...listing,
      bodyFingerprint: sha256(html),
      entries,
    });
  }
  return buildTaxonomyManifest(captured, capturedAt);
}
