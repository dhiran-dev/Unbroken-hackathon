/**
 * Unit tests for the A7b worker handler wiring (src/server/jobs/pulse-handlers.ts).
 *
 * Every data-bearing handler runs against `createInMemoryPulseRepo()` through
 * an injectable PulseJobRuntime, so no test touches postgres or spawns the
 * Bright Data CLI. The bdata-client describe block exercises the REAL client
 * with an injected runner seam (canned stdout, captured argv/env) plus a
 * temporary stubbed server env — still no network, no child processes.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";
import type { NumberObservation } from "@/domain/product/contracts/observations";
import type { FieldState } from "@/domain/product/contracts/field-states";
import {
  BdataClientError,
  collectViaBdata,
  type BdataCollectOutput,
  type BdataCliRunner,
  type BdataRunnerCommand,
} from "@/server/collection/bdata-client";
import {
  BrightDataProviderError,
  type BrightDataProvider,
} from "@/server/collection/bright-data-provider";
import {
  createInMemoryPulseRepo,
  type InMemoryPulseRepo,
} from "@/server/ingestion/repo";
import {
  createPulseJobHandlers,
  LEADERBOARD_BOARD_KEYS,
  type PulseJobRuntime,
} from "@/server/jobs/pulse-handlers";
import { JUDGE_COLLECTOR_ID } from "@/server/judge/to-scrape-row";
import {
  dispatch,
  LEGACY_JOB_DENYLIST,
  type PulseJobHandler,
  type PulseJobName,
} from "@/server/jobs/pulse-jobs";

/** Runtime overrides tests can pass to the harness. */
type RuntimeOverrides = {
  flags?: Partial<PulseJobRuntime["flags"]>;
  now?: PulseJobRuntime["now"];
  collect?: PulseJobRuntime["collect"];
  healPreview?: NonNullable<PulseJobRuntime["healPreview"]>;
  provider?: BrightDataProvider;
  enqueue?: PulseJobRuntime["enqueue"];
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FIXED_NOW = new Date("2026-08-22T12:00:00.000Z");

let rowCounter = 0;

type CaffeineSpec = {
  state?: FieldState;
  value?: number | null;
  min?: number | null;
  max?: number | null;
  qualifier?: NumberObservation["qualifier"];
};

function numberObservation(
  spec: CaffeineSpec | undefined,
  fallbackValue: number | null,
): NumberObservation {
  const value = spec?.value !== undefined ? spec.value : fallbackValue;
  // No explicit state: a null value means the field is simply not published
  // (valid sparse record); anything else is a present observation.
  const state: FieldState = spec?.state ?? (value === null ? "not_published" : "present");
  const hasPoint = state === "present" && value !== null;
  return {
    state,
    value: hasPoint ? value : null,
    min: spec?.min ?? null,
    max: spec?.max ?? null,
    qualifier: spec?.qualifier ?? (hasPoint ? "exact" : "unknown"),
    rawText: hasPoint ? `${String(value)} mg` : null,
    candidates: hasPoint ? [value as number] : [],
  };
}

function servingObservation(normalizedMl: number | null) {
  return {
    state: (normalizedMl === null ? "not_published" : "present") as FieldState,
    value: normalizedMl,
    unit: normalizedMl === null ? null : ("ml" as const),
    form: "drink" as const,
    normalizedMl,
    rawText: normalizedMl === null ? null : `${normalizedMl} ml`,
  };
}

type RowOverrides = CaffeineSpec & {
  slug?: string;
  name?: string;
  fingerprint?: string;
  url?: string;
  observedAt?: string;
  caffeine?: CaffeineSpec;
  servingMl?: number | null;
};

/** A minimal contract-valid V1 scrape row with unique slug/fingerprint. */
function makeScrapeRow(overrides: RowOverrides = {}): ProductScrapeRowV1 {
  const n = ++rowCounter;
  const slug = overrides.slug ?? `test-product-${n}`;
  return {
    schemaVersion: "1.0",
    source: {
      sourceId: "caffeine-informer",
      url:
        overrides.url ??
        `https://www.caffeineinformer.com/caffeine-content/${slug}`,
      slug,
      observedAt: overrides.observedAt ?? "2026-08-20T10:00:00.000Z",
      pageFingerprint: overrides.fingerprint ?? `fp-${n}`,
    },
    identity: { name: overrides.name ?? slug, categoryLabel: "Energy Drinks", pageTitle: null },
    primary: {
      caffeineMg: numberObservation(overrides.caffeine, 95),
      sourceLevel: "moderate",
      serving: servingObservation(overrides.servingMl ?? 250),
      caloriesKcal: numberObservation(undefined, null),
      sugarG: numberObservation(undefined, null),
    },
    variants: [],
    flavours: [],
    ingredients: { state: "not_published", text: null, appliesTo: null },
    media: { imageUrl: null, publicationState: "audit_only" },
    evidence: { sectionsPresent: [], sourceLinks: [], warnings: [] },
    extraction: {
      collectorId: "c_test_collector",
      collectionId: null,
      templateFamily: null,
      parserVersion: "unit-test-1",
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeRuntime(
  repo: InMemoryPulseRepo,
  overrides: RuntimeOverrides = {},
): PulseJobRuntime {
  return {
    runTransaction: async (work) => work(repo),
    flags: {
      collectionEnabled: overrides.flags?.collectionEnabled ?? true,
      discoveryEnabled: overrides.flags?.discoveryEnabled ?? true,
      judgeMutationsEnabled: overrides.flags?.judgeMutationsEnabled ?? false,
    },
    now: overrides.now ?? (() => FIXED_NOW),
    collect:
      overrides.collect ??
      (async () => {
        throw new Error("collect seam must not be called in this test");
      }),
    provider:
      overrides.provider ??
      {
        async submit() {
          throw new Error("provider submit seam must not be called in this test");
        },
        async poll() {
          throw new Error("provider poll seam must not be called in this test");
        },
      },
    enqueue: overrides.enqueue ?? (async () => null),
    healPreview: overrides.healPreview,
  };
}

function makeHandlers(
  repo: InMemoryPulseRepo,
  overrides: RuntimeOverrides = {},
): Record<PulseJobName, PulseJobHandler> {
  return createPulseJobHandlers(
    makeRuntime(repo, overrides),
    (job) => async () => ({ status: "not_implemented", job }),
  );
}

/** Seed the in-memory repo with the caffeine-informer source/collector/run. */
async function seedRunWithRows(repo: InMemoryPulseRepo, rows: ProductScrapeRowV1[]) {
  const source = repo.seedSource({ slug: "caffeine-informer" });
  const collector = repo.seedCollector({ sourceId: source.id });
  const run = await repo.insertCollectionRun({
    collectorId: collector.id,
    trigger: "unit-test",
    status: "succeeded",
    startedAt: FIXED_NOW,
    finishedAt: FIXED_NOW,
    rowCount: rows.length,
    pageFingerprint: null,
    report: null,
  });
  for (const row of rows) {
    await repo.insertRawRecord({
      collectionRunId: run.id,
      collectorId: collector.id,
      payload: row,
      mediaType: "application/json",
      pageFingerprint: row.source.pageFingerprint,
      capturedAt: FIXED_NOW,
    });
  }
  return { run, source, collector };
}

// ---------------------------------------------------------------------------
// pulse.ingest.run
// ---------------------------------------------------------------------------

describe("pulse.ingest.run handler", () => {
  it("persists candidate observations and is idempotent on re-dispatch", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [
      makeScrapeRow({ slug: "red-bull", fingerprint: "fp-rb", name: "Red Bull" }),
      makeScrapeRow({ slug: "monster", fingerprint: "fp-mon", name: "Monster" }),
    ]);
    const handlers = makeHandlers(repo);

    const first = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(first).toMatchObject({ status: "ok" });
    expect(first.status === "ok" && first.details.insertedObservations).toBe(2);

    // Both observations are candidates keyed on (source, fingerprint).
    const statuses = [...repo.__debug.observations.values()].map((o) => o.status);
    expect(statuses.sort()).toEqual(["candidate", "candidate"]);

    const second = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(second).toMatchObject({ status: "ok" });
    expect(second.status === "ok" && second.details.insertedObservations).toBe(0);
    expect(second.status === "ok" && second.details.duplicateObservations).toBe(2);
    expect(repo.__debug.observations.size).toBe(2);
  });

  it("treats a (source, slug, observed_at) collision as an idempotent duplicate too", async () => {
    const repo = createInMemoryPulseRepo();
    const sharedObservedAt = "2026-08-20T10:00:00.000Z";
    const { run } = await seedRunWithRows(repo, [
      makeScrapeRow({ slug: "same-slug", fingerprint: "fp-a", observedAt: sharedObservedAt }),
      makeScrapeRow({ slug: "same-slug", fingerprint: "fp-b", observedAt: sharedObservedAt }),
    ]);
    const handlers = makeHandlers(repo);

    const result = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(result).toMatchObject({ status: "ok" });
    expect(result.status === "ok" && result.details.insertedObservations).toBe(1);
    expect(result.status === "ok" && result.details.duplicateObservations).toBe(1);
  });

  it("fails structurally for unknown runs and malformed payloads", async () => {
    const repo = createInMemoryPulseRepo();
    seedRunWithRows(repo, []);
    const handlers = makeHandlers(repo);

    await expect(
      handlers["pulse.ingest.run"]({ job: "pulse.ingest.run", payload: { runId: "missing-run" } }),
    ).resolves.toMatchObject({ status: "failed", errorCode: "run_not_found" });

    await expect(
      handlers["pulse.ingest.run"]({ job: "pulse.ingest.run", payload: {} }),
    ).resolves.toMatchObject({ status: "failed", errorCode: "invalid_payload" });
  });
});

// ---------------------------------------------------------------------------
// pulse.validate.run
// ---------------------------------------------------------------------------

describe("pulse.validate.run handler", () => {
  it("persists findings into collection_runs and flips the status on failure", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [
      makeScrapeRow({ slug: "good-row" }),
      // Off-host row trips the expected_host check (severity: fail).
      makeScrapeRow({ slug: "bad-host-row", url: "https://example.com/sneaky" }),
    ]);
    const handlers = makeHandlers(repo);

    const result = await handlers["pulse.validate.run"]({
      job: "pulse.validate.run",
      payload: { runId: run.id },
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(result.status === "ok" && result.details.validationOk).toBe(false);

    const patched = await repo.getCollectionRun(run.id);
    expect(patched?.status).toBe("validation_failed");
    expect(patched?.errorCode).toBe("validation_failed");
    const findings = (patched?.report?.findings ?? []) as Array<{ check: string; severity: string }>;
    expect(findings.some((f) => f.check === "expected_host" && f.severity === "fail")).toBe(true);
  });

  it("marks a clean run validated with no error code", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [makeScrapeRow({ slug: "only-good-row" })]);
    await repo.updateCollectionRun(run.id, {
      report: {
        provider: {
          kind: "bright_data_dca",
          collectionId: "j_preserved123",
          submittedAt: FIXED_NOW.toISOString(),
          lastPollAt: FIXED_NOW.toISOString(),
          attempts: 1,
          status: "ready",
          windowEndsAt: new Date(FIXED_NOW.getTime() + 60_000).toISOString(),
        },
      },
    });
    const handlers = makeHandlers(repo);

    const result = await handlers["pulse.validate.run"]({
      job: "pulse.validate.run",
      payload: { runId: run.id },
    });

    expect(result.status === "ok" && result.details.validationOk).toBe(true);
    const patched = await repo.getCollectionRun(run.id);
    expect(patched?.status).toBe("validated");
    expect(patched?.errorCode).toBeNull();
    expect(patched?.report).toMatchObject({
      provider: { collectionId: "j_preserved123", status: "ready" },
      validation: { ok: true, status: "validated" },
      manifestReconciliation: {
        discoveredInputCount: 1,
        successfulRows: 1,
        terminalPageErrors: 0,
        invalidRows: 0,
        reconciled: true,
      },
    });
  });

  it("records a collector error row without turning it into a product", async () => {
    const repo = createInMemoryPulseRepo();
    const { run, collector } = await seedRunWithRows(repo, []);
    await repo.insertRawRecord({
      collectionRunId: run.id,
      collectorId: collector.id,
      payload: {
        error: "too many requests",
        error_code: "rate_limit",
        input: { url: "https://www.caffeineinformer.com/caffeine-content/example" },
      },
      mediaType: "application/json",
      pageFingerprint: "error-record",
      capturedAt: FIXED_NOW,
    });
    const handlers = makeHandlers(repo);

    const result = await handlers["pulse.validate.run"]({
      job: "pulse.validate.run",
      payload: { runId: run.id },
    });

    expect(result.status === "ok" && result.details.validationOk).toBe(true);
    const patched = await repo.getCollectionRun(run.id);
    expect(patched?.status).toBe("validated");
    expect(patched?.report?.collectorErrorRecordIds).toHaveLength(1);
    const findings = (patched?.report?.findings ?? []) as Array<{ check: string; severity: string }>;
    expect(findings).toContainEqual({
      check: "collector_errors",
      severity: "warn",
      detail: expect.stringContaining("excluded from promotion"),
    });
  });

  it("fails a run that contains a malformed non-error record", async () => {
    const repo = createInMemoryPulseRepo();
    const { run, collector } = await seedRunWithRows(repo, []);
    await repo.insertRawRecord({
      collectionRunId: run.id,
      collectorId: collector.id,
      payload: { unexpected: true },
      mediaType: "application/json",
      pageFingerprint: "malformed-record",
      capturedAt: FIXED_NOW,
    });
    const handlers = makeHandlers(repo);

    const result = await handlers["pulse.validate.run"]({
      job: "pulse.validate.run",
      payload: { runId: run.id },
    });

    expect(result.status === "ok" && result.details.validationOk).toBe(false);
    const patched = await repo.getCollectionRun(run.id);
    expect(patched?.status).toBe("validation_failed");
    const findings = (patched?.report?.findings ?? []) as Array<{ check: string; severity: string }>;
    expect(findings).toContainEqual({
      check: "contract_parse",
      severity: "fail",
      detail: expect.stringContaining("could not be mapped"),
    });
  });
});

