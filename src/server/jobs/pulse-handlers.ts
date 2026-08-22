/**
 * PulseRank worker handler wiring (Agent A7b).
 *
 * Binds the complete PulseRank job set to the deterministic pipeline stages
 * from `@/server/ingestion/*` and the Bright Data client, replacing the
 * dispatcher stubs in the default registry (`./pulse-jobs`). The
 * dispatch contract is untouched: handlers receive
 * `{ job, payload }` and return structured results; `dispatch()` still never
 * throws.
 *
 * Handler inventory:
 *
 * - pulse.ingest.run {runId}        — zod-parse raw_records rows into V1 scrape
 *   rows, normalize, and persist one CANDIDATE product observation per row,
 *   idempotent on (source, page_fingerprint) [and (source, slug, observed_at)].
 * - pulse.validate.run {runId}      — run-level checks over the parsed rows;
 *   findings land in collection_runs.report and the run status flips to
 *   `validated` / `validation_failed`.
 * - pulse.promote.snapshot {runId}  — promotion verdicts per candidate:
 *   trusted => observation becomes the product's current trusted record
 *   (+ supersede + change events vs. the previous trusted record),
 *   quarantined => observation stays quarantined + an incident opens.
 * - pulse.rebuild.leaderboards {}   — recompute the three boards from trusted
 *   observations and append one immutable snapshot with deterministic entries
 *   (metric desc, stable slug tiebreak).
 * - pulse.collect.sample {url} /
 *   pulse.collect.discovery {inputFile|query} — Bright Data CLI runs, gated on
 *   PULSERANK_COLLECTION_ENABLED / PULSERANK_DISCOVERY_ENABLED. Raw output is
 *   persisted to raw_records + collection_runs BEFORE any processing; a
 *   disabled flag yields a structured skip without touching the network.
 *
 * Transactionality: every DB-writing handler runs inside ONE transaction via
 * `runtime.runTransaction` (default: `runInPulseTransaction`, which resolves
 * the db client lazily). Collection is the deliberate exception — opening the
 * collection_runs row, the network call, and raw persistence are separate
 * transactions so the run row can track an in-flight/failed CLI attempt.
 *
 * Import-safety: importing this module opens no sockets and no connections —
 * the db client is reached only through the lazy dynamic import inside
 * `runInPulseTransaction`, and the CLI only spawns when a collect handler runs
 * with its flag enabled.
 */

import { z } from "zod";

import { pulserankFlags } from "@/config/pulserank-flags";
import { productScrapeRowV1Schema } from "@/domain/product/contracts/product-scrape-row.schema";
import { brightDataHealEnvelopeSchema } from "@/domain/incidents/contract";
import {
  BdataClientError,
  collectViaBdata,
  rawOutputFingerprint,
  resolveDiscoveryQuery,
  type BdataCollectInput,
} from "@/server/collection/bdata-client";
import {
  BrightDataProviderError,
  DEFAULT_PROVIDER_WINDOW_MS,
  createDefaultBrightDataProvider,
  type BrightDataProvider,
} from "@/server/collection/bright-data-provider";
import {
  normalizeRow,
  type NormalizedCandidate,
} from "@/server/ingestion/normalize";
import {
  isCollectorErrorPayload,
  mapCollectorPayload,
} from "@/server/ingestion/export-recovery";
import { caffeineInformerTaxonomyManifest } from "@/server/ingestion/taxonomy";
import {
  promoteCandidate,
  type PriorTrustedFields,
  type TrustedProductRecord,
} from "@/server/ingestion/promote";
import {
  diffTrustedRecords,
  type ChangeEvent,
} from "@/server/ingestion/change-detection";
import {
  runInPulseTransaction,
  type InsertRawRecordInput,
  type PulseRepo,
  type SourceRow,
} from "@/server/ingestion/repo";
import { validateRun, type ValidatableRow } from "@/server/ingestion/validate-run";
import {
  JUDGE_COLLECTOR_ID,
} from "@/server/judge/to-scrape-row";
import type {
  PulseJobExecutionResult,
  PulseJobHandler,
  PulseJobName,
} from "./pulse-jobs";

/** JSON-object view used for jsonb columns (mirrors schema/pulse.ts). */
type JsonObject = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Runtime seam (the only place real infrastructure is touched)
// ---------------------------------------------------------------------------

/**
 * Transaction runner: executes `work` with a repo bound to ONE database
 * transaction. The default implementation resolves the pooled client lazily;
 * unit tests substitute an in-memory repo here.
 */
export type PulseJobRunTransaction = <T>(
  work: (repo: PulseRepo) => Promise<T>,
) => Promise<T>;

export interface PulseJobRuntimeFlags {
  readonly collectionEnabled: boolean;
  readonly discoveryEnabled: boolean;
  /** Heal previews are mutations and stay disabled unless explicitly enabled. */
  readonly judgeMutationsEnabled?: boolean;
}

export interface PulseJobRuntime {
  readonly runTransaction: PulseJobRunTransaction;
  /** Live flag values consulted by collect handlers at execution time. */
  readonly flags: PulseJobRuntimeFlags;
  /** Clock seam (handlers never call Date.now directly). */
  readonly now: () => Date;
  /** Bright Data client seam; unit tests substitute canned output. */
  readonly collect: typeof collectViaBdata;
  /** True external provider seam used by async discovery submit/poll jobs. */
  readonly provider: BrightDataProvider;
  /** Durable queue seam; retries are idempotent by caller-supplied key. */
  readonly enqueue: (input: {
    name: PulseJobName;
    payload?: Record<string, unknown>;
    idempotencyKey: string;
    scheduledFor?: Date;
    maxAttempts?: number;
  }) => Promise<unknown>;
  /** Bright Data heal-preview seam; approval is deliberately a separate step. */
  readonly healPreview?: (prompt: string, sourceUrl: string) => Promise<unknown>;
}

/**
 * Default runtime: real transactions, env-backed flags read live at each
 * execution, wall clock, real CLI client.
 */
export function createDefaultPulseJobRuntime(): PulseJobRuntime {
  return {
    runTransaction: runInPulseTransaction,
    get flags() {
      return {
        collectionEnabled: pulserankFlags.server.collectionEnabled,
        discoveryEnabled: pulserankFlags.server.discoveryEnabled,
        judgeMutationsEnabled: pulserankFlags.server.judgeMutationsEnabled,
      };
    },
    now: () => new Date(),
    collect: collectViaBdata,
    provider: {
      async submit(input) {
        return (await createDefaultBrightDataProvider()).submit(input);
      },
      async poll(collectionId) {
        return (await createDefaultBrightDataProvider()).poll(collectionId);
      },
    },
    enqueue: async (input) => {
      const { enqueuePulseJob } = await import("@/server/jobs/queue");
      return enqueuePulseJob(input);
    },
    healPreview: async (prompt, sourceUrl) => {
      const { requestBrightDataHealing } = await import(
        "@/server/services/bright-data-healing"
      );
      return requestBrightDataHealing(prompt, sourceUrl);
    },
  };
}

// ---------------------------------------------------------------------------
// Structured result constructors
// ---------------------------------------------------------------------------

function okResult(
  job: PulseJobName,
  summary: string,
  details: Record<string, unknown> = {},
): PulseJobExecutionResult {
  return { status: "ok", job, summary, details };
}

function skippedResult(
  job: PulseJobName,
  reason: string,
  summary: string,
  details: Record<string, unknown> = {},
): PulseJobExecutionResult {
  return { status: "skipped", job, reason, summary, details };
}

function failedResult(
  job: PulseJobName,
  errorCode: string,
  message: string,
  details: Record<string, unknown> = {},
): PulseJobExecutionResult {
  return { status: "failed", job, errorCode, message, details };
}

