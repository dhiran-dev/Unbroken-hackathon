/**
 * PulseRank worker handler wiring (Agent A7b).
 *
 * Binds the six data-bearing pulse jobs to the deterministic pipeline stages
 * from `@/server/ingestion/*` and the Bright Data client, replacing their
 * `not_implemented` stubs in the dispatcher registry (`./pulse-jobs`). The
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
import {
  BdataClientError,
  collectViaBdata,
  rawOutputFingerprint,
  type BdataCollectInput,
} from "@/server/collection/bdata-client";
import {
  normalizeRow,
  type NormalizedCandidate,
} from "@/server/ingestion/normalize";
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
  type PulseRepo,
  type SourceRow,
} from "@/server/ingestion/repo";
import { validateRun, type ValidatableRow } from "@/server/ingestion/validate-run";
import {
  JUDGE_COLLECTOR_ID,
  toScrapeRow,
  type CollectorProductRecord,
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
}

export interface PulseJobRuntime {
  readonly runTransaction: PulseJobRunTransaction;
  /** Live flag values consulted by collect handlers at execution time. */
  readonly flags: PulseJobRuntimeFlags;
  /** Clock seam (handlers never call Date.now directly). */
  readonly now: () => Date;
  /** Bright Data client seam; unit tests substitute canned output. */
  readonly collect: typeof collectViaBdata;
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
      };
    },
    now: () => new Date(),
    collect: collectViaBdata,
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

const SAMPLE_COLLECT_PAYLOAD_SCHEMA = z.object({
  url: z.url(),
  timeoutMs: z.number().int().positive().max(30 * 60_000).optional(),
});

const DISCOVERY_COLLECT_PAYLOAD_SCHEMA = z
  .object({
    query: z.string().min(1).optional(),
    inputFile: z.string().min(1).optional(),
    timeoutMs: z.number().int().positive().max(30 * 60_000).optional(),
  })
  .refine(
    (payload) => payload.query !== undefined || payload.inputFile !== undefined,
    { message: "discovery needs a query or an inputFile" },
  );

// ---------------------------------------------------------------------------
// Shared pipeline helpers
// ---------------------------------------------------------------------------