// ---------------------------------------------------------------------------
// pulse.promote.snapshot
// ---------------------------------------------------------------------------

describe("pulse.promote.snapshot handler", () => {
  async function ingestAndPromote(
    repo: InMemoryPulseRepo,
    runId: string,
    handlers: Record<PulseJobName, PulseJobHandler>,
  ) {
    const ingested = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId },
    });
    expect(ingested).toMatchObject({ status: "ok" });
    const validated = await handlers["pulse.validate.run"]({
      job: "pulse.validate.run",
      payload: { runId },
    });
    expect(validated).toMatchObject({ status: "ok" });
    expect(validated.status === "ok" && validated.details.validationOk).toBe(true);
    return handlers["pulse.promote.snapshot"]({
      job: "pulse.promote.snapshot",
      payload: { runId },
    });
  }

  it("refuses to promote a run that has not passed validation", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [makeScrapeRow({ slug: "not-validated" })]);
    const handlers = makeHandlers(repo);

    const ingested = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(ingested).toMatchObject({ status: "ok" });

    const promoted = await handlers["pulse.promote.snapshot"]({
      job: "pulse.promote.snapshot",
      payload: { runId: run.id },
    });
    expect(promoted).toMatchObject({ status: "failed", errorCode: "run_not_validated" });
    expect(repo.__debug.observations.size).toBe(1);
    expect([...repo.__debug.observations.values()][0]?.status).toBe("candidate");
  });

  it("moves the current-trusted pointer, supersedes the old record, and logs a caffeine change", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [
      makeScrapeRow({
        slug: "pointer-product",
        fingerprint: "fp-v1",
        caffeine: { value: 100, qualifier: "exact" },
        observedAt: "2026-08-19T09:00:00.000Z",
      }),
    ]);
    const handlers = makeHandlers(repo);

    const first = await ingestAndPromote(repo, run.id, handlers);
    expect(first).toMatchObject({ status: "ok" });
    expect(first.status === "ok" && first.details.promoted).toBe(1);
    expect(first.status === "ok" && first.details.changeEventsInserted).toBe(0);

    const products = [...repo.__debug.products.values()];
    expect(products).toHaveLength(1);
    const v1ObservationId = products[0]?.currentTrustedObservationId ?? null;
    expect(v1ObservationId).not.toBeNull();

    // Second snapshot of the same product with a higher caffeine value.
    const anyRaw = [...repo.__debug.rawRecords.values()][0];
    await repo.insertRawRecord({
      collectionRunId: run.id,
      collectorId: anyRaw?.collectorId ?? "",
      payload: makeScrapeRow({
        slug: "pointer-product",
        fingerprint: "fp-v2",
        caffeine: { value: 140, qualifier: "exact" },
        observedAt: "2026-08-21T09:00:00.000Z",
      }),
      mediaType: "application/json",
      pageFingerprint: "fp-v2",
      capturedAt: FIXED_NOW,
    });

    const ingestedAgain = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(ingestedAgain.status === "ok" && ingestedAgain.details.insertedObservations).toBe(1);

    const second = await handlers["pulse.promote.snapshot"]({
      job: "pulse.promote.snapshot",
      payload: { runId: run.id },
    });
    expect(second.status === "ok" && second.details.promoted).toBe(1);

    // Pointer moved to the new trusted observation (re-read: updateProduct
    // replaces the stored row object).
    const updatedProduct = [...repo.__debug.products.values()][0];
    expect(updatedProduct?.currentTrustedObservationId).not.toBeNull();
    expect(updatedProduct?.currentTrustedObservationId).not.toBe(v1ObservationId);
    const newObservation =
      updatedProduct?.currentTrustedObservationId != null
        ? repo.__debug.observations.get(updatedProduct.currentTrustedObservationId)
        : undefined;
    expect(newObservation?.status).toBe("trusted");
    // ...and the previous trusted record was superseded.
    expect(v1ObservationId != null && repo.__debug.observations.get(v1ObservationId)?.status).toBe(
      "superseded",
    );

    // Trusted-to-trusted transition produced exactly one caffeine_changed event.
    expect(repo.__debug.changeEvents).toHaveLength(1);
    const event = repo.__debug.changeEvents[0];
    expect(event?.eventType).toBe("caffeine_changed");
    expect((event?.before as { value: number }).value).toBe(100);
    expect((event?.after as { value: number }).value).toBe(140);
  });

  it("quarantines unparseable candidates: observation stays, prior pointer untouched, incident opens", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [
      makeScrapeRow({
        slug: "broken-product",
        fingerprint: "fp-broken",
        caffeine: { state: "unparseable", value: null, qualifier: "unknown" },
      }),
    ]);
    const handlers = makeHandlers(repo);

    const promoted = await ingestAndPromote(repo, run.id, handlers);
    expect(promoted).toMatchObject({ status: "ok" });
    expect(promoted.status === "ok" && promoted.details.quarantined).toBe(1);
    expect(promoted.status === "ok" && promoted.details.promoted).toBe(0);

    const observation = [...repo.__debug.observations.values()][0];
    expect(observation?.status).toBe("quarantined");

    const product = [...repo.__debug.products.values()][0];
    expect(product?.currentTrustedObservationId).toBeNull();

    expect(repo.__debug.incidents).toHaveLength(1);
    const incident = repo.__debug.incidents[0];
    expect(incident?.status).toBe("open");
    expect(incident?.collectionRunId).toBe(run.id);
    expect(incident?.title).toContain("broken-product");

    // No trusted-to-trusted transition happened, so no change events.
    expect(repo.__debug.changeEvents).toHaveLength(0);
  });

  it("is idempotent: already-promoted candidates are skipped on re-dispatch", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [makeScrapeRow({ slug: "idem-product" })]);
    const handlers = makeHandlers(repo);

    await ingestAndPromote(repo, run.id, handlers);
    const ingestedAgain = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(ingestedAgain).toMatchObject({
      status: "ok",
      details: { insertedObservations: 0, duplicateObservations: 1 },
    });
    const again = await handlers["pulse.promote.snapshot"]({
      job: "pulse.promote.snapshot",
      payload: { runId: run.id },
    });
    expect(again.status === "ok" && again.details.promoted).toBe(0);
    expect(again.status === "ok" && again.details.quarantined).toBe(0);
    expect(again.status === "ok" && again.details.candidateCount).toBe(0);
    expect(await repo.getCollectionRun(run.id)).toMatchObject({
      report: {
        ingestion: { insertedObservations: 1, duplicateObservations: 0 },
        ingestionReplay: { insertedObservations: 0, duplicateObservations: 1 },
        promotion: { promoted: 1, candidateCount: 1 },
        promotionReplay: { promoted: 0, candidateCount: 0 },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// pulse.rebuild.leaderboards
// ---------------------------------------------------------------------------

describe("pulse.rebuild.leaderboards handler", () => {
  async function buildFourTrustedProducts(repo: InMemoryPulseRepo) {
    const rows = [
      makeScrapeRow({
        slug: "board-alpha",
        fingerprint: "fp-alpha",
        caffeine: { value: 300, qualifier: "exact" },
        servingMl: 250, // concentration 120.0
      }),
      makeScrapeRow({
        slug: "board-beta",
        fingerprint: "fp-beta",
        caffeine: { value: 300, qualifier: "exact" },
        servingMl: 500, // concentration 60.0
      }),
      makeScrapeRow({
        slug: "board-gamma",
        fingerprint: "fp-gamma",
        caffeine: { state: "present", value: null, min: 280, max: 320, qualifier: "range" }, // total metric = 280
      }),
      makeScrapeRow({
        slug: "board-delta",
        fingerprint: "fp-delta",
        caffeine: { value: 0, qualifier: "exact" }, // caffeine-free board
      }),
    ];
    const { run } = await seedRunWithRows(repo, rows);
    const handlers = makeHandlers(repo);
    const ingested = await handlers["pulse.ingest.run"]({
      job: "pulse.ingest.run",
      payload: { runId: run.id },
    });
    expect(ingested).toMatchObject({ status: "ok" });
    const validated = await handlers["pulse.validate.run"]({
      job: "pulse.validate.run",
      payload: { runId: run.id },
    });
    expect(validated).toMatchObject({ status: "ok" });
    expect(validated.status === "ok" && validated.details.validationOk).toBe(true);
    const promoted = await handlers["pulse.promote.snapshot"]({
      job: "pulse.promote.snapshot",
      payload: { runId: run.id },
    });
    expect(promoted).toMatchObject({ status: "ok" });
    return handlers;
  }

  function entriesOf(repo: InMemoryPulseRepo, snapshotId: string | undefined) {
    return repo.__debug.leaderboardEntries
      .filter((entry) => entry.snapshotId === snapshotId)
      .map((entry) => ({
        productId: entry.productId,
        rank: entry.rank,
        metricKey: entry.metricKey,
        metricValue: entry.metricValue,
        eligible: entry.eligible,
        eligibilityFlags: entry.eligibilityFlags,
      }));
  }

  function boardSnapshotId(
    result: Awaited<ReturnType<PulseJobHandler>>,
    boardKey: string,
  ): string {
    if (result.status !== "ok") throw new Error("rebuild did not succeed");
    const ids = result.details.snapshotIds as Record<string, string>;
    const id = ids[boardKey];
    if (id === undefined) throw new Error(`no snapshot for ${boardKey}`);
    return id;
  }

  it("writes one snapshot per board, ranked deterministically with a stable slug tiebreak", async () => {
    const repo = createInMemoryPulseRepo();
    const handlers = await buildFourTrustedProducts(repo);

    const first = await handlers["pulse.rebuild.leaderboards"]({
      job: "pulse.rebuild.leaderboards",
      payload: {},
    });
    expect(first).toMatchObject({ status: "ok" });

    // One snapshot per board; each carries its boardKey in the summary.
    expect(repo.__debug.snapshots).toHaveLength(LEADERBOARD_BOARD_KEYS.length);
    for (const snapshot of repo.__debug.snapshots) {
      expect(snapshot.summary.boardKey).toEqual(expect.any(String));
    }

    const totalBoard = entriesOf(repo, boardSnapshotId(first, "highest-total-caffeine"));
    // 300 tie between board-alpha/board-beta broken by ascending slug, then 280 range, then 0.
    expect(totalBoard.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
    expect(totalBoard.map((e) => e.metricValue)).toEqual([300, 300, 280, 0]);
    const productSlugs = totalBoard.map(
      (e) => [...repo.__debug.products.values()].find((p) => p.id === e.productId)?.slug,
    );
    expect(productSlugs).toEqual([
      "board-alpha",
      "board-beta",
      "board-gamma",
      "board-delta",
    ]);
    expect(totalBoard.every((e) => e.metricKey === "highest-total-caffeine")).toBe(true);

    const exactConcentration = entriesOf(
      repo,
      boardSnapshotId(first, "highest-exact-concentration"),
    );
    // Explicit zero IS exact-board material per promote.ts (rankable, exact
    // when qualifier is exact), so delta rides along at the bottom.
    expect(exactConcentration.map((e) => e.metricValue)).toEqual([120, 60, 0]);
    expect(exactConcentration.every((e) => e.eligible)).toBe(true);
    expect(exactConcentration[0]?.eligibilityFlags).toEqual(["exact_caffeine", "ml_normalized"]);
    // The range row never appears on the exact-only board.
    expect(exactConcentration.map((e) => e.metricKey)).toEqual(
      Array(exactConcentration.length).fill("highest-exact-concentration"),
    );
    expect(
      exactConcentration.some(
        (e) => [...repo.__debug.products.values()].find((p) => p.id === e.productId)?.slug ===
          "board-gamma",
      ),
    ).toBe(false);

    const caffeineFree = entriesOf(repo, boardSnapshotId(first, "caffeine-free"));
    expect(caffeineFree.map((e) => e.metricValue)).toEqual([0]);
    expect(caffeineFree[0]?.eligibilityFlags).toEqual(["explicit_zero"]);
  });

  it("produces identical entries when recomputed over unchanged data", async () => {
    const repo = createInMemoryPulseRepo();
    const handlers = await buildFourTrustedProducts(repo);

    const first = await handlers["pulse.rebuild.leaderboards"]({ job: "pulse.rebuild.leaderboards", payload: {} });
    const second = await handlers["pulse.rebuild.leaderboards"]({ job: "pulse.rebuild.leaderboards", payload: {} });
    expect(first).toMatchObject({ status: "ok" });
    expect(second).toMatchObject({ status: "ok" });

    for (const boardKey of LEADERBOARD_BOARD_KEYS) {
      const firstEntries = entriesOf(repo, boardSnapshotId(first, boardKey));
      const secondEntries = entriesOf(repo, boardSnapshotId(second, boardKey));
      expect(secondEntries).toEqual(firstEntries);
    }

    // Snapshots are append-only: a fresh set of per-board snapshots per rebuild.
    expect(repo.__debug.snapshots).toHaveLength(2 * LEADERBOARD_BOARD_KEYS.length);
    expect(first.status === "ok" && second.status === "ok" &&
      first.details.snapshotIds !== second.details.snapshotIds).toBe(true);
    expect(LEADERBOARD_BOARD_KEYS).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// pulse.collect.* — flag gating + persistence-before-processing
// ---------------------------------------------------------------------------

describe("pulse.collect handlers", () => {
  it("skips structurally without touching the collector or db when flags are off", async () => {
    const repo = createInMemoryPulseRepo();
    let collectCalls = 0;
    const handlers = makeHandlers(repo, {
      flags: { collectionEnabled: false, discoveryEnabled: false },
      collect: async () => {
        collectCalls += 1;
        throw new Error("must never be called");
      },
    });

    const sample = await handlers["pulse.collect.sample"]({
      job: "pulse.collect.sample",
      payload: { url: "https://www.caffeineinformer.com/caffeine-content/red-bull" },
    });
    const discovery = await handlers["pulse.collect.discovery"]({
      job: "pulse.collect.discovery",
      payload: { query: "energy drinks" },
    });

    expect(sample).toMatchObject({ status: "skipped", reason: "collection_disabled" });
    expect(discovery).toMatchObject({ status: "skipped", reason: "discovery_disabled" });
    expect(collectCalls).toBe(0);
    expect(repo.__debug.runs.size).toBe(0);
    expect(repo.__debug.rawRecords.size).toBe(0);
  });

  it("persists raw output to raw_records + collection_runs before processing", async () => {
    const repo = createInMemoryPulseRepo();
    seedRunWithRows(repo, []);
    const handlers = makeHandlers(repo, {
      collect: async () => ({
        rows: [{ page: "a" }, { page: "b" }, { page: "a" }],
        fingerprint: "sha256:test-output",
      }),
    });

    const result = await handlers["pulse.collect.sample"]({
      job: "pulse.collect.sample",
      payload: { url: "https://www.caffeineinformer.com/caffeine-content/red-bull" },
    });

    expect(result).toMatchObject({ status: "ok" });
    expect(result.status === "ok" && result.details.rowCount).toBe(2);
    expect(result.status === "ok" && result.details.duplicateRowsSkipped).toBe(1);

    const runs = [...repo.__debug.runs.values()];
    const collectRun = runs.find((r) => r.trigger === "job:pulse.collect.sample");
    expect(collectRun?.status).toBe("succeeded");
    expect(collectRun?.rowCount).toBe(2);
    expect(collectRun?.pageFingerprint).toBe("sha256:test-output");

    // Raw records landed in the landing zone BEFORE any processing step ran.
    const raws = [...repo.__debug.rawRecords.values()].filter(
      (r) => r.collectionRunId === collectRun?.id,
    );
    expect(raws).toHaveLength(2);
    expect(raws.every((r) => typeof r.payload.page === "string")).toBe(true);
  });

  it("submits discovery, persists provider identity, and queues a separate poll", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    const queued: Array<{ name: string; payload?: Record<string, unknown> }> = [];
    const handlers = makeHandlers(repo, {
      provider: {
        async submit(input) {
          expect(input.url).toBe(
            "https://www.caffeineinformer.com/the-caffeine-database",
          );
          return { collectionId: "j_async123" };
        },
        async poll() {
          throw new Error("discovery submission must not poll inline");
        },
      },
      enqueue: async (input) => {
        queued.push(input);
        return { id: "job-poll" };
      },
    });

    const result = await handlers["pulse.collect.discovery"]({
      job: "pulse.collect.discovery",
      payload: { query: "https://www.caffeineinformer.com/the-caffeine-database" },
    });

    expect(result).toMatchObject({ status: "ok", details: { providerStatus: "submitted" } });
    const runId = result.status === "ok" ? String(result.details.runId) : "";
    expect(await repo.getCollectionRun(runId)).toMatchObject({
      status: "provider_wait",
      report: {
        provider: {
          kind: "bright_data_dca",
          collectionId: "j_async123",
          status: "submitted",
          attempts: 0,
        },
      },
    });
    expect(repo.__debug.rawRecords.size).toBe(0);
    expect(queued).toContainEqual(
      expect.objectContaining({
        name: "pulse.collect.poll",
        payload: { runId },
      }),
    );
  });

  it("lands repeated terminal page errors as separate warning evidence", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    const terminalError = {
      error: "terminal page failure",
      error_code: "page_failed",
    };
    const handlers = makeHandlers(repo, {
      collect: async () => ({
        rows: [terminalError, terminalError],
        fingerprint: "sha256:two-errors",
      }),
    });

    const result = await handlers["pulse.collect.sample"]({
      job: "pulse.collect.sample",
      payload: { url: "https://www.caffeineinformer.com/the-caffeine-database" },
    });

    expect(result).toMatchObject({
      status: "ok",
      details: { rowCount: 2, duplicateRowsSkipped: 0 },
    });
    expect(repo.__debug.rawRecords.size).toBe(2);
  });

  it("polls resumably, lands a ready dataset once, and queues ingestion", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    const queued: Array<{ name: string; payload?: Record<string, unknown> }> = [];
    let providerPolls = 0;
    const handlers = makeHandlers(repo, {
      provider: {
        async submit() {
          return { collectionId: "j_resume123" };
        },
        async poll(collectionId) {
          expect(collectionId).toBe("j_resume123");
          providerPolls += 1;
          return providerPolls === 1
            ? { status: "pending" as const }
            : {
                status: "ready" as const,
                rows: [{ product_name: "Alpha" }, { error: "dead page" }],
                fingerprint: "sha256:ready-dataset",
                manifest: {
                  status: "done",
                  inputs: 1,
                  duplicateInputs: 0,
                  lines: 1,
                  fails: 1,
                  pages: 2,
                  pagesLeft: 0,
                  success: 1,
                  successRate: 0.5,
                },
              };
        },
      },
      enqueue: async (input) => {
        queued.push(input);
        return { id: `job-${queued.length}` };
      },
    });
    const submitted = await handlers["pulse.collect.discovery"]({
      job: "pulse.collect.discovery",
      payload: { query: "https://www.caffeineinformer.com/the-caffeine-database" },
    });
    const runId = submitted.status === "ok" ? String(submitted.details.runId) : "";

    const pending = await handlers["pulse.collect.poll"]({
      job: "pulse.collect.poll",
      payload: { runId },
    });
    expect(pending).toMatchObject({
      status: "ok",
      details: { runId, providerStatus: "pending", attempts: 1 },
    });
    expect(await repo.getCollectionRun(runId)).toMatchObject({
      status: "provider_wait",
      report: { provider: { status: "pending", attempts: 1 } },
    });

    const ready = await handlers["pulse.collect.poll"]({
      job: "pulse.collect.poll",
      payload: { runId },
    });
    expect(ready).toMatchObject({
      status: "ok",
      details: { runId, providerStatus: "ready", rowCount: 2, attempts: 2 },
    });
    expect(await repo.getCollectionRun(runId)).toMatchObject({
      status: "succeeded",
      rowCount: 2,
      pageFingerprint: "sha256:ready-dataset",
      report: { provider: { status: "ready", attempts: 2 } },
    });
    expect(repo.__debug.rawRecords.size).toBe(2);
    expect(queued).toContainEqual(
      expect.objectContaining({ name: "pulse.ingest.run", payload: { runId } }),
    );

    const replay = await handlers["pulse.collect.poll"]({
      job: "pulse.collect.poll",
      payload: { runId, resume: true },
    });
    expect(replay).toMatchObject({
      status: "ok",
      details: { providerStatus: "ready", idempotentReplay: true },
    });
    expect(providerPolls).toBe(2);
    expect(repo.__debug.rawRecords.size).toBe(2);
  });

  it("times out without losing provider identity and resumes the same run", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    let now = FIXED_NOW;
    let providerPolls = 0;
    const handlers = makeHandlers(repo, {
      now: () => now,
      provider: {
        async submit() {
          return { collectionId: "j_timeout123" };
        },
        async poll() {
          providerPolls += 1;
          return { status: "pending" };
        },
      },
    });
    const submitted = await handlers["pulse.collect.discovery"]({
      job: "pulse.collect.discovery",
      payload: {
        query: "https://www.caffeineinformer.com/the-caffeine-database",
        timeoutMs: 1_000,
      },
    });
    const runId = submitted.status === "ok" ? String(submitted.details.runId) : "";

    now = new Date(FIXED_NOW.getTime() + 1_001);
    const timedOut = await handlers["pulse.collect.poll"]({
      job: "pulse.collect.poll",
      payload: { runId },
    });
    expect(timedOut).toMatchObject({
      status: "ok",
      details: { providerStatus: "timed_out", resumable: true },
    });
    expect(providerPolls).toBe(0);
    expect(await repo.getCollectionRun(runId)).toMatchObject({
      status: "provider_wait_timeout",
      errorCode: "provider_wait_timeout",
      report: {
        provider: {
          collectionId: "j_timeout123",
          status: "timed_out",
        },
      },
    });

    const resumed = await handlers["pulse.collect.poll"]({
      job: "pulse.collect.poll",
      payload: { runId, resume: true },
    });
    expect(resumed).toMatchObject({
      status: "ok",
      details: { providerStatus: "pending", attempts: 1 },
    });
    expect(providerPolls).toBe(1);
    expect(await repo.getCollectionRun(runId)).toMatchObject({
      status: "provider_wait",
      errorCode: null,
      report: { provider: { collectionId: "j_timeout123", status: "pending" } },
    });
  });

  it("persists transient poll failures and queues bounded idempotent retries", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    const queued: Array<Parameters<PulseJobRuntime["enqueue"]>[0]> = [];
    const handlers = makeHandlers(repo, {
      provider: {
        async submit() {
          return { collectionId: "j_retry123" };
        },
        async poll() {
          throw new BrightDataProviderError(
            "provider_http_503",
            "provider temporarily unavailable",
            true,
          );
        },
      },
      enqueue: async (input) => {
        queued.push(input);
        return { id: `job-${queued.length}` };
      },
    });
    const submitted = await handlers["pulse.collect.discovery"]({
      job: "pulse.collect.discovery",
      payload: { query: "https://www.caffeineinformer.com/the-caffeine-database" },
    });
    const runId = submitted.status === "ok" ? String(submitted.details.runId) : "";

    const retry = await handlers["pulse.collect.poll"]({
      job: "pulse.collect.poll",
      payload: { runId },
    });
    expect(retry).toMatchObject({
      status: "ok",
      details: { providerStatus: "retrying", attempts: 1 },
    });
    expect(await repo.getCollectionRun(runId)).toMatchObject({
      status: "provider_wait",
      errorCode: "provider_http_503",
      report: { provider: { status: "retrying", attempts: 1 } },
    });
    expect(queued).toContainEqual(
      expect.objectContaining({
        name: "pulse.collect.poll",
        idempotencyKey: `pulse.collect.poll:${runId}:1`,
        scheduledFor: new Date(FIXED_NOW.getTime() + 5_000),
      }),
    );
  });

  it("accepts a bounded sample batch input file", async () => {
    const repo = createInMemoryPulseRepo();
    await seedRunWithRows(repo, []);
    const handlers = makeHandlers(repo, {
      collect: async (input) => {
        expect(input.mode).toBe("sample");
        expect(input.inputFile).toBe("artifacts/scraper/discovery-input-100.txt");
        expect(input.timeoutMs).toBe(1_200_000);
        return { rows: [], fingerprint: "sha256:batch" };
      },
    });

    const result = await handlers["pulse.collect.sample"]({
      job: "pulse.collect.sample",
      payload: {
        inputFile: "artifacts/scraper/discovery-input-100.txt",
        timeoutMs: 1_200_000,
      },
    });

    expect(result).toMatchObject({ status: "ok" });
  });

  it("records a structured failure on the run row when the CLI fails", async () => {
    const repo = createInMemoryPulseRepo();
    seedRunWithRows(repo, []);
    const handlers = makeHandlers(repo, {
      collect: async () => {
        throw new BdataClientError("BDATA_TIMEOUT", "did not finish before its deadline");
      },
    });

    const result = await handlers["pulse.collect.sample"]({
      job: "pulse.collect.sample",
      payload: { url: "https://www.caffeineinformer.com/caffeine-content/red-bull" },
    });

    expect(result).toMatchObject({ status: "failed", errorCode: "BDATA_TIMEOUT" });
    const collectRun = [...repo.__debug.runs.values()].find(
      (r) => r.trigger === "job:pulse.collect.sample",
    );
    expect(collectRun?.status).toBe("failed");
    expect(collectRun?.errorCode).toBe("BDATA_TIMEOUT");
    expect(collectRun?.errorSummary).toContain("deadline");
  });

  it("fails structurally when no active collector is registered", async () => {
    const repo = createInMemoryPulseRepo();
    const handlers = makeHandlers(repo);

    const result = await handlers["pulse.collect.sample"]({
      job: "pulse.collect.sample",
      payload: { url: "https://www.caffeineinformer.com/caffeine-content/red-bull" },
    });
    expect(result).toMatchObject({ status: "failed", errorCode: "no_active_collector" });
    expect(repo.__debug.runs.size).toBe(0);
  });

  it("rejects malformed payloads with a structured failure", async () => {
    const repo = createInMemoryPulseRepo();
    const handlers = makeHandlers(repo);

    await expect(
      handlers["pulse.collect.sample"]({ job: "pulse.collect.sample", payload: {} }),
    ).resolves.toMatchObject({ status: "failed", errorCode: "invalid_payload" });

    await expect(
      handlers["pulse.collect.discovery"]({ job: "pulse.collect.discovery", payload: {} }),
    ).resolves.toMatchObject({ status: "failed", errorCode: "invalid_payload" });
  });
});

// ---------------------------------------------------------------------------
// Remaining planned stages: change/incident reporting and healing
// ---------------------------------------------------------------------------

describe("complete PulseRank safety and healing stages", () => {
  const previewEnvelope = {
    collector_id: JUDGE_COLLECTOR_ID,
    status: "awaiting_approval",
    completed_steps: ["preview"],
    prompt: "Preserve the per-item caffeine unit and do not invent volume.",
    preview_result: [
      {
        product_name: "Recovered Mint",
        product_page_url: "https://www.caffeineinformer.com/caffeine-content/recovered-mint",
        serving_size: "1 mint",
        caffeine_mg_per_serving: 72,
      },
    ],
  };

  it("reports atomic change detection and quarantine incidents without duplicating them", async () => {
    const repo = createInMemoryPulseRepo();
    const { run } = await seedRunWithRows(repo, [
      makeScrapeRow({
        slug: "quarantine-stage",
        caffeine: { state: "unparseable", value: null, qualifier: "unknown" },
      }),
    ]);
    const handlers = makeHandlers(repo);
    await handlers["pulse.ingest.run"]({ job: "pulse.ingest.run", payload: { runId: run.id } });
    await handlers["pulse.validate.run"]({ job: "pulse.validate.run", payload: { runId: run.id } });
    await handlers["pulse.promote.snapshot"]({ job: "pulse.promote.snapshot", payload: { runId: run.id } });

    const incident = await handlers["pulse.incident.open"]({
      job: "pulse.incident.open",
      payload: { runId: run.id },
    });
    expect(incident).toMatchObject({ status: "ok" });
    expect(incident.status === "ok" && incident.details.opened).toBe(1);
    expect(repo.__debug.incidents).toHaveLength(1);

    const changes = await handlers["pulse.detect.changes"]({
      job: "pulse.detect.changes",
      payload: { runId: run.id },
    });
    expect(changes).toMatchObject({ status: "ok" });
    expect(changes.status === "ok" && changes.details.idempotent).toBe(true);

    const repeated = await handlers["pulse.incident.open"]({
      job: "pulse.incident.open",
      payload: { runId: run.id },
    });
    expect(repeated.status === "ok" && repeated.details.opened).toBe(1);
    expect(repo.__debug.incidents).toHaveLength(1);
  });

  it("keeps raw retention an explicit safe skip until policy is configured", async () => {
    const repo = createInMemoryPulseRepo();
    const handler = makeHandlers(repo)["pulse.retention"];
    await expect(handler({ job: "pulse.retention", payload: {} })).resolves.toMatchObject({
      status: "skipped",
      reason: "retention_policy_not_configured",
    });
    expect(repo.__debug.rawRecords.size).toBe(0);
  });

  it("validates a heal preview, persists a pending session, and refuses pre-approval verification", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    const handlers = makeHandlers(repo, {
      flags: { judgeMutationsEnabled: true },
      healPreview: async () => previewEnvelope,
    });

    const preview = await handlers["pulse.heal.preview"]({
      job: "pulse.heal.preview",
      payload: {
        sourceUrl: "https://www.caffeineinformer.com/caffeine-content/recovered-mint",
        prompt: "Preserve the per-item caffeine unit and do not invent volume.",
      },
    });
    expect(preview).toMatchObject({ status: "ok" });
    const sessionId = preview.status === "ok" ? String(preview.details.sessionId) : "";
    const session = await repo.getHealSession(sessionId);
    expect(session?.approvedAt).toBeNull();
    expect(session?.preview.validation).toMatchObject({ ok: true, rowCount: 1 });

    const verifyBeforeApproval = await handlers["pulse.heal.verify"]({
      job: "pulse.heal.verify",
      payload: { sessionId },
    });
    expect(verifyBeforeApproval).toMatchObject({
      status: "failed",
      errorCode: "human_approval_required",
    });
    expect(repo.__debug.runs.size).toBe(0);
  });

  it("reruns the same collector after approval and promotes the recovered row", async () => {
    const repo = createInMemoryPulseRepo();
    const source = repo.seedSource({ slug: "caffeine-informer" });
    repo.seedCollector({ sourceId: source.id, externalId: JUDGE_COLLECTOR_ID });
    const handlers = makeHandlers(repo, {
      flags: { judgeMutationsEnabled: true },
      healPreview: async () => previewEnvelope,
      collect: async (input) => {
        expect(input.url).toBe(
          "https://www.caffeineinformer.com/caffeine-content/recovered-mint",
        );
        return {
          rows: previewEnvelope.preview_result,
          fingerprint: "sha256:healed-rerun",
        };
      },
    });

    const preview = await handlers["pulse.heal.preview"]({
      job: "pulse.heal.preview",
      payload: {
        sourceUrl: "https://www.caffeineinformer.com/caffeine-content/recovered-mint",
        prompt: "Preserve the per-item caffeine unit and do not invent volume.",
      },
    });
    expect(preview.status).toBe("ok");
    const sessionId = preview.status === "ok" ? String(preview.details.sessionId) : "";
    await repo.approveHealSession(sessionId, "human:test-operator");

    const verified = await handlers["pulse.heal.verify"]({
      job: "pulse.heal.verify",
      payload: { sessionId },
    });
    expect(verified).toMatchObject({ status: "ok" });
    expect(verified.status === "ok" && verified.details.collectorId).toBe(JUDGE_COLLECTOR_ID);
    expect(repo.__debug.observations.size).toBe(1);
    expect([...repo.__debug.observations.values()][0]?.status).toBe("trusted");
  });
});

// ---------------------------------------------------------------------------
// Dispatch contract regression (legacy jobs stay dead)
// ---------------------------------------------------------------------------

describe("dispatch contract with wired handlers", () => {
  it("still rejects every legacy denylisted job name", async () => {
    for (const name of LEGACY_JOB_DENYLIST) {
      await expect(dispatch({ name })).resolves.toEqual({
        accepted: false,
        reason: "legacy_or_unknown_job_rejected",
      });
    }
  });

  it("still rejects unknown pulse-ish names without executing anything", async () => {
    await expect(dispatch({ name: "pulse.definitely.not.a.job" })).resolves.toEqual({
      accepted: false,
      reason: "legacy_or_unknown_job_rejected",
    });
  });
});

// ---------------------------------------------------------------------------
// Bright Data CLI client (real client, injected runner seam)
// ---------------------------------------------------------------------------

const BD_ENV = {
  DATABASE_URL: "postgres://pulse:pulse@localhost:5432/pulse_test",
  BRIGHTDATA_API_TOKEN: "token-test",
  BRIGHTDATA_COLLECTOR_ID: "c_mt33nlnkq376z132b",
};

describe("bdata-client spawn contract", () => {
  const savedEnv: Record<string, string | undefined> = {};
  let commands: BdataRunnerCommand[] = [];

  function capturingRunner(stdout: string, exitCode = 0): BdataCliRunner {
    return async (command) => {
      commands.push(command);
      return { stdout, exitCode };
    };
  }

  afterEach(() => {
    for (const key of Object.keys(BD_ENV)) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
  });

  it("spawns the pinned entrypoint with the token mapped to BRIGHTDATA_API_KEY", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    const output: BdataCollectOutput = await collectViaBdata(
      {
        mode: "sample",
        url: "https://www.caffeineinformer.com/caffeine-content/red-bull",
        timeoutMs: 1234,
      },
      capturingRunner(JSON.stringify([{ ok: true }])),
    );

    const command = commands[0];
    expect(output.rows).toEqual([{ ok: true }]);
    expect(command?.timeoutMs).toBe(1234);
    expect(command?.argv[0]).toBe(process.execPath);
    expect(command?.argv[1]?.endsWith("node_modules/@brightdata/cli/dist/index.js")).toBe(true);
    expect(command?.argv.slice(2)).toEqual([
      "scraper",
      "run",
      BD_ENV.BRIGHTDATA_COLLECTOR_ID,
      "https://www.caffeineinformer.com/caffeine-content/red-bull",
      "--json",
    ]);
    // Token crosses the boundary ONLY under the CLI's expected variable name.
    expect(command?.env.BRIGHTDATA_API_KEY).toBe("token-test");
    expect(command?.env.BRIGHTDATA_API_TOKEN).toBeUndefined();
  });

  it("wraps a bare JSON object into a one-row array", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    const output = await collectViaBdata(
      { mode: "sample", url: "https://www.caffeineinformer.com/x" },
      capturingRunner('{"single":"row"}'),
    );
    expect(output.rows).toEqual([{ single: "row" }]);
  });

  it("unwraps one JSON-encoded batch document returned by the CLI", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    const output = await collectViaBdata(
      { mode: "sample", inputFile: "/tmp/pulse-input.txt" },
      capturingRunner(JSON.stringify(JSON.stringify([{ product_name: "Batch row" }]))),
    );

    expect(output.rows).toEqual([{ product_name: "Batch row" }]);
  });

  it("parses newline-delimited JSON rows inside a batch document", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    const ndjson = [
      JSON.stringify({ product_name: "First batch row" }),
      JSON.stringify({ product_name: "Second batch row" }),
    ].join("\n");
    const output = await collectViaBdata(
      { mode: "sample", inputFile: "/tmp/pulse-input.txt" },
      capturingRunner(JSON.stringify(ndjson)),
    );

    expect(output.rows).toEqual([
      { product_name: "First batch row" },
      { product_name: "Second batch row" },
    ]);
  });

  it("rejects a batch document containing a scalar status line", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    const ndjson = `${JSON.stringify({ product_name: "Valid row" })}\n${JSON.stringify("status")}`;
    await expect(
      collectViaBdata(
        { mode: "sample", inputFile: "/tmp/pulse-input.txt" },
        capturingRunner(JSON.stringify(ndjson)),
      ),
    ).rejects.toMatchObject({ code: "BDATA_NON_JSON_OUTPUT" });
  });

  it.each([
    ["empty array", "[]", "BDATA_EMPTY_OUTPUT"],
    ["non-json output", "oops not json", "BDATA_NON_JSON_OUTPUT"],
  ])("fails structurally on %s", async (_label, stdout, expectedCode) => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    await expect(
      collectViaBdata({ mode: "sample", url: "https://www.caffeineinformer.com/x" }, capturingRunner(stdout)),
    ).rejects.toMatchObject({ code: expectedCode, name: "BdataClientError" });
  });

  it("fails structurally on a nonzero CLI exit code", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    await expect(
      collectViaBdata(
        { mode: "sample", url: "https://www.caffeineinformer.com/x" },
        capturingRunner("", 3),
      ),
    ).rejects.toMatchObject({ code: "BDATA_CLI_FAILED" });
  });

  it("resolves the discovery listing URL from an input file", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    const dir = mkdtempSync(path.join(tmpdir(), "pulse-discovery-"));
    try {
      const filePath = path.join(dir, "urls.txt");
      writeFileSync(
        filePath,
        "# comment line\nhttps://www.caffeineinformer.com/first\nhttps://www.caffeineinformer.com/second\n",
      );

      const output = await collectViaBdata({ mode: "discovery", inputFile: filePath }, capturingRunner("[{\"url\":\"x\"}]"));

      const command = commands[0];
      expect(output.rows).toEqual([{ url: "x" }]);
      expect(command?.argv.slice(2)).toEqual([
        "scraper",
        "run",
        BD_ENV.BRIGHTDATA_COLLECTOR_ID,
        "https://www.caffeineinformer.com/first",
        "--json",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("fails structurally when discovery has neither query nor readable input file", async () => {
    for (const [key, value] of Object.entries(BD_ENV)) {
      savedEnv[key] = process.env[key];
      process.env[key] = value;
    }
    commands = [];

    await expect(
      collectViaBdata({ mode: "discovery" }, capturingRunner("[]")),
    ).rejects.toMatchObject({ code: "BDATA_DISCOVERY_QUERY_MISSING" });

    await expect(
      collectViaBdata({ mode: "discovery", inputFile: "/nonexistent/path.txt" }, capturingRunner("[]")),
    ).rejects.toMatchObject({ code: "BDATA_INPUT_FILE_UNREADABLE" });
  });

  it("surfaces unconfigured credentials as BDATA_ENV_UNCONFIGURED without spawning", async () => {
    // The server env is cached module-globally after the first successful
    // parse, so this test re-imports the client chain from a clean module
    // registry with the credentials removed from process.env.
    const inherited: Record<string, string | undefined> = {};
    for (const key of ["DATABASE_URL", "BRIGHTDATA_API_TOKEN", "BRIGHTDATA_COLLECTOR_ID"]) {
      inherited[key] = process.env[key];
      delete process.env[key];
    }
    commands = [];
    try {
      vi.resetModules();
      const freshClient = (await import("@/server/collection/bdata-client")) as typeof import("@/server/collection/bdata-client");
      await expect(
        freshClient.collectViaBdata(
          { mode: "sample", url: "https://www.caffeineinformer.com/x" },
          capturingRunner("[]"),
        ),
      ).rejects.toMatchObject({ code: "BDATA_ENV_UNCONFIGURED" });
      expect(commands).toHaveLength(0);
    } finally {
      for (const [key, value] of Object.entries(inherited)) {
        if (value !== undefined) process.env[key] = value;
      }
    }
  });
});
