/**
 * Judge cockpit — evidence assembly (Agent A12).
 *
 * Reads the REAL Bright Data healing-evidence artifacts recorded by Agent A2
 * (artifacts/scraper/, see docs/handoffs/A2-collector.md) and computes every
 * verdict shown on /judge with the production code paths:
 *
 * - zod contract validation: productScrapeRowV1Schema (A3),
 * - cross-field unit-consistency check between the two published caffeine
 *   figures (the A2-recommended sanity rule),
 * - run-level checks: validateRun (A5),
 * - field-level promotion decisions: normalizeRow + promoteCandidate (A5) —
 *   this is where the Ranking Impact story comes from, using real outputs,
 *   never fabricated numbers.
 *
 * A missing artifact renders as an explicit "unavailable" state; nothing is
 * invented to fill gaps.
 */

import type { ArtifactStat } from "@/server/judge/artifacts";
import {
  readArtifactJson,
  defaultArtifactsRoot,
  listArtifacts,
} from "@/server/judge/artifacts";
import {
  checkUnitConsistency,
  JUDGE_COLLECTOR_ID,
  toScrapeRow,
  type CollectorProductRecord,
} from "@/server/judge/to-scrape-row";
import { normalizeRow } from "@/server/ingestion";
import { promoteCandidate } from "@/server/ingestion/promote";
import type {
  PromotionDecision,
} from "@/server/ingestion/promote";
import type { RunValidationResult } from "@/server/ingestion/validate-run";
import { validateRun } from "@/server/ingestion/validate-run";
import { productScrapeRowV1Schema } from "@/domain/product/contracts/product-scrape-row.schema";

// ---------------------------------------------------------------------------
// Envelope accessors (defensive — artifacts are external CLI output)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export type CollectorEnvelopeInfo = {
  collectorId: string | null;
  name: string | null;
  status: string | null;
  createdAt: string | null;
  viewUrl: string | null;
};

export type HealEnvelopeInfo = {
  collectorId: string | null;
  status: string | null;
  prompt: string | null;
  diffSummary: string | null;
  nextStep: string | null;
  completedSteps: string[];
  previewRecords: CollectorProductRecord[];
  error: string | null;
};

export type RecordRunInfo = {
  records: CollectorProductRecord[];
  observedAt: string | null;
};

export function toCollectorEnvelope(value: unknown): CollectorEnvelopeInfo | null {
  if (!isRecord(value)) return null;
  return {
    collectorId: str(value.collector_id),
    name: str(value.name),
    status: str(value.status),
    createdAt: str(value.created_at),
    viewUrl: str(value.view_url),
  };
}

export function toHealEnvelope(value: unknown): HealEnvelopeInfo | null {
  if (!isRecord(value)) return null;
  return {
    collectorId: str(value.collector_id),
    status: str(value.status),
    prompt: str(value.prompt),
    diffSummary: str(value.diff_summary),
    nextStep: str(value.next_step),
    completedSteps: strArray(value.completed_steps),
    previewRecords: Array.isArray(value.preview_result)
      ? value.preview_result.filter(isRecord)
      : [],
    error: str(value.error),
  };
}

export function toRecordRun(value: unknown, observedAt: string | null): RecordRunInfo | null {
  if (!Array.isArray(value)) return null;
  return {
    records: value.filter(isRecord) as CollectorProductRecord[],
    observedAt,
  };
}

// ---------------------------------------------------------------------------
// Per-record analysis (mapping + contract + run checks + promotion)
// ---------------------------------------------------------------------------

export type RecordAnalysis = {
  /** The raw first collector record (verbatim artifact data). */
  record: CollectorProductRecord | null;
  sourceUrl: string | null;
  observedAt: string | null;
  /** Mapped V1 scrape row (contract-shaped). */
  scrapeRow: ReturnType<typeof toScrapeRow> | null;
  unitCheck: ReturnType<typeof checkUnitConsistency> | null;
  /** Zod contract verdict on the mapped row. */
  contract: { ok: boolean; issues: string[] };
  /** A5 run-level checks on the single-row run. */
  runValidation: RunValidationResult | null;
  /** A5 normalized candidate (carries the computed concentration). */
  normalized: ReturnType<typeof normalizeRow> | null;
  /** A5 promotion decision on the normalized row. */
  promotion: PromotionDecision | null;
};

export function analyzeRecord(
  record: CollectorProductRecord | null,
  observedAt: string | null,
): RecordAnalysis {
  if (record === null || observedAt === null) {
    return {
      record,
      sourceUrl: null,
      observedAt,
      scrapeRow: null,
      unitCheck: null,
      contract: { ok: false, issues: ["artifact unavailable"] },
      runValidation: null,
      normalized: null,
      promotion: null,
    };
  }

  const scrapeRow = toScrapeRow(record, {
    observedAt,
    collectorId: JUDGE_COLLECTOR_ID,
    templateFamily: "caffeine-pdp",
  });
  const parsed = productScrapeRowV1Schema.safeParse(scrapeRow);
  const issues = parsed.success
    ? []
    : parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
      );

  const runValidation = validateRun([scrapeRow]);
  const normalized = normalizeRow(scrapeRow);
  const promotion = promoteCandidate(normalized);

  const sourceUrl =
    isRecord(record.input) && str((record.input as Record<string, unknown>).url) !== null
      ? str((record.input as Record<string, unknown>).url)
      : null;

  return {
    record,
    sourceUrl,
    observedAt,
    scrapeRow,
    unitCheck: checkUnitConsistency(record, scrapeRow.primary.serving.normalizedMl),
    contract: { ok: parsed.success, issues },
    runValidation,
    normalized,
    promotion,
  };
}