type ParsedRunRows = {
  candidatesByFingerprint: Map<string, NormalizedCandidate>;
  validatableRows: ValidatableRow[];
  unparsableRecordIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The v2 collector emits flat product records, while the database contract is
 * deliberately stricter. Map only recognizable product rows; collector error
 * objects remain unparseable evidence and can never become products.
 */
function mapCollectorPayload(
  payload: unknown,
  observedAt: Date,
): unknown {
  if (!isRecord(payload) || payload.schemaVersion === "1.0") return payload;
  const hasProductIdentity =
    typeof payload.product_name === "string" && payload.product_name.trim() !== "";
  const hasProductUrl =
    typeof payload.product_page_url === "string" ||
    typeof payload.product_url === "string";
  if (!hasProductIdentity && !hasProductUrl) return payload;
  return toScrapeRow(payload as CollectorProductRecord, {
    observedAt: observedAt.toISOString(),
    collectorId: JUDGE_COLLECTOR_ID,
    templateFamily: "caffeine-informer-v2",
  });
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

  for (const record of rawRecords) {
    const mappedPayload = mapCollectorPayload(record.payload, record.capturedAt);
    const parsed = productScrapeRowV1Schema.safeParse(mappedPayload);
    if (!parsed.success) {
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

  return { candidatesByFingerprint, validatableRows, unparsableRecordIds };
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

      for (const candidate of parsed.candidatesByFingerprint.values()) {
        source ??= await resolveSource(repo, candidate);
        if (source === null) {
          return failedResult(
            job,
            "source_not_registered",
            `source "${candidate.identity.sourceId}" is not registered; register it before ingesting`,
            { runId, sourceSlug: candidate.identity.sourceId },
          );
        }

        // Idempotency: (source, fingerprint) first, then the insert-level
        // unique constraints ((source, slug, observed_at) included).
        const existing = await repo.findObservationBySourceFingerprint(
          source.id,
          candidate.pageFingerprint,
        );
        if (existing !== null) {
          duplicateObservations += 1;
          continue;
        }

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

      return okResult(job, `ingested ${insertedObservations} candidate observation(s)`, {
        runId,
        rawRecordCount:
          parsed.validatableRows.length + parsed.unparsableRecordIds.length,
        parsedRowCount: parsed.validatableRows.length,
        insertedObservations,
        duplicateObservations,
        unparsableRecords: parsed.unparsableRecordIds.length,
        unparsableRecordIds: parsed.unparsableRecordIds,
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
      const validation = validateRun(parsed.validatableRows, {
        previousRunCount: previousRowCount ?? undefined,
        unparsableRecordCount: parsed.unparsableRecordIds.length,
      });

      const firstFail =
        validation.findings.find((finding) => finding.severity === "fail") ??
        null;
      const status = validation.ok ? "validated" : "validation_failed";

      await repo.updateCollectionRun(runId, {
        status,
        report: {
          findings: validation.findings,
          rowCount: parsed.validatableRows.length,
          unparsableRecordIds: parsed.unparsableRecordIds,
          previousRunCount: previousRowCount ?? null,
          validatedAtIso: runtime.now().toISOString(),
        },
        ...(validation.ok
          ? {}
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
          await repo.openIncident({
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
          quarantined += 1;
          continue;
        }

        // Trusted: store the TRUSTED RECORD as the observation payload, demote
        // any other trusted observations, move the product pointer, then diff
        // against the previous trusted record for change events.
        await repo.updateObservation(observation.id, {
          status: "trusted",
          normalized: decision.record as JsonObject,
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
            before: (event.before ?? null) as JsonObject | null,
            after: (event.after ?? null) as JsonObject | null,
            productObservationId: observation.id,
            occurredAt: new Date(event.observedAt),
          });
        }
        changeEventsInserted += events.length;
        promoted += 1;
      }

      return okResult(job, `promoted ${promoted}, quarantined ${quarantined}`, {
        runId,
        candidateCount: candidateObservations.length,
        promoted,
        quarantined,
        skippedWithoutProduct,
        changeEventsInserted,
        unparsableRecords: parsed.unparsableRecordIds.length,
      });
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
  return async () => {
    const job: PulseJobName = "pulse.rebuild.leaderboards";

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
        for (const entry of entries) {
          rank += 1;
          const computation = metrics.get(`${boardKey}:${entry.productSlug}`);
          if (computation === undefined) continue;
          await repo.insertLeaderboardEntry({
            snapshotId,
            productId: entry.productId,
            rank,
            metricKey: boardKey,
            metricValue: computation.metricValue,
            eligible: true,
            eligibilityFlags: computation.eligibilityFlags,
          });
        }
        counts[boardKey] = entries.length;
        snapshotIds[boardKey] = snapshotId;
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
      const seen = new Set<string>();
      let stored = 0;
      let duplicateRowsSkipped = 0;
      let nonObjectRowsSkipped = 0;

      for (const row of output.rows) {
        const fingerprint = rawOutputFingerprint(row);
        if (seen.has(fingerprint)) {
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
        await repo.insertRawRecord({
          collectionRunId: runId,
          collectorId,
          payload: row as JsonObject,
          mediaType: "application/json",
          pageFingerprint: fingerprint,
          capturedAt: runtime.now(),
        });
        stored += 1;
      }

      await repo.updateCollectionRun(runId, {
        status: "succeeded",
        finishedAt: runtime.now(),
        rowCount: stored,
        pageFingerprint: output.fingerprint,
      });
      return { rowCount: stored, duplicateRowsSkipped, nonObjectRowsSkipped };
    });

    return {
      ok: true,
      runId,
      collectorId,
      rowCount: persisted.rowCount,
      duplicateRowsSkipped: persisted.duplicateRowsSkipped,
      nonObjectRowsSkipped: persisted.nonObjectRowsSkipped,
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

function createCollectSampleHandler(runtime: PulseJobRuntime): PulseJobHandler {
  return async ({ payload }) => {
    const job: PulseJobName = "pulse.collect.sample";

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
      return failedResult(job, "invalid_payload", "payload must be { url: string }", {
        issues: zodIssues(parsedPayload.error),
      });
    }

    const outcome = await collectAndPersist(
      runtime,
      { mode: "sample", url: parsedPayload.data.url, timeoutMs: parsedPayload.data.timeoutMs },
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

    const outcome = await collectAndPersist(
      runtime,
      {
        mode: "discovery",
        url: parsedPayload.data.query,
        inputFile: parsedPayload.data.inputFile,
        timeoutMs: parsedPayload.data.timeoutMs,
      },
      "job:pulse.collect.discovery",
    );
    if (!outcome.ok) {
      return failedResult(job, outcome.errorCode, outcome.message);
    }
    return okResult(job, `collected ${outcome.rowCount} discovery result row(s)`, {
      runId: outcome.runId,
      collectorId: outcome.collectorId,
      rowCount: outcome.rowCount,
      duplicateRowsSkipped: outcome.duplicateRowsSkipped,
      nonObjectRowsSkipped: outcome.nonObjectRowsSkipped,
      fingerprint: outcome.fingerprint,
    });
  };
}

// ---------------------------------------------------------------------------
// Registry factory
// ---------------------------------------------------------------------------

export type PulseJobStubFactory = (job: PulseJobName) => PulseJobHandler;

/**
 * Build the full handler registry around a runtime. Jobs outside the A7b
 * scope fall through to the supplied stub factory, keeping the registry shape
 * identical to the dispatcher contract.
 */
export function createPulseJobHandlers(
  runtime: PulseJobRuntime,
  notImplemented: PulseJobStubFactory,
): Record<PulseJobName, PulseJobHandler> {
  return {
    "pulse.collect.sample": createCollectSampleHandler(runtime),
    "pulse.collect.discovery": createCollectDiscoveryHandler(runtime),
    "pulse.collect.refresh-batch": notImplemented("pulse.collect.refresh-batch"),
    "pulse.ingest.run": createIngestRunHandler(runtime),
    "pulse.validate.run": createValidateRunHandler(runtime),
    "pulse.promote.snapshot": createPromoteSnapshotHandler(runtime),
    "pulse.detect.changes": notImplemented("pulse.detect.changes"),
    "pulse.rebuild.leaderboards": createRebuildLeaderboardsHandler(runtime),
    "pulse.retention": notImplemented("pulse.retention"),
    "pulse.incident.open": notImplemented("pulse.incident.open"),
    "pulse.heal.preview": notImplemented("pulse.heal.preview"),
    "pulse.heal.verify": notImplemented("pulse.heal.verify"),
  };
}

/** Default binding used by the module-level registry in ./pulse-jobs. */
export function createDefaultPulseJobHandlers(
  notImplemented: PulseJobStubFactory,
): Record<PulseJobName, PulseJobHandler> {
  return createPulseJobHandlers(createDefaultPulseJobRuntime(), notImplemented);
}
