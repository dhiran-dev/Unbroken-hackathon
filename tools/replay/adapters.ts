/**
 * Replay-harness adapters for the PulseRank V1 ingestion pipeline.
 *
 * Defines the LOCAL `PipelineStages` interface that the harness drives so the
 * golden regression suite compiles standalone. A5 (normalization/promotion,
 * src/server/ingestion) runs in a parallel branch and MUST NOT be imported
 * here yet; at merge these adapters get rewired to the real implementation
 * without changing the harness or the suite (see tools/replay/README.md).
 *
 * Stage semantics:
 * - `parse`       raw JSON text → contract-validated ProductScrapeRowV1.
 *                 Real zod schemas from src/domain/product/contracts (NOT a
 *                 local copy) are the single source of truth.
 * - `normalize`   shape-preserving pass-through. TODO-REWIRE-A5
 * - `validateRun` shape-preserving pass-through. TODO-REWIRE-A5
 * - `promote`     shape-preserving pass-through. TODO-REWIRE-A5
 */

import {
  productScrapeRowV1Schema,
} from "../../src/domain/product/contracts/product-scrape-row.schema";
import type { ProductScrapeRowV1 } from "../../src/domain/product/contracts/product-scrape-row";

export type StageName = "contract" | "normalize" | "validate" | "promote";

/** Ordered pipeline execution sequence used by the runner and the CLI. */
export const STAGE_ORDER: readonly StageName[] = [
  "contract",
  "normalize",
  "validate",
  "promote",
] as const;

export type FindingSeverity = "error" | "warning" | "info";

export interface Finding {
  code: string;
  message: string;
  /** Schema path of the offending field, dot-joined (contract stage only). */
  path?: string;
  severity?: FindingSeverity;
}

export interface StageResult<T> {
  stage: StageName;
  ok: boolean;
  /** Transformed row; null when the stage failed and produced nothing. */
  output: T | null;
  findings: Finding[];
}

/**
 * The four ingestion stages the replay harness exercises, in order.
 * Implemented locally below until A5 lands; the interface is what stays.
 */
export interface PipelineStages {
  parse(rawJsonText: string): StageResult<ProductScrapeRowV1>;
  normalize(row: ProductScrapeRowV1): StageResult<ProductScrapeRowV1>;
  validateRun(row: ProductScrapeRowV1): StageResult<ProductScrapeRowV1>;
  promote(row: ProductScrapeRowV1): StageResult<ProductScrapeRowV1>;
}

function schemaFindings(issues: readonly { message: string; path: (string | number | symbol)[] }[]): Finding[] {
  return issues.map((issue) => ({
    code: "schema_invalid",
    message: issue.message,
    path: issue.path.map(String).join(".") || "(root)",
    severity: "error" as const,
  }));
}

/** Local stand-in for src/server/ingestion. Rewire at merge. */
export const localPipelineStages: PipelineStages = {
  parse(rawJsonText) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(rawJsonText);
    } catch (error) {
      return {
        stage: "contract",
        ok: false,
        output: null,
        findings: [
          {
            code: "json_parse_failed",
            message: error instanceof Error ? error.message : String(error),
            severity: "error" as const,
          },
        ],
      };
    }

    const result = productScrapeRowV1Schema.safeParse(parsedJson);
    if (!result.success) {
      return {
        stage: "contract",
        ok: false,
        output: null,
        findings: schemaFindings(result.error.issues),
      };
    }
    return { stage: "contract", ok: true, output: result.data, findings: [] };
  },

  normalize(row) {
    // TODO-REWIRE-A5: replace with the real normalization from
    // src/server/ingestion (per-item unit handling, flavour availability,
    // serving inference). Shape-preserving placeholder until then.
    return {
      stage: "normalize",
      ok: true,
      output: structuredClone(row),
      findings: [],
    };
  },

  validateRun(row) {
    // TODO-REWIRE-A5: replace with run-level validation gates from
    // src/server/ingestion. Shape-preserving placeholder until then.
    return {
      stage: "validate",
      ok: true,
      output: structuredClone(row),
      findings: [],
    };
  },

  promote(row) {
    // TODO-REWIRE-A5: replace with publication-state promotion logic from
    // src/server/ingestion. Shape-preserving placeholder until then.
    return {
      stage: "promote",
      ok: true,
      output: structuredClone(row),
      findings: [],
    };
  },
};