// ---------------------------------------------------------------------------
// Full cockpit model
// ---------------------------------------------------------------------------

export type JudgeStepStatus = "ok" | "attention" | "failed" | "unavailable";

export type JudgeEvidenceModel = {
  collectorId: string;
  create: CollectorEnvelopeInfo | null;
  heal: HealEnvelopeInfo | null;
  approve: CollectorEnvelopeInfo & { completedSteps: string[]; nextStep: string | null } | null;
  preHeal: RecordAnalysis;
  postHeal: RecordAnalysis;
  discoveryRun: RecordRunInfo | null;
  healDiscovery: HealEnvelopeInfo | null;
  healDiscoveryAttempt2: HealEnvelopeInfo | null;
  scraperArtifacts: ArtifactStat[];
  demoArtifacts: ArtifactStat[];
  mutationsEnabled: boolean;
};

function observedAtFor(stats: ArtifactStat[], name: string): string | null {
  return stats.find((stat) => stat.name === name)?.modifiedAt ?? null;
}

function firstRecord(run: RecordRunInfo | null): CollectorProductRecord | null {
  return run?.records[0] ?? null;
}

/**
 * Build the full cockpit model from raw artifact values. Pure aside from the
 * flag read performed by the caller — every number shown on /judge derives
 * deterministically from these inputs.
 */
export function buildJudgeEvidence(input: {
  create: unknown;
  runStandard: unknown;
  heal: unknown;
  approve: unknown;
  runStandardPostHeal: unknown;
  runDiscoveryBeforeHeal: unknown;
  healDiscovery: unknown;
  healDiscoveryAttempt2: unknown;
  artifactStats: ArtifactStat[];
  demoArtifacts: ArtifactStat[];
  mutationsEnabled: boolean;
}): JudgeEvidenceModel {
  const stats = input.artifactStats;

  const create = toCollectorEnvelope(input.create);
  const heal = toHealEnvelope(input.heal);
  const approveValue = toCollectorEnvelope(input.approve);
  const approve =
    approveValue === null
      ? null
      : {
          ...approveValue,
          completedSteps: isRecord(input.approve)
            ? strArray((input.approve as Record<string, unknown>).completed_steps)
            : [],
          nextStep: isRecord(input.approve)
            ? str((input.approve as Record<string, unknown>).next_step)
            : null,
        };

  const preHealRun = toRecordRun(
    input.runStandard,
    observedAtFor(stats, "run-standard.json"),
  );
  const postHealRun = toRecordRun(
    input.runStandardPostHeal,
    observedAtFor(stats, "run-standard-post-heal.json"),
  );

  return {
    collectorId: create?.collectorId ?? JUDGE_COLLECTOR_ID,
    create,
    heal,
    approve,
    preHeal: analyzeRecord(firstRecord(preHealRun), preHealRun?.observedAt ?? null),
    postHeal: analyzeRecord(firstRecord(postHealRun), postHealRun?.observedAt ?? null),
    discoveryRun: toRecordRun(
      input.runDiscoveryBeforeHeal,
      observedAtFor(stats, "run-discovery-before-heal.json"),
    ),
    healDiscovery: toHealEnvelope(input.healDiscovery),
    healDiscoveryAttempt2: toHealEnvelope(input.healDiscoveryAttempt2),
    scraperArtifacts: stats,
    demoArtifacts: input.demoArtifacts,
    mutationsEnabled: input.mutationsEnabled,
  };
}

/**
 * Load every artifact the cockpit needs straight from disk at request time.
 * Each read fails soft to `null` so one missing file cannot take the page
 * down; the page renders an explicit unavailable state instead.
 */
export function loadJudgeEvidence(mutationsEnabled: boolean): JudgeEvidenceModel {
  const rootDir = defaultArtifactsRoot();
  const artifactStats = listArtifacts("scraper", rootDir);
  const demoArtifacts = listArtifacts("demo", rootDir);

  function safe(name: string): unknown {
    try {
      return readArtifactJson("scraper", name, rootDir);
    } catch {
      return null;
    }
  }

  return buildJudgeEvidence({
    create: safe("create.json"),
    runStandard: safe("run-standard.json"),
    heal: safe("heal.json"),
    approve: safe("approve.json"),
    runStandardPostHeal: safe("run-standard-post-heal.json"),
    runDiscoveryBeforeHeal: safe("run-discovery-before-heal.json"),
    healDiscovery: safe("heal-discovery.json"),
    healDiscoveryAttempt2: safe("heal-discovery-attempt2.json"),
    artifactStats,
    demoArtifacts,
    mutationsEnabled,
  });
}
