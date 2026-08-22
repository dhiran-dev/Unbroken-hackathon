import { readFile, stat } from "node:fs/promises";

import { productScrapeRowV1Schema } from "@/domain/product/contracts/product-scrape-row.schema";
import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";
import {
  caffeineInformerTaxonomyManifest,
  resolveTaxonomyEntry,
  type TaxonomyManifest,
} from "@/server/ingestion/taxonomy";
import {
  JUDGE_COLLECTOR_ID,
  slugFromCollectorUrl,
  toScrapeRow,
  type CollectorProductRecord,
} from "@/server/judge/to-scrape-row";

const MAX_EXPORT_BYTES = 50 * 1024 * 1024;

export type ExportPreflightSummary = {
  objectCount: number;
  validUniqueProducts: number;
  collectorErrorWarnings: number;
  invalidRows: number;
  duplicateSlugs: number;
  rankIneligibleCaffeineConflicts: number;
  taxonomyMatched: number;
  taxonomyUnmatched: number;
};

export type ExportPreflightResult = {
  summary: ExportPreflightSummary;
  /** Contract-valid product rows only; page-level error objects remain warnings. */
  rows: ProductScrapeRowV1[];
  invalidIndexes: number[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isCollectorErrorPayload(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const hasErrorMarker =
    typeof value.error === "string" || typeof value.error_code === "string";
  const hasProductMarker =
    typeof value.product_name === "string" ||
    typeof value.product_page_url === "string" ||
    typeof value.product_url === "string";
  return hasErrorMarker && !hasProductMarker;
}

/** Map provider output through the frozen contract without mutating the payload. */
export function mapCollectorPayload(
  payload: unknown,
  observedAt: Date,
  taxonomyManifest: TaxonomyManifest = caffeineInformerTaxonomyManifest,
): unknown {
  if (!isRecord(payload) || payload.schemaVersion === "1.0") return payload;
  const hasProductIdentity =
    typeof payload.product_name === "string" && payload.product_name.trim() !== "";
  const hasProductUrl =
    typeof payload.product_page_url === "string" ||
    typeof payload.product_url === "string";
  if (!hasProductIdentity && !hasProductUrl) return payload;

  const record = payload as CollectorProductRecord;
  const rawUrl = record.product_page_url ?? record.product_url;
  const slug = slugFromCollectorUrl(rawUrl);
  return toScrapeRow(record, {
    observedAt: observedAt.toISOString(),
    collectorId: JUDGE_COLLECTOR_ID,
    templateFamily: "caffeine-informer-v2",
    taxonomyEntry: resolveTaxonomyEntry(taxonomyManifest, slug),
  });
}

export function preflightExportRows(
  values: readonly unknown[],
  options: { observedAt: string; taxonomyManifest?: TaxonomyManifest },
): ExportPreflightResult {
  const taxonomyManifest =
    options.taxonomyManifest ?? caffeineInformerTaxonomyManifest;
  const observedAt = new Date(options.observedAt);
  if (Number.isNaN(observedAt.getTime())) throw new Error("observedAt must be valid ISO time");

  const rows: ProductScrapeRowV1[] = [];
  const invalidIndexes: number[] = [];
  const slugCounts = new Map<string, number>();
  let collectorErrorWarnings = 0;
  let rankIneligibleCaffeineConflicts = 0;
  let taxonomyMatched = 0;
  let taxonomyUnmatched = 0;

  for (const [index, value] of values.entries()) {
    if (isCollectorErrorPayload(value)) {
      collectorErrorWarnings += 1;
      continue;
    }
    const parsed = productScrapeRowV1Schema.safeParse(
      mapCollectorPayload(value, observedAt, taxonomyManifest),
    );
    if (!parsed.success) {
      invalidIndexes.push(index);
      continue;
    }
    const row = parsed.data as ProductScrapeRowV1;
    rows.push(row);
    slugCounts.set(row.source.slug, (slugCounts.get(row.source.slug) ?? 0) + 1);
    if (row.primary.caffeineMg.state === "conflicting") {
      rankIneligibleCaffeineConflicts += 1;
    }
    if (row.identity.categoryProvenance === "source_listing") taxonomyMatched += 1;
    else taxonomyUnmatched += 1;
  }

  let duplicateSlugs = 0;
  for (const count of slugCounts.values()) duplicateSlugs += Math.max(count - 1, 0);

  return {
    summary: {
      objectCount: values.length,
      validUniqueProducts: slugCounts.size,
      collectorErrorWarnings,
      invalidRows: invalidIndexes.length,
      duplicateSlugs,
      rankIneligibleCaffeineConflicts,
      taxonomyMatched,
      taxonomyUnmatched,
    },
    rows,
    invalidIndexes,
  };
}

const REFERENCE_EXPORT_EXPECTED: ExportPreflightSummary = Object.freeze({
  objectCount: 663,
  validUniqueProducts: 661,
  collectorErrorWarnings: 2,
  invalidRows: 0,
  duplicateSlugs: 0,
  rankIneligibleCaffeineConflicts: 3,
  taxonomyMatched: 661,
  taxonomyUnmatched: 0,
});

export function assertReferenceExportPreflight(summary: ExportPreflightSummary): void {
  const mismatches = Object.entries(REFERENCE_EXPORT_EXPECTED).flatMap(
    ([key, expected]) =>
      summary[key as keyof ExportPreflightSummary] === expected
        ? []
        : [`${key}: expected ${expected}, got ${summary[key as keyof ExportPreflightSummary]}`],
  );
  if (mismatches.length > 0) {
    throw new Error(`Reference export preflight failed (${mismatches.join("; ")})`);
  }
}

/** Read a bounded local JSON export. No payload data is included in errors. */
export async function readExportRows(path: string): Promise<unknown[]> {
  const metadata = await stat(path);
  if (!metadata.isFile()) throw new Error("export path must be a file");
  if (metadata.size > MAX_EXPORT_BYTES) throw new Error("export exceeds 50 MiB safety limit");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error("export is not valid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("export root must be a JSON array");
  return parsed;
}