function zodIssues(error: z.ZodError): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`,
  );
}

// ---------------------------------------------------------------------------
// Payload schemas
// ---------------------------------------------------------------------------

const RUN_ID_PAYLOAD_SCHEMA = z.object({ runId: z.string().min(1) });

const SAMPLE_COLLECT_PAYLOAD_SCHEMA = z
  .object({
    url: z.url().optional(),
    inputFile: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(60 * 60_000).optional(),
  })
  .refine(
    (payload) => payload.url !== undefined || payload.inputFile !== undefined,
    { message: "sample needs a url or an inputFile" },
  );

const DISCOVERY_COLLECT_PAYLOAD_SCHEMA = z
  .object({
    query: z.string().min(1).optional(),
    inputFile: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(60 * 60_000).optional(),
  })
  .refine(
    (payload) => payload.query !== undefined || payload.inputFile !== undefined,
    { message: "discovery needs a query or an inputFile" },
  );

const POLL_COLLECT_PAYLOAD_SCHEMA = z.object({
  runId: z.string().min(1),
  resume: z.boolean().optional().default(false),
});

const PROVIDER_STATE_SCHEMA = z.object({
  kind: z.literal("bright_data_dca"),
  collectionId: z.string().regex(/^j_[A-Za-z0-9]+$/),
  submittedAt: z.iso.datetime(),
  lastPollAt: z.iso.datetime().nullable(),
  attempts: z.number().int().nonnegative(),
  status: z.string().min(1),
  windowEndsAt: z.iso.datetime(),
});

type ProviderState = z.infer<typeof PROVIDER_STATE_SCHEMA>;

const HEAL_PREVIEW_PAYLOAD_SCHEMA = z.object({
  sourceUrl: z.url(),
  prompt: z.string().trim().min(10).max(2_000),
});

const HEAL_VERIFY_PAYLOAD_SCHEMA = z.object({
  sessionId: z.string().min(1),
});

const RETENTION_PAYLOAD_SCHEMA = z.object({
  dryRun: z.boolean().optional().default(true),
});

// ---------------------------------------------------------------------------
// Shared pipeline helpers
// ---------------------------------------------------------------------------

type ParsedRunRows = {
  candidatesByFingerprint: Map<string, NormalizedCandidate>;
  validatableRows: ValidatableRow[];
  unparsableRecordIds: string[];
  collectorErrorRecordIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Bright Data can return a page-level error beside successful product rows.
 * That is failed-page evidence, not a malformed product contract. Keep it in
 * the run report and exclude it from candidate promotion without allowing it
 * to invalidate otherwise healthy product rows.
 */
function isAllowedCaffeineInformerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "caffeineinformer.com" || hostname.endsWith(".caffeineinformer.com"))
    );
  } catch {
    return false;
  }
}

function rawLandingFingerprint(
  row: unknown,
  index: number,
  seen: ReadonlySet<string>,
): { fingerprint: string; duplicate: boolean } {
  const contentFingerprint = rawOutputFingerprint(row);
  if (!seen.has(contentFingerprint)) {
    return { fingerprint: contentFingerprint, duplicate: false };
  }
  if (isCollectorErrorPayload(row)) {
    return {
      fingerprint: rawOutputFingerprint({
        terminalErrorOccurrence: index,
        payload: row,
      }),
      duplicate: false,
    };
  }
  return { fingerprint: contentFingerprint, duplicate: true };
}

type ValidatedHealPreview = {
  rows: ValidatableRow[];
  rowCount: number;
  findings: Array<{ check: string; severity: string; detail: string }>;
};

/**
 * Validate provider preview rows with the same V1 contract and run-level
 * checks used by a collection run. A preview that cannot pass this gate is
 * never persisted as an approvable heal session.
 */
function validateHealPreview(
  envelope: Record<string, unknown>,
  observedAt: Date,
): ValidatedHealPreview | { errorCode: string; message: string; details: Record<string, unknown> } {
  const rawPreview = envelope.preview_result;
  const previewRows = Array.isArray(rawPreview)
    ? rawPreview
    : isRecord(rawPreview)
      ? [rawPreview]
      : [];
  if (previewRows.length === 0) {
    return {
      errorCode: "preview_empty",
      message: "Bright Data returned no preview rows to validate.",
      details: { rowCount: 0 },
    };
  }

  const rows: ValidatableRow[] = [];
  const issues: string[] = [];
  for (const [index, raw] of previewRows.entries()) {
    const mapped = mapCollectorPayload(raw, observedAt);
    const parsed = productScrapeRowV1Schema.safeParse(mapped);
    if (!parsed.success) {
      issues.push(
        `preview_result[${index}]: ${zodIssues(parsed.error).join("; ")}`,
      );
      continue;
    }
    rows.push(parsed.data as ValidatableRow);
  }
  if (issues.length > 0) {
    return {
      errorCode: "preview_contract_invalid",
      message: "Bright Data preview rows failed the frozen V1 contract.",
      details: { rowCount: previewRows.length, issues },
    };
  }

  const validation = validateRun(rows);
  if (!validation.ok) {
    return {
      errorCode: "preview_validation_failed",
      message: "Bright Data preview rows failed deterministic run validation.",
      details: { rowCount: rows.length, findings: validation.findings },
    };
  }

  return {
    rows,
    rowCount: rows.length,
    findings: validation.findings,
  };
}

function reportSection(
  report: JsonObject | null,
  key: string,
): Record<string, unknown> | null {
  const value = report?.[key];
  return isRecord(value) ? value : null;
}

function providerState(report: JsonObject | null): ProviderState | null {
  const parsed = PROVIDER_STATE_SCHEMA.safeParse(reportSection(report, "provider"));
  return parsed.success ? parsed.data : null;
}

/**
 * Lenient structural view for run-level validation. Rows that fail the strict
 * contract parse (wrong host, wrong schemaVersion, …) must STILL be inspectable
 * by `validateRun` — those violations are findings, not parse errors (A5).
 * Returns null only when the payload is too broken to inspect at all.
 */
function toValidatableRow(value: unknown): ValidatableRow | null {
  if (value === null || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const source = row.source as Record<string, unknown> | undefined;
  const primary = row.primary as Record<string, unknown> | undefined;
  if (typeof row.schemaVersion !== "string") return null;
  if (source === null || typeof source !== "object") return null;
  if (typeof source.url !== "string" || typeof source.slug !== "string") return null;
  if (primary === null || typeof primary !== "object") return null;

  const metric = (name: string): ValidatableRow["primary"]["caffeineMg"] | null => {
    const raw = primary[name] as Record<string, unknown> | undefined;
    if (raw === null || typeof raw !== "object") return null;
    if (typeof raw.state !== "string") return null;
    const value = raw.value;
    if (value !== null && value !== undefined && typeof value !== "number") return null;
    const min = raw.min;
    const max = raw.max;
    if (min !== null && min !== undefined && typeof min !== "number") return null;
    if (max !== null && max !== undefined && typeof max !== "number") return null;
    return {
      state: raw.state as ValidatableRow["primary"]["caffeineMg"]["state"],
      value: typeof value === "number" ? value : null,
      min: typeof min === "number" ? min : null,
      max: typeof max === "number" ? max : null,
    };
  };

  const caffeineMg = metric("caffeineMg");
  const caloriesKcal = metric("caloriesKcal");
  const sugarG = metric("sugarG");
  const servingRaw = primary.serving as Record<string, unknown> | undefined;
  if (caffeineMg === null || caloriesKcal === null || sugarG === null) return null;
  if (servingRaw === null || typeof servingRaw !== "object") return null;
  const servingUnit = servingRaw.unit;
  if (servingUnit !== null && servingUnit !== undefined && typeof servingUnit !== "string") return null;

  return {
    schemaVersion: row.schemaVersion,
    source: { url: source.url, slug: source.slug },
    primary: {
      caffeineMg,
      serving: { unit: servingUnit as string | null | undefined },
      caloriesKcal,
      sugarG,
    },
  };
}

/** Zod-parse every raw record payload of a run into V1 rows. */
async function parseRunRows(
  repo: PulseRepo,
  runId: string,
): Promise<ParsedRunRows | null> {
  const run = await repo.getCollectionRun(runId);
  if (!run) return null;

  const rawRecords = await repo.listRawRecords(runId);
  const candidatesByFingerprint = new Map<string, NormalizedCandidate>();
  const validatableRows: ValidatableRow[] = [];
  const unparsableRecordIds: string[] = [];
  const collectorErrorRecordIds: string[] = [];

  for (const record of rawRecords) {
    const mappedPayload = mapCollectorPayload(record.payload, record.capturedAt);
    const parsed = productScrapeRowV1Schema.safeParse(mappedPayload);
    if (!parsed.success) {
      if (isCollectorErrorPayload(mappedPayload)) {
        collectorErrorRecordIds.push(record.id);
        continue;
      }
      // Contract-invalid rows stay inspectable for run-level validation:
      // wrong host / schemaVersion are FINDINGS, not silent drops.
      const inspectable = toValidatableRow(mappedPayload);
      if (inspectable !== null) {
        validatableRows.push(inspectable);
      } else {
        unparsableRecordIds.push(record.id);
      }
      continue;
    }
    const candidate = normalizeRow(parsed.data);
    candidatesByFingerprint.set(candidate.pageFingerprint, candidate);
    validatableRows.push(parsed.data as ValidatableRow);
  }

  return {
    candidatesByFingerprint,
    validatableRows,
    unparsableRecordIds,
    collectorErrorRecordIds,
  };
}

/**
 * Resolve the registered source for a run's rows. All V1 rows share the same
 * literal sourceId (`caffeine-informer`), which is registered as the source
 * slug; a missing registration is a setup error, not per-row noise.
 */
async function resolveSource(
  repo: PulseRepo,
  candidate: NormalizedCandidate,
): Promise<SourceRow | null> {
  return repo.findSourceBySlug(candidate.identity.sourceId);
}

/** Persist variant/flavour entity rows + observations for one candidate. */
async function persistCandidateEntities(
  repo: PulseRepo,
  productId: string,
  observationId: string,
  observedAt: Date,
  candidate: NormalizedCandidate,
): Promise<void> {
  for (const variant of candidate.variants) {
    const variantRow = await repo.ensureVariant(productId, variant.name);
    await repo.insertVariantObservation({
      variantId: variantRow.id,
      productObservationId: observationId,
      observedAt,
      normalized: variant as JsonObject,
    });
  }
  for (const flavour of candidate.flavours) {
    const flavourRow = await repo.ensureFlavour(productId, flavour.name);
    await repo.insertFlavourObservation({
      flavourId: flavourRow.id,
      productObservationId: observationId,
      observedAt,
      normalized: flavour as JsonObject,
    });
  }
}

/** The previous trusted record behind the product pointer, if fully trusted. */
async function loadPriorTrustedRecord(
  repo: PulseRepo,
  currentTrustedObservationId: string | null,
): Promise<TrustedProductRecord | null> {
  if (currentTrustedObservationId === null) return null;
  const prior = await repo.getObservation(currentTrustedObservationId);
  if (!prior || prior.status !== "trusted") return null;
  return prior.normalized as unknown as TrustedProductRecord;
}

/** Field slice promote.ts uses to preserve values on unparseable fields. */
function priorFieldsFrom(
  record: TrustedProductRecord,
): PriorTrustedFields {
  return {
    caffeineMg: record.caffeineMg,
    caloriesKcal: record.caloriesKcal,
    sugarG: record.sugarG,
    serving: record.serving,
  };
}

// ---------------------------------------------------------------------------
// pulse.ingest.run — raw records -> candidate observations (idempotent)
// ---------------------------------------------------------------------------

export function createIngestRunHandler(
  runtime: PulseJobRuntime,
): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.ingest.run";
    const parsedPayload = RUN_ID_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(
        job,
        "invalid_payload",
        "payload must be { runId: string }",
        { issues: zodIssues(parsedPayload.error) },
      );
    }
    const runId = parsedPayload.data.runId;

    return runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) {
        return failedResult(
          job,
          "run_not_found",
          `collection run ${runId} does not exist`,
          { runId },
        );
      }

      const parsed = await parseRunRows(repo, runId);
      if (parsed === null) {
        return failedResult(
          job,
          "run_not_found",
          `collection run ${runId} does not exist`,
          { runId },
        );
      }

      let source: SourceRow | null = null;
      let insertedObservations = 0;
      let duplicateObservations = 0;

      const candidates = [...parsed.candidatesByFingerprint.values()];
      const firstCandidate = candidates[0];
      if (firstCandidate !== undefined) {
        source = await resolveSource(repo, firstCandidate);
        if (source === null) {
          return failedResult(
            job,
            "source_not_registered",
            `source "${firstCandidate.identity.sourceId}" is not registered; register it before ingesting`,
            { runId, sourceSlug: firstCandidate.identity.sourceId },
          );
        }
      }
      const existingFingerprints = new Set(
        source === null
          ? []
          : await repo.listObservationFingerprints(
              source.id,
              candidates.map((candidate) => candidate.pageFingerprint),
            ),
      );

      for (const candidate of candidates) {
        // Idempotency: (source, fingerprint) first, then the insert-level
        // unique constraints ((source, slug, observed_at) included).
        if (existingFingerprints.has(candidate.pageFingerprint)) {
          duplicateObservations += 1;
          continue;
        }

        if (source === null) throw new Error("source resolution invariant failed");

        const product = await repo.upsertProductBySlug({
          slug: candidate.identity.slug,
          name: candidate.name,
          categoryLabel: candidate.categoryLabel,
        });
        const observation = await repo.insertObservation({
          productId: product.id,
          sourceId: source.id,
          slug: candidate.identity.slug,
          observedAt: new Date(candidate.observedAt),
          pageFingerprint: candidate.pageFingerprint,
          status: "candidate",
          normalized: candidate as JsonObject,
        });
        if (observation === null) {
          duplicateObservations += 1;
          continue;
        }

        insertedObservations += 1;
        await persistCandidateEntities(
          repo,
          product.id,
          observation.id,
          observation.observedAt,
          candidate,
        );
      }

      const ingestion = {
        rawRecordCount:
          parsed.validatableRows.length +
          parsed.unparsableRecordIds.length +
          parsed.collectorErrorRecordIds.length,
        parsedRowCount: parsed.validatableRows.length,
        insertedObservations,
        duplicateObservations,
        unparsableRecords: parsed.unparsableRecordIds.length,
        collectorErrorRecords: parsed.collectorErrorRecordIds.length,
        completedAtIso: runtime.now().toISOString(),
      };
      const priorIngestion = reportSection(run.report, "ingestion");
      const replayOnly = insertedObservations === 0 && priorIngestion !== null;
      await repo.updateCollectionRun(runId, {
        report: {
          ...(run.report ?? {}),
          ingestion: replayOnly ? priorIngestion : ingestion,
          ...(replayOnly ? { ingestionReplay: ingestion } : {}),
        },
      });

      return okResult(job, `ingested ${insertedObservations} candidate observation(s)`, {
        runId,
        rawRecordCount:
          parsed.validatableRows.length +
          parsed.unparsableRecordIds.length +
          parsed.collectorErrorRecordIds.length,
        parsedRowCount: parsed.validatableRows.length,
        insertedObservations,
        duplicateObservations,
        unparsableRecords: parsed.unparsableRecordIds.length,
        unparsableRecordIds: parsed.unparsableRecordIds,
        collectorErrorRecords: parsed.collectorErrorRecordIds.length,
        collectorErrorRecordIds: parsed.collectorErrorRecordIds,
      });
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.validate.run — run-level checks -> collection_runs.report + status
// ---------------------------------------------------------------------------

export function createValidateRunHandler(
  runtime: PulseJobRuntime,
): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.validate.run";
    const parsedPayload = RUN_ID_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(
        job,
        "invalid_payload",
        "payload must be { runId: string }",
        { issues: zodIssues(parsedPayload.error) },
      );
    }
    const runId = parsedPayload.data.runId;

    return runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) {
        return failedResult(
          job,
          "run_not_found",
          `collection run ${runId} does not exist`,
          { runId },
        );
      }

      const parsed = await parseRunRows(repo, runId);
      if (parsed === null) {
        return failedResult(job, "run_not_found", `collection run ${runId} does not exist`, { runId });
      }

      const previousRowCount = await repo.getPreviousRunRowCount(
        run.collectorId,
        run.id,
        run.createdAt,
      );
      const landing = reportSection(run.report, "landing");
      const terminalPageErrors = Math.max(
        parsed.collectorErrorRecordIds.length,
        typeof landing?.terminalPageErrors === "number"
          ? landing.terminalPageErrors
          : 0,
      );
      const validation = validateRun(parsed.validatableRows, {
        previousRunCount: previousRowCount ?? undefined,
        unparsableRecordCount: parsed.unparsableRecordIds.length,
        collectorErrorRecordCount: terminalPageErrors,
      });
      const nonObjectRowsSkipped =
        typeof landing?.nonObjectRowsSkipped === "number"
          ? landing.nonObjectRowsSkipped
          : 0;
      const discoveredInputCount =
        typeof landing?.inputRows === "number"
          ? landing.inputRows
          : parsed.validatableRows.length +
            parsed.unparsableRecordIds.length +
            parsed.collectorErrorRecordIds.length;
      const manifestReconciliation = {
        discoveredInputCount,
        successfulRows: parsed.validatableRows.length,
        terminalPageErrors,
        invalidRows: parsed.unparsableRecordIds.length + nonObjectRowsSkipped,
        reconciled:
          parsed.validatableRows.length +
            terminalPageErrors +
            parsed.unparsableRecordIds.length +
            nonObjectRowsSkipped ===
          discoveredInputCount,
      };
      const sourceListingSlugs = new Set(
        Object.entries(caffeineInformerTaxonomyManifest.entries)
          .filter(
            ([, entry]) =>
              entry.listingUrl ===
              "https://www.caffeineinformer.com/the-caffeine-database",
          )
          .map(([slug]) => slug),
      );
      const collectedSlugs = new Set(
        parsed.validatableRows.map((row) => row.source.slug),
      );
      const taxonomyReconciliation = {
        manifestId: caffeineInformerTaxonomyManifest.manifestId,
        sourceListingUniqueSlugs: sourceListingSlugs.size,
        matchedSourceListingSlugs: [...collectedSlugs].filter((slug) =>
          sourceListingSlugs.has(slug),
        ).length,
        missingSourceListingSlugs: [...sourceListingSlugs].filter(
          (slug) => !collectedSlugs.has(slug),
        ).length,
        providerOnlySlugs: [...collectedSlugs].filter(
          (slug) => !sourceListingSlugs.has(slug),
        ).length,
      };

      const firstFail =
        validation.findings.find((finding) => finding.severity === "fail") ??
        null;
      const status = validation.ok ? "validated" : "validation_failed";

      await repo.updateCollectionRun(runId, {
        status,
        report: {
          ...(run.report ?? {}),
          findings: validation.findings,
          rowCount: parsed.validatableRows.length,
          unparsableRecordIds: parsed.unparsableRecordIds,
          collectorErrorRecordIds: parsed.collectorErrorRecordIds,
          previousRunCount: previousRowCount ?? null,
          validatedAtIso: runtime.now().toISOString(),
          validation: {
            ok: validation.ok,
            status,
            findingCount: validation.findings.length,
            rowCount: parsed.validatableRows.length,
            collectorErrorRecords: terminalPageErrors,
            completedAtIso: runtime.now().toISOString(),
          },
          manifestReconciliation,
          taxonomyReconciliation,
        },
        ...(validation.ok
          ? { errorCode: null, errorSummary: null }
          : {
              errorCode: "validation_failed",
              errorSummary: firstFail?.detail ?? "run-level validation failed",
            }),
      });

      return okResult(
        job,
        `validation ${status}: ${validation.findings.length} finding(s)`,
        {
          runId,
          validationOk: validation.ok,
          status,
          findings: validation.findings,
          rowCount: parsed.validatableRows.length,
          previousRowCount: previousRowCount ?? null,
          collectorErrorRecords: terminalPageErrors,
          manifestReconciliation,
          taxonomyReconciliation,
        },
      );
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.promote.snapshot — verdicts -> trusted pointer / quarantine + events
// ---------------------------------------------------------------------------

export function createPromoteSnapshotHandler(
  runtime: PulseJobRuntime,
): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.promote.snapshot";
    const parsedPayload = RUN_ID_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(
        job,
        "invalid_payload",
        "payload must be { runId: string }",
        { issues: zodIssues(parsedPayload.error) },
      );
    }
    const runId = parsedPayload.data.runId;

    return runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) {
        return failedResult(
          job,
          "run_not_found",
          `collection run ${runId} does not exist`,
          { runId },
        );
      }
      if (run.status !== "validated") {
        return failedResult(
          job,
          "run_not_validated",
          `collection run ${runId} is ${run.status}; promotion requires a validated run`,
          { runId, status: run.status },
        );
      }

      const parsed = await parseRunRows(repo, runId);
      if (parsed === null) {
        return failedResult(
          job,
          "run_not_found",
          `collection run ${runId} does not exist`,
          { runId },
        );
      }

      let source: SourceRow | null = null;
      for (const candidate of parsed.candidatesByFingerprint.values()) {
        source ??= await resolveSource(repo, candidate);
        break;
      }
      if (source === null && parsed.candidatesByFingerprint.size > 0) {
        return failedResult(
          job,
          "source_not_registered",
          "no source is registered for this run's rows",
          { runId },
        );
      }

      // Only CURRENTLY-CANDIDATE observations are promotable, which makes
      // re-dispatching a promote snapshot idempotent (already-promoted or
      // already-quarantined rows are skipped implicitly).
      const candidateObservations =
        source === null
          ? []
          : await repo.listCandidateObservationsByFingerprints(
              source.id,
              [...parsed.candidatesByFingerprint.keys()],
            );

      let promoted = 0;
      let quarantined = 0;
      let skippedWithoutProduct = 0;
      let changeEventsInserted = 0;
      const incidentIds: string[] = [];

      for (const observation of candidateObservations) {
        const candidate = parsed.candidatesByFingerprint.get(
          observation.pageFingerprint,
        );
        if (candidate === undefined) continue;

        const product = await repo.getProduct(observation.productId);
        if (product === null) {
          skippedWithoutProduct += 1;
          continue;
        }

        const priorRecord = await loadPriorTrustedRecord(
          repo,
          product.currentTrustedObservationId,
        );
        const decision = promoteCandidate(candidate, {
          previousTrusted: priorRecord === null ? null : priorFieldsFrom(priorRecord),
        });

        if (decision.overall === "quarantined") {
          // Observation STAYS (quarantined); prior trusted record remains
          // public. One incident per candidate summarizing all field incidents.
          await repo.updateObservation(observation.id, {
            status: "quarantined",
          });
          const incident = await repo.openIncident({
            collectionRunId: runId,
            title: `Promotion quarantined: ${product.slug}`,
            summary:
              decision.incidents.length > 0
                ? decision.incidents
                    .map((incident) => `${incident.field}/${incident.code}: ${incident.detail}`)
                    .join(" | ")
                : "promotion quarantined the candidate",
            detectedAt: runtime.now(),
          });
          incidentIds.push(incident.id);
          quarantined += 1;
          continue;
        }

        // Trusted: store the TRUSTED RECORD as the observation payload, demote
        // any other trusted observations, move the product pointer, then diff
        // against the previous trusted record for change events.
        await repo.updateObservation(observation.id, {
          status: "trusted",
          // Keep the public-facing derived blocks beside the trusted record.
          // Media is deliberately audit-only until an explicit publication
          // policy changes; raw image URLs remain in the quarantined evidence.
          normalized: {
            ...decision.record,
            concentration: candidate.concentration,
            media: { imageUrl: null, publicationState: "audit_only" },
          } as JsonObject,
        });
        await repo.supersedeOtherTrustedObservations(product.id, observation.id);
        await repo.updateProduct(product.id, {
          currentTrustedObservationId: observation.id,
        });

        const events: ChangeEvent[] = diffTrustedRecords(
          priorRecord,
          decision.record,
          decision.record.observedAt,
        );
        for (const event of events) {
          await repo.insertChangeEvent({
            productId: product.id,
            eventType: event.type,
            before:
              event.before === null
                ? null
                : ({ ...event.before, field: event.field ?? null } as JsonObject),
            after:
              event.after === null
                ? null
                : ({ ...event.after, field: event.field ?? null } as JsonObject),
            productObservationId: observation.id,
            occurredAt: new Date(event.observedAt),
          });
        }
        changeEventsInserted += events.length;
        promoted += 1;
      }

      const promotion = {
        candidateCount: candidateObservations.length,
        promoted,
        quarantined,
        skippedWithoutProduct,
        changeEventsInserted,
        incidentIds,
        completedAtIso: runtime.now().toISOString(),
      };
      const priorPromotion = reportSection(run.report, "promotion");
      const replayOnly =
        candidateObservations.length === 0 && priorPromotion !== null;
      await repo.updateCollectionRun(runId, {
        report: {
          ...(run.report ?? {}),
          promotion: replayOnly ? priorPromotion : promotion,
          ...(replayOnly ? { promotionReplay: promotion } : {}),
        },
      });

      return okResult(job, `promoted ${promoted}, quarantined ${quarantined}`, {
        runId,
        ...promotion,
        unparsableRecords: parsed.unparsableRecordIds.length,
        collectorErrorRecords: parsed.collectorErrorRecordIds.length,
      });
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.detect.changes — report-backed, idempotent change stage
// ---------------------------------------------------------------------------

/**
 * Promotion writes trusted-to-trusted change events in the same transaction
 * as the pointer update. This job is the explicit downstream stage used by
 * queue callers: it verifies that promotion completed and exposes the
 * durable result without ever duplicating events on retry.
 */
export function createDetectChangesHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.detect.changes";
    const parsedPayload = RUN_ID_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must be { runId: string }", {
        issues: zodIssues(parsedPayload.error),
      });
    }
    const runId = parsedPayload.data.runId;
    return runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) {
        return failedResult(job, "run_not_found", `collection run ${runId} does not exist`, {
          runId,
        });
      }
      const promotion = reportSection(run.report, "promotion");
      if (promotion === null) {
        return failedResult(
          job,
          "promotion_required",
          "change detection requires a completed promotion stage",
          { runId, status: run.status },
        );
      }
      return okResult(
        job,
        "trusted-to-trusted change events were recorded during promotion",
        {
          runId,
          changeEventsInserted: promotion.changeEventsInserted ?? 0,
          trustedTransitions: promotion.promoted ?? 0,
          idempotent: true,
        },
      );
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.retention — explicit safe no-op until a retention policy is approved
// ---------------------------------------------------------------------------

export function createRetentionHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.retention";
    const parsedPayload = RETENTION_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must be { dryRun?: boolean }", {
        issues: zodIssues(parsedPayload.error),
      });
    }
    void runtime;
    return skippedResult(
      job,
      "retention_policy_not_configured",
      "raw PulseRank records remain append-only; no retention mutation was applied",
      {
        dryRun: parsedPayload.data.dryRun,
        immutableRawRecords: true,
        actionRequired: "configure and approve a retention trigger before expiry",
      },
    );
  };
}

// ---------------------------------------------------------------------------
// pulse.incident.open — durable incident result from promotion
// ---------------------------------------------------------------------------

/**
 * Quarantine incidents are opened atomically by `pulse.promote.snapshot` so
 * a candidate cannot become quarantined without an audit record. This job
 * provides the queue-visible incident stage and is safe to retry because it
 * reads the persisted promotion report instead of inserting duplicates.
 */
export function createIncidentOpenHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.incident.open";
    const parsedPayload = RUN_ID_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must be { runId: string }", {
        issues: zodIssues(parsedPayload.error),
      });
    }
    const runId = parsedPayload.data.runId;
    return runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) {
        return failedResult(job, "run_not_found", `collection run ${runId} does not exist`, {
          runId,
        });
      }
      const promotion = reportSection(run.report, "promotion");
      if (promotion === null) {
        return failedResult(
          job,
          "promotion_required",
          "incident opening requires a completed promotion stage",
          { runId, status: run.status },
        );
      }
      const incidentIds = Array.isArray(promotion.incidentIds)
        ? promotion.incidentIds.filter((value): value is string => typeof value === "string")
        : [];
      return okResult(
        job,
        incidentIds.length > 0
          ? `promotion opened ${incidentIds.length} quarantine incident(s)`
          : "promotion completed without quarantine incidents",
        {
          runId,
          incidentIds,
          opened: incidentIds.length,
          idempotent: true,
        },
      );
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.heal.preview / pulse.heal.verify — approval-gated same-collector flow
// ---------------------------------------------------------------------------

export function createHealPreviewHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.heal.preview";
    if (runtime.flags.judgeMutationsEnabled !== true) {
      return skippedResult(
        job,
        "judge_mutations_disabled",
        "skipped: PULSERANK_JUDGE_MUTATIONS_ENABLED is disabled",
      );
    }

    const parsedPayload = HEAL_PREVIEW_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must include sourceUrl and prompt", {
        issues: zodIssues(parsedPayload.error),
      });
    }
    const { sourceUrl, prompt } = parsedPayload.data;
    if (!isAllowedCaffeineInformerUrl(sourceUrl)) {
      return failedResult(
        job,
        "source_not_allowed",
        "heal previews are restricted to HTTPS caffeineinformer.com pages",
      );
    }
    if (runtime.healPreview === undefined) {
      return failedResult(
        job,
        "healing_provider_unconfigured",
        "the Bright Data healing provider is not configured for this worker",
      );
    }

    let envelope: z.infer<typeof brightDataHealEnvelopeSchema>;
    try {
      const result = await runtime.healPreview(prompt, sourceUrl);
      const parsedEnvelope = brightDataHealEnvelopeSchema.safeParse(result);
      if (!parsedEnvelope.success) {
        return failedResult(
          job,
          "preview_envelope_invalid",
          "Bright Data healing returned an unexpected envelope",
          { issues: zodIssues(parsedEnvelope.error) },
        );
      }
      envelope = parsedEnvelope.data;
    } catch (error) {
      return failedResult(
        job,
        "healing_provider_failed",
        error instanceof Error ? error.message : "Bright Data healing failed",
      );
    }

    if (envelope.collector_id !== JUDGE_COLLECTOR_ID) {
      return failedResult(
        job,
        "collector_identity_changed",
        "the heal preview was returned for a collector other than the active PulseRank collector",
        { collectorId: envelope.collector_id, expectedCollectorId: JUDGE_COLLECTOR_ID },
      );
    }
    if (envelope.status !== "awaiting_approval") {
      return failedResult(
        job,
        "approval_gate_missing",
        "the heal provider did not stop at the required human approval gate",
        { providerStatus: envelope.status },
      );
    }

    const validated = validateHealPreview(envelope, runtime.now());
    if ("errorCode" in validated) {
      return failedResult(job, validated.errorCode, validated.message, validated.details);
    }

    try {
      return await runtime.runTransaction(async (repo) => {
        const collector = await repo.findActiveCollector();
        if (collector === null) {
          return failedResult(job, "no_active_collector", "no active PulseRank collector is registered");
        }
        if (collector.externalId !== JUDGE_COLLECTOR_ID) {
          return failedResult(
            job,
            "collector_identity_changed",
            "the active PulseRank collector does not match the approved healing identity",
            { collectorId: collector.externalId, expectedCollectorId: JUDGE_COLLECTOR_ID },
          );
        }
        const session = await repo.insertHealSession({
          collectorId: collector.id,
          prompt,
          preview: {
            sourceUrl,
            prompt,
            provider: envelope,
            validation: {
              ok: true,
              rowCount: validated.rowCount,
              findings: validated.findings,
            },
          },
        });
        return okResult(
          job,
          "heal preview validated and stored; explicit human approval is still required",
          {
            sessionId: session.id,
            collectorId: collector.externalId,
            collectorRowId: collector.id,
            providerStatus: envelope.status,
            previewRowCount: validated.rowCount,
            approvalRequired: true,
          },
        );
      });
    } catch (error) {
      return failedResult(
        job,
        "heal_session_persist_failed",
        error instanceof Error ? error.message : "could not persist the heal session",
      );
    }
  };
}

export function createHealVerifyHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.heal.verify";
    if (runtime.flags.judgeMutationsEnabled !== true) {
      return skippedResult(
        job,
        "judge_mutations_disabled",
        "skipped: PULSERANK_JUDGE_MUTATIONS_ENABLED is disabled",
      );
    }
    const parsedPayload = HEAL_VERIFY_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must include sessionId", {
        issues: zodIssues(parsedPayload.error),
      });
    }

    const sessionCheck = await runtime.runTransaction(async (repo) => {
      const session = await repo.getHealSession(parsedPayload.data.sessionId);
      if (session === null) {
        return { ok: false as const, errorCode: "heal_session_not_found", message: "heal session does not exist" };
      }
      if (session.approvedAt === null) {
        return {
          ok: false as const,
          errorCode: "human_approval_required",
          message: "the heal session has not received explicit human approval",
        };
      }
      const collector = await repo.findActiveCollector();
      if (collector === null || collector.id !== session.collectorId || collector.externalId !== JUDGE_COLLECTOR_ID) {
        return {
          ok: false as const,
          errorCode: "collector_identity_changed",
          message: "the approved session no longer points at the active PulseRank collector",
        };
      }
      const sourceUrl = session.preview.sourceUrl;
      if (typeof sourceUrl !== "string" || !isAllowedCaffeineInformerUrl(sourceUrl)) {
        return {
          ok: false as const,
          errorCode: "source_not_allowed",
          message: "the approved session has no allowed Caffeine Informer source URL",
        };
      }
      return { ok: true as const, sourceUrl };
    });
    if (!sessionCheck.ok) {
      return failedResult(job, sessionCheck.errorCode, sessionCheck.message, {
        sessionId: parsedPayload.data.sessionId,
      });
    }

    const collected = await collectAndPersist(
      runtime,
      { mode: "sample", url: sessionCheck.sourceUrl },
      "job:pulse.heal.verify",
    );
    if (!collected.ok) {
      return failedResult(job, collected.errorCode, collected.message, {
        sessionId: parsedPayload.data.sessionId,
      });
    }

    const runId = collected.runId;
    const stages: Record<string, PulseJobExecutionResult> = {};
    const stageHandlers = {
      "pulse.ingest.run": createIngestRunHandler(runtime),
      "pulse.validate.run": createValidateRunHandler(runtime),
      "pulse.promote.snapshot": createPromoteSnapshotHandler(runtime),
      "pulse.rebuild.leaderboards": createRebuildLeaderboardsHandler(runtime),
    } as const;
    const stageJobs = [
      "pulse.ingest.run",
      "pulse.validate.run",
      "pulse.promote.snapshot",
      "pulse.rebuild.leaderboards",
    ] as const;
    for (const stageJob of stageJobs) {
      const stage = await stageHandlers[stageJob]({
        job: stageJob,
        payload: stageJob === "pulse.rebuild.leaderboards" ? {} : { runId },
      });
      stages[stageJob] = stage;
      if (stage.status !== "ok") {
        return failedResult(job, "verification_stage_failed", `${stageJob} failed during heal verification`, {
          sessionId: parsedPayload.data.sessionId,
          runId,
          failedStage: stageJob,
          stage,
        });
      }
      if (stageJob === "pulse.validate.run" && stage.details.validationOk !== true) {
        return failedResult(job, "verification_validation_failed", "the approved rerun failed validation", {
          sessionId: parsedPayload.data.sessionId,
          runId,
          stage,
        });
      }
    }

    const promotion = stages["pulse.promote.snapshot"];
    const promotionDetails =
      promotion !== undefined && promotion.status === "ok" ? promotion.details : null;
    const promoted = promotionDetails?.promoted ?? 0;
    if (promoted !== 1) {
      return failedResult(
        job,
        "verification_not_recovered",
        "the approved rerun validated but did not promote exactly one recovered observation",
        { sessionId: parsedPayload.data.sessionId, runId, promoted, stages },
      );
    }

    return okResult(job, "approved heal reran the same collector and recovered one trusted observation", {
      sessionId: parsedPayload.data.sessionId,
      runId,
      collectorId: JUDGE_COLLECTOR_ID,
      collectorRowId: collected.collectorId,
      rowCount: collected.rowCount,
      stages,
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.rebuild.leaderboards — deterministic boards over trusted records
// ---------------------------------------------------------------------------

export const LEADERBOARD_BOARD_KEYS = Object.freeze([
  "highest-total-caffeine",
  "highest-exact-concentration",
  "caffeine-free",
] as const);

export type LeaderboardBoardKey = (typeof LEADERBOARD_BOARD_KEYS)[number];

type BoardComputation = {
  key: LeaderboardBoardKey;
  metricValue: number;
  eligibilityFlags: string[];
};

type TrustedBoardInput = {
  productId: string;
  productSlug: string;
  record: TrustedProductRecord;
};

function wellFormedRange(metric: TrustedProductRecord["caffeineMg"]): boolean {
  return (
    metric.min !== null &&
    metric.max !== null &&
    metric.min <= metric.max
  );
}

function totalCaffeineMetricValue(
  record: TrustedProductRecord,
): number | null {
  const caffeine = record.caffeineMg;
  if (caffeine.state === "conflicting") return null;
  if (caffeine.value !== null) return caffeine.value;
  if (wellFormedRange(caffeine)) return caffeine.min;
  return null;
}

/** mg per 100 ml — exact caffeine value over a positive ml serving, 1dp. */
function exactConcentrationMetricValue(
  record: TrustedProductRecord,
): number | null {
  const caffeine = record.caffeineMg;
  const normalizedMl = record.serving.normalizedMl;
  if (caffeine.qualifier !== "exact" || caffeine.value === null) return null;
  if (normalizedMl === null || !(normalizedMl > 0)) return null;
  const raw = (caffeine.value / normalizedMl) * 100;
  return Math.round(raw * 10) / 10;
}

function computeBoards(input: TrustedBoardInput): BoardComputation[] {
  const boards: BoardComputation[] = [];

  const totalCaffeine = totalCaffeineMetricValue(input.record);
  if (totalCaffeine !== null) {
    boards.push({
      key: "highest-total-caffeine",
      metricValue: totalCaffeine,
      eligibilityFlags:
        input.record.caffeineMg.value !== null
          ? [`value_${input.record.caffeineMg.qualifier}`]
          : ["range"],
    });
  }

  const concentration = exactConcentrationMetricValue(input.record);
  if (concentration !== null) {
    boards.push({
      key: "highest-exact-concentration",
      metricValue: concentration,
      eligibilityFlags: ["exact_caffeine", "ml_normalized"],
    });
  }

  if (input.record.caffeineMg.state !== "conflicting" && input.record.caffeineMg.value === 0) {
    boards.push({
      key: "caffeine-free",
      metricValue: 0,
      eligibilityFlags: ["explicit_zero"],
    });
  }

  return boards;
}

export function createRebuildLeaderboardsHandler(
  runtime: PulseJobRuntime,
): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.rebuild.leaderboards";
    const parsedPayload = z
      .object({ runId: z.string().min(1).optional() })
      .safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload may include a runId", {
        issues: zodIssues(parsedPayload.error),
      });
    }

    return runtime.runTransaction(async (repo) => {
      const trusted = await repo.listTrustedObservationPayloads();
      const inputs: TrustedBoardInput[] = [];
      for (const row of trusted) {
        inputs.push({
          productId: row.productId,
          productSlug: row.productSlug,
          record: row.payload as unknown as TrustedProductRecord,
        });
      }

      // Precompute each product's board membership once (deterministic).
      const grouped = new Map<LeaderboardBoardKey, TrustedBoardInput[]>();
      const metrics = new Map<string, BoardComputation>();
      for (const boardKey of LEADERBOARD_BOARD_KEYS) grouped.set(boardKey, []);
      for (const input of inputs) {
        for (const board of computeBoards(input)) {
          grouped.get(board.key)?.push(input);
          metrics.set(`${board.key}:${input.productSlug}`, board);
        }
      }

      // ONE SNAPSHOT PER BOARD: leaderboard_entries enforces
      // (snapshot_id, product_id) uniqueness, so a product may appear on only
      // one board per snapshot. Per-board snapshots keep every board complete
      // AND satisfy the reader contract ("most recent snapshot for board").
      // Ordering inside a board is deterministic: metric DESC, slug ASC.
      const counts: Record<string, number> = {};
      const snapshotIds: Record<string, string> = {};
      for (const boardKey of LEADERBOARD_BOARD_KEYS) {
        const entries = (grouped.get(boardKey) ?? []).sort((a, b) => {
          const metricA =
            metrics.get(`${boardKey}:${a.productSlug}`)?.metricValue ??
            Number.NEGATIVE_INFINITY;
          const metricB =
            metrics.get(`${boardKey}:${b.productSlug}`)?.metricValue ??
            Number.NEGATIVE_INFINITY;
          if (metricA !== metricB) return metricB - metricA;
          return a.productSlug < b.productSlug ? -1 : 1;
        });

        const snapshotId = await repo.insertLeaderboardSnapshot({
          boardKey,
          entryCount: entries.length,
          trustedProductCount: inputs.length,
        });

        let rank = 0;
        const boardEntries = [];
        for (const entry of entries) {
          rank += 1;
          const computation = metrics.get(`${boardKey}:${entry.productSlug}`);
          if (computation === undefined) continue;
          boardEntries.push({
            snapshotId,
            productId: entry.productId,
            rank,
            metricKey: boardKey,
            metricValue: computation.metricValue,
            eligible: true,
            eligibilityFlags: computation.eligibilityFlags,
          });
        }
        await repo.insertLeaderboardEntries(boardEntries);
        counts[boardKey] = entries.length;
        snapshotIds[boardKey] = snapshotId;
      }

      if (parsedPayload.data.runId !== undefined) {
        const run = await repo.getCollectionRun(parsedPayload.data.runId);
        if (run === null) {
          return failedResult(job, "run_not_found", "collection run was not found", {
            runId: parsedPayload.data.runId,
          });
        }
        await repo.updateCollectionRun(run.id, {
          report: {
            ...(run.report ?? {}),
            leaderboard: {
              snapshotIds,
              trustedProducts: inputs.length,
              entryCounts: counts,
              completedAtIso: runtime.now().toISOString(),
            },
          },
        });
      }

      return okResult(
        job,
        `rebuilt ${LEADERBOARD_BOARD_KEYS.length} leaderboard board(s)`,
        {
          snapshotIds,
          trustedProducts: inputs.length,
          entryCounts: counts,
        },
      );
    });
  };
}

// ---------------------------------------------------------------------------
// pulse.collect.* — flag-gated Bright Data collection
// ---------------------------------------------------------------------------

type CollectOutcome =
  | {
      ok: true;
      runId: string;
      collectorId: string;
      rowCount: number;
      duplicateRowsSkipped: number;
      nonObjectRowsSkipped: number;
      collectorErrorWarnings: number;
      fingerprint: string;
    }
  | { ok: false; errorCode: string; message: string };

/**
 * Open a collection_runs row (tx 1), run the CLI OUTSIDE any transaction, then
 * persist raw output BEFORE any processing and finalize the run (tx 2). A CLI
 * failure marks the run failed (tx 3) and surfaces a structured code.
 */
async function collectAndPersist(
  runtime: PulseJobRuntime,
  input: BdataCollectInput,
  trigger: string,
): Promise<CollectOutcome> {
  let collectorId: string;
  let runId: string;
  try {
    const opened = await runtime.runTransaction(async (repo) => {
      const collector = await repo.findActiveCollector();
      if (collector === null) {
        throw new Error("no active pulse collector is registered");
      }
      const run = await repo.insertCollectionRun({
        collectorId: collector.id,
        trigger,
        status: "running",
        startedAt: runtime.now(),
        finishedAt: null,
        rowCount: null,
        pageFingerprint: null,
        report: {
          mode: input.mode,
          ...(input.url !== undefined ? { url: input.url } : {}),
          ...(input.inputFile !== undefined
            ? { inputFile: input.inputFile }
            : {}),
        },
      });
      return { collectorId: collector.id, runId: run.id };
    });
    collectorId = opened.collectorId;
    runId = opened.runId;
  } catch (error) {
    return {
      ok: false,
      errorCode: "no_active_collector",
      message: error instanceof Error ? error.message : "collection setup failed",
    };
  }

  try {
    const output = await runtime.collect(input);
    const persisted = await runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) throw new Error("collection run disappeared before landing");
      const seen = new Set<string>();
      let stored = 0;
      let duplicateRowsSkipped = 0;
      let nonObjectRowsSkipped = 0;
      let collectorErrorWarnings = 0;
      const rawInputs: InsertRawRecordInput[] = [];

      for (const [index, row] of output.rows.entries()) {
        const landed = rawLandingFingerprint(row, index, seen);
        const fingerprint = landed.fingerprint;
        if (landed.duplicate || seen.has(fingerprint)) {
          duplicateRowsSkipped += 1;
          continue;
        }
        seen.add(fingerprint);
        // raw_records.payload is a jsonb object; scalar/array CLI rows are
        // counted but not stored (they carry no parseable page shape).
        if (row === null || typeof row !== "object" || Array.isArray(row)) {
          nonObjectRowsSkipped += 1;
          continue;
        }
        rawInputs.push({
          collectionRunId: runId,
          collectorId,
          payload: row as JsonObject,
          mediaType: "application/json",
          pageFingerprint: fingerprint,
          capturedAt: runtime.now(),
        });
        if (isCollectorErrorPayload(row)) collectorErrorWarnings += 1;
      }
      stored = (await repo.insertRawRecords(rawInputs)).length;

      await repo.updateCollectionRun(runId, {
        status: "succeeded",
        finishedAt: runtime.now(),
        rowCount: stored,
        pageFingerprint: output.fingerprint,
        report: {
          ...(run.report ?? {}),
          landing: {
            inputRows: output.rows.length,
            storedRows: stored,
            duplicateRowsSkipped,
            nonObjectRowsSkipped,
            collectorErrorWarnings,
          },
        },
      });
      return {
        rowCount: stored,
        duplicateRowsSkipped,
        nonObjectRowsSkipped,
        collectorErrorWarnings,
      };
    });

    return {
      ok: true,
      runId,
      collectorId,
      rowCount: persisted.rowCount,
      duplicateRowsSkipped: persisted.duplicateRowsSkipped,
      nonObjectRowsSkipped: persisted.nonObjectRowsSkipped,
      collectorErrorWarnings: persisted.collectorErrorWarnings,
      fingerprint: output.fingerprint,
    };
  } catch (error) {
    const errorCode =
      error instanceof BdataClientError ? error.code : "BDATA_CLI_FAILED";
    const message =
      error instanceof Error ? error.message : "Bright Data collection failed";
    try {
      await runtime.runTransaction(async (repo) => {
        await repo.updateCollectionRun(runId, {
          status: "failed",
          finishedAt: runtime.now(),
          errorCode,
          errorSummary: message,
        });
      });
    } catch {
      // Never mask the original collection failure with a bookkeeping failure.
    }
    return { ok: false, errorCode, message };
  }
}

function createCollectSampleHandler(
  runtime: PulseJobRuntime,
  job: Extract<PulseJobName, "pulse.collect.sample" | "pulse.collect.refresh-batch"> =
    "pulse.collect.sample",
): PulseJobHandler {
  return async ({ payload }) => {
    // Flag gate FIRST: a disabled flag skips before any db or network touch.
    if (!runtime.flags.collectionEnabled) {
      return skippedResult(
        job,
        "collection_disabled",
        "skipped: PULSERANK_COLLECTION_ENABLED is disabled",
      );
    }

    const parsedPayload = SAMPLE_COLLECT_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must include a url or inputFile", {
        issues: zodIssues(parsedPayload.error),
      });
    }

    const outcome = await collectAndPersist(
      runtime,
      {
        mode: "sample",
        url: parsedPayload.data.url,
        inputFile: parsedPayload.data.inputFile,
        timeoutMs: parsedPayload.data.timeoutMs,
      },
      "job:pulse.collect.sample",
    );
    if (!outcome.ok) {
      return failedResult(job, outcome.errorCode, outcome.message);
    }
    return okResult(job, `collected ${outcome.rowCount} raw row(s)`, {
      runId: outcome.runId,
      collectorId: outcome.collectorId,
      rowCount: outcome.rowCount,
      duplicateRowsSkipped: outcome.duplicateRowsSkipped,
      nonObjectRowsSkipped: outcome.nonObjectRowsSkipped,
      collectorErrorWarnings: outcome.collectorErrorWarnings,
      fingerprint: outcome.fingerprint,
    });
  };
}

function createCollectDiscoveryHandler(
  runtime: PulseJobRuntime,
): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.collect.discovery";

    if (!runtime.flags.discoveryEnabled) {
      return skippedResult(
        job,
        "discovery_disabled",
        "skipped: PULSERANK_DISCOVERY_ENABLED is disabled",
      );
    }

    const parsedPayload = DISCOVERY_COLLECT_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(
        job,
        "invalid_payload",
        "payload must be { query?: string, inputFile?: string } with at least one",
        { issues: zodIssues(parsedPayload.error) },
      );
    }

    let query: string;
    try {
      query = resolveDiscoveryQuery({
        mode: "discovery",
        url: parsedPayload.data.query,
        inputFile: parsedPayload.data.inputFile,
      });
    } catch (error) {
      return failedResult(
        job,
        error instanceof BdataClientError ? error.code : "invalid_payload",
        error instanceof Error ? error.message : "could not resolve discovery URL",
      );
    }
    if (!isAllowedCaffeineInformerUrl(query)) {
      return failedResult(
        job,
        "source_not_allowed",
        "discovery is restricted to an HTTPS Caffeine Informer listing URL",
      );
    }

    const submittedAt = runtime.now();
    const providerWindowEndsAt = new Date(
      submittedAt.getTime() +
        (parsedPayload.data.timeoutMs ?? DEFAULT_PROVIDER_WINDOW_MS),
    );
    let runId: string;
    let collectorId: string;
    try {
      const opened = await runtime.runTransaction(async (repo) => {
        const collector = await repo.findActiveCollector();
        if (collector === null) throw new Error("no active pulse collector is registered");
        const run = await repo.insertCollectionRun({
          collectorId: collector.id,
          trigger: "job:pulse.collect.discovery",
          status: "provider_submit",
          startedAt: submittedAt,
          finishedAt: null,
          rowCount: null,
          pageFingerprint: null,
          report: {
            mode: "discovery",
            query,
            taxonomy: {
              manifestId: caffeineInformerTaxonomyManifest.manifestId,
              fingerprint: caffeineInformerTaxonomyManifest.fingerprint,
              sourceListingEntryCount:
                caffeineInformerTaxonomyManifest.listings.find(
                  (listing) => listing.sourceCode === "DRINKS",
                )?.entryCount ?? null,
            },
            provider: {
              kind: "bright_data_dca",
              collectionId: null,
              submittedAt: submittedAt.toISOString(),
              lastPollAt: null,
              attempts: 0,
              status: "submitting",
              windowEndsAt: providerWindowEndsAt.toISOString(),
            },
          },
        });
        return { runId: run.id, collectorId: collector.id };
      });
      runId = opened.runId;
      collectorId = opened.collectorId;
    } catch (error) {
      return failedResult(
        job,
        "no_active_collector",
        error instanceof Error ? error.message : "collection setup failed",
      );
    }

    let collectionId: string;
    try {
      collectionId = (await runtime.provider.submit({ url: query })).collectionId;
      await runtime.runTransaction(async (repo) => {
        const run = await repo.getCollectionRun(runId);
        if (run === null) throw new Error("collection run disappeared after provider submit");
        await repo.updateCollectionRun(runId, {
          status: "provider_wait",
          report: {
            ...(run.report ?? {}),
            provider: {
              kind: "bright_data_dca",
              collectionId,
              submittedAt: submittedAt.toISOString(),
              lastPollAt: null,
              attempts: 0,
              status: "submitted",
              windowEndsAt: providerWindowEndsAt.toISOString(),
            },
          },
          errorCode: null,
          errorSummary: null,
        });
      });
    } catch (error) {
      const errorCode =
        error instanceof BrightDataProviderError
          ? error.code
          : "provider_submit_failed";
      const message =
        error instanceof Error ? error.message : "Bright Data submission failed";
      try {
        await runtime.runTransaction(async (repo) => {
          const run = await repo.getCollectionRun(runId);
          await repo.updateCollectionRun(runId, {
            status: "failed",
            finishedAt: runtime.now(),
            errorCode,
            errorSummary: message,
            report: {
              ...(run?.report ?? {}),
              provider: {
                kind: "bright_data_dca",
                collectionId: null,
                submittedAt: submittedAt.toISOString(),
                lastPollAt: null,
                attempts: 0,
                status: "failed",
                windowEndsAt: providerWindowEndsAt.toISOString(),
              },
            },
          });
        });
      } catch {
        // Preserve the original provider failure.
      }
      return failedResult(job, errorCode, message, { runId });
    }

    let pollQueued = true;
    try {
      await runtime.enqueue({
        name: "pulse.collect.poll",
        payload: { runId },
        idempotencyKey: `pulse.collect.poll:${runId}:0`,
        scheduledFor: runtime.now(),
        maxAttempts: 3,
      });
    } catch {
      // The persisted collection id is the recovery authority. An operator can
      // resume even when the initial queue write failed.
      pollQueued = false;
    }

    return okResult(job, "submitted discovery and persisted resumable provider state", {
      runId,
      collectorId,
      providerStatus: "submitted",
      pollQueued,
      hasCollectionId: collectionId.length > 0,
      providerWindowMinutes: Math.round(
        (providerWindowEndsAt.getTime() - submittedAt.getTime()) / 60_000,
      ),
    });
  };
}

function providerPollDelayMs(attempts: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempts - 1), 60_000);
}

function createCollectPollHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.collect.poll";
    if (!runtime.flags.collectionEnabled || !runtime.flags.discoveryEnabled) {
      return skippedResult(
        job,
        "collection_disabled",
        "skipped: asynchronous discovery collection is disabled",
      );
    }

    const parsedPayload = POLL_COLLECT_PAYLOAD_SCHEMA.safeParse(payload);
    if (!parsedPayload.success) {
      return failedResult(job, "invalid_payload", "payload must include a runId", {
        issues: zodIssues(parsedPayload.error),
      });
    }
    const { runId, resume } = parsedPayload.data;
    const loaded = await runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      return { run, rawCount: (await repo.listRawRecords(runId)).length };
    });
    if (loaded.run === null) {
      return failedResult(job, "run_not_found", "collection run was not found", {
        runId,
      });
    }

    let state = providerState(loaded.run.report);
    if (state === null) {
      return failedResult(
        job,
        "provider_state_missing",
        "collection run has no resumable provider state",
        { runId },
      );
    }
    if (state.status === "ready") {
      return okResult(job, "provider dataset was already landed", {
        runId,
        providerStatus: "ready",
        rowCount: loaded.rawCount,
        attempts: state.attempts,
        idempotentReplay: true,
      });
    }

    const pollStartedAt = runtime.now();
    if (resume) {
      state = {
        ...state,
        status: "resuming",
        windowEndsAt: new Date(
          pollStartedAt.getTime() + DEFAULT_PROVIDER_WINDOW_MS,
        ).toISOString(),
      };
      await runtime.runTransaction(async (repo) => {
        const run = await repo.getCollectionRun(runId);
        if (run === null) throw new Error("collection run disappeared during resume");
        await repo.updateCollectionRun(runId, {
          status: "provider_wait",
          finishedAt: null,
          errorCode: null,
          errorSummary: null,
          report: { ...(run.report ?? {}), provider: state as unknown as JsonObject },
        });
      });
    } else if (pollStartedAt.getTime() >= Date.parse(state.windowEndsAt)) {
      await runtime.runTransaction(async (repo) => {
        const run = await repo.getCollectionRun(runId);
        if (run === null) throw new Error("collection run disappeared during timeout");
        await repo.updateCollectionRun(runId, {
          status: "provider_wait_timeout",
          finishedAt: pollStartedAt,
          errorCode: "provider_wait_timeout",
          errorSummary: "The provider wait window elapsed; this run remains resumable.",
          report: {
            ...(run.report ?? {}),
            provider: { ...state, status: "timed_out" },
          },
        });
      });
      return okResult(job, "provider wait window elapsed; run remains resumable", {
        runId,
        providerStatus: "timed_out",
        attempts: state.attempts,
        resumable: true,
      });
    }

    const attempts = state.attempts + 1;
    let providerResult: Awaited<ReturnType<BrightDataProvider["poll"]>>;
    try {
      providerResult = await runtime.provider.poll(state.collectionId);
    } catch (error) {
      const retryable =
        error instanceof BrightDataProviderError && error.retryable;
      const errorCode =
        error instanceof BrightDataProviderError
          ? error.code
          : "provider_poll_failed";
      const message =
        error instanceof Error ? error.message : "Bright Data polling failed";
      const failedAt = runtime.now();
      const withinWindow = failedAt.getTime() < Date.parse(state.windowEndsAt);

      if (retryable && withinWindow) {
        await runtime.runTransaction(async (repo) => {
          const run = await repo.getCollectionRun(runId);
          if (run === null) throw new Error("collection run disappeared during retry");
          await repo.updateCollectionRun(runId, {
            status: "provider_wait",
            report: {
              ...(run.report ?? {}),
              provider: {
                ...state,
                attempts,
                lastPollAt: failedAt.toISOString(),
                status: "retrying",
              },
            },
            errorCode,
            errorSummary: message,
          });
        });
        await runtime.enqueue({
          name: job,
          payload: { runId },
          idempotencyKey: `pulse.collect.poll:${runId}:${attempts}`,
          scheduledFor: new Date(failedAt.getTime() + providerPollDelayMs(attempts)),
          maxAttempts: 3,
        });
        return okResult(job, "provider poll will retry with bounded backoff", {
          runId,
          providerStatus: "retrying",
          attempts,
        });
      }

      if (retryable && !withinWindow) {
        await runtime.runTransaction(async (repo) => {
          const run = await repo.getCollectionRun(runId);
          if (run === null) throw new Error("collection run disappeared during timeout");
          await repo.updateCollectionRun(runId, {
            status: "provider_wait_timeout",
            finishedAt: failedAt,
            errorCode: "provider_wait_timeout",
            errorSummary:
              "The provider wait window elapsed; this run remains resumable.",
            report: {
              ...(run.report ?? {}),
              provider: {
                ...state,
                attempts,
                lastPollAt: failedAt.toISOString(),
                status: "timed_out",
              },
            },
          });
        });
        return okResult(job, "provider wait window elapsed; run remains resumable", {
          runId,
          providerStatus: "timed_out",
          attempts,
          resumable: true,
        });
      }

      await runtime.runTransaction(async (repo) => {
        const run = await repo.getCollectionRun(runId);
        if (run === null) throw new Error("collection run disappeared after poll failure");
        await repo.updateCollectionRun(runId, {
          status: "failed",
          finishedAt: failedAt,
          errorCode,
          errorSummary: message,
          report: {
            ...(run.report ?? {}),
            provider: {
              ...state,
              attempts,
              lastPollAt: failedAt.toISOString(),
              status: "failed",
            },
          },
        });
      });
      return failedResult(job, errorCode, message, {
        runId,
        attempts,
        resumable: true,
      });
    }

    const polledAt = runtime.now();
    if (providerResult.status === "pending") {
      if (!resume && polledAt.getTime() >= Date.parse(state.windowEndsAt)) {
        await runtime.runTransaction(async (repo) => {
          const run = await repo.getCollectionRun(runId);
          if (run === null) throw new Error("collection run disappeared during timeout");
          await repo.updateCollectionRun(runId, {
            status: "provider_wait_timeout",
            finishedAt: polledAt,
            errorCode: "provider_wait_timeout",
            errorSummary:
              "The provider wait window elapsed; this run remains resumable.",
            report: {
              ...(run.report ?? {}),
              provider: {
                ...state,
                attempts,
                lastPollAt: polledAt.toISOString(),
                status: "timed_out",
              },
            },
          });
        });
        return okResult(job, "provider wait window elapsed; run remains resumable", {
          runId,
          providerStatus: "timed_out",
          attempts,
          resumable: true,
        });
      }
      await runtime.runTransaction(async (repo) => {
        const run = await repo.getCollectionRun(runId);
        if (run === null) throw new Error("collection run disappeared while pending");
        await repo.updateCollectionRun(runId, {
          status: "provider_wait",
          report: {
            ...(run.report ?? {}),
            provider: {
              ...state,
              attempts,
              lastPollAt: polledAt.toISOString(),
              status: "pending",
            },
          },
          errorCode: null,
          errorSummary: null,
        });
      });
      await runtime.enqueue({
        name: job,
        payload: { runId },
        idempotencyKey: `pulse.collect.poll:${runId}:${attempts}`,
        scheduledFor: new Date(polledAt.getTime() + providerPollDelayMs(attempts)),
        maxAttempts: 3,
      });
      return okResult(job, "provider dataset is not ready yet", {
        runId,
        providerStatus: "pending",
        attempts,
      });
    }

    const landed = await runtime.runTransaction(async (repo) => {
      const run = await repo.getCollectionRun(runId);
      if (run === null) throw new Error("collection run disappeared before landing");
      const currentState = providerState(run.report);
      const existing = await repo.listRawRecords(runId);
      if (currentState?.status === "ready") {
        return {
          rowCount: existing.length,
          stored: 0,
          duplicateRowsSkipped: 0,
          nonObjectRowsSkipped: 0,
          collectorErrorWarnings: existing.filter((row) =>
            isCollectorErrorPayload(row.payload),
          ).length,
          idempotentReplay: true,
        };
      }

      const seen = new Set(existing.map((row) => row.pageFingerprint));
      let stored = 0;
      let duplicateRowsSkipped = 0;
      let nonObjectRowsSkipped = 0;
      let collectorErrorWarnings = existing.filter((row) =>
        isCollectorErrorPayload(row.payload),
      ).length;
      const rawInputs: InsertRawRecordInput[] = [];
      for (const [index, row] of providerResult.rows.entries()) {
        const landed = rawLandingFingerprint(row, index, seen);
        const fingerprint = landed.fingerprint;
        if (landed.duplicate || seen.has(fingerprint)) {
          duplicateRowsSkipped += 1;
          continue;
        }
        seen.add(fingerprint);
        if (!isRecord(row)) {
          nonObjectRowsSkipped += 1;
          continue;
        }
        rawInputs.push({
          collectionRunId: runId,
          collectorId: run.collectorId,
          payload: row,
          mediaType: "application/json",
          pageFingerprint: fingerprint,
          capturedAt: polledAt,
        });
        if (isCollectorErrorPayload(row)) collectorErrorWarnings += 1;
      }
      stored = (await repo.insertRawRecords(rawInputs)).length;
      const providerTerminalErrors = providerResult.manifest.fails;
      collectorErrorWarnings = Math.max(
        collectorErrorWarnings,
        providerTerminalErrors,
      );
      const rowCount = existing.length + stored;
      await repo.updateCollectionRun(runId, {
        status: "succeeded",
        finishedAt: polledAt,
        rowCount,
        pageFingerprint: providerResult.fingerprint,
        errorCode: null,
        errorSummary: null,
        report: {
          ...(run.report ?? {}),
          provider: {
            ...state,
            attempts,
            lastPollAt: polledAt.toISOString(),
            status: "ready",
          },
          landing: {
            inputRows:
              providerResult.manifest.lines + providerTerminalErrors,
            storedRows: stored,
            duplicateRowsSkipped,
            nonObjectRowsSkipped,
            collectorErrorWarnings,
            terminalPageErrors: providerTerminalErrors,
            providerManifest: providerResult.manifest,
          },
        },
      });
      return {
        rowCount,
        stored,
        duplicateRowsSkipped,
        nonObjectRowsSkipped,
        collectorErrorWarnings,
        idempotentReplay: false,
      };
    });

    let ingestionQueued = true;
    if (!landed.idempotentReplay) {
      try {
        await runtime.enqueue({
          name: "pulse.ingest.run",
          payload: { runId },
          idempotencyKey: `pulse.ingest.run:${runId}`,
          scheduledFor: runtime.now(),
          maxAttempts: 3,
        });
      } catch {
        ingestionQueued = false;
      }
    }
    return okResult(job, "provider dataset landed immutably", {
      runId,
      providerStatus: "ready",
      rowCount: landed.rowCount,
      attempts,
      duplicateRowsSkipped: landed.duplicateRowsSkipped,
      nonObjectRowsSkipped: landed.nonObjectRowsSkipped,
      collectorErrorWarnings: landed.collectorErrorWarnings,
      terminalPageErrors: providerResult.manifest.fails,
      ingestionQueued,
      idempotentReplay: landed.idempotentReplay,
    });
  };
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

export type PulseJobStubFactory = (job: PulseJobName) => PulseJobHandler;

/**
 * Build the full handler registry around a runtime. The stub factory remains
 * a compatibility seam for callers that want to inject an intentionally
 * unavailable handler, but the default registry binds every planned job to a
 * real safe outcome.
 */
export function createPulseJobHandlers(
  runtime: PulseJobRuntime,
  notImplemented: PulseJobStubFactory,
): Record<PulseJobName, PulseJobHandler> {
  // Kept as a compatibility seam for isolated tests and downstream callers;
  // the production registry below no longer needs a stub fallback.
  void notImplemented;
  return {
    "pulse.collect.sample": createCollectSampleHandler(runtime),
    "pulse.collect.refresh-batch": createCollectSampleHandler(
      runtime,
      "pulse.collect.refresh-batch",
    ),
    "pulse.collect.discovery": createCollectDiscoveryHandler(runtime),
    "pulse.collect.poll": createCollectPollHandler(runtime),
    "pulse.ingest.run": createIngestRunHandler(runtime),
    "pulse.validate.run": createValidateRunHandler(runtime),
    "pulse.promote.snapshot": createPromoteSnapshotHandler(runtime),
    "pulse.detect.changes": createDetectChangesHandler(runtime),
    "pulse.rebuild.leaderboards": createRebuildLeaderboardsHandler(runtime),
    "pulse.retention": createRetentionHandler(runtime),
    "pulse.incident.open": createIncidentOpenHandler(runtime),
    "pulse.heal.preview": createHealPreviewHandler(runtime),
    "pulse.heal.verify": createHealVerifyHandler(runtime),
  };
}

/** Default binding used by the module-level registry in ./pulse-jobs. */
export function createDefaultPulseJobHandlers(
  notImplemented: PulseJobStubFactory,
): Record<PulseJobName, PulseJobHandler> {
  return createPulseJobHandlers(createDefaultPulseJobRuntime(), notImplemented);
}
