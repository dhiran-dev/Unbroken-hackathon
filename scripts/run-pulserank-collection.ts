/**
 * PulseRank collection and recovery operator.
 *
 * Supported recovery commands:
 *   --from-export <path> --dry-run
 *   --from-export <path>
 *   --resume-run <run-id>
 *
 * Live discovery submits asynchronously and exits with a run id. Resume polls
 * that persisted provider collection and completes the immutable pipeline once
 * its dataset is ready. No command approves healing automatically.
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { rawOutputFingerprint } from "@/server/collection/bdata-client";
import {
  assertReferenceExportPreflight,
  preflightExportRows,
  readExportRows,
  type ExportPreflightSummary,
} from "@/server/ingestion/export-recovery";
import {
  parsePulseOperatorCommand,
  type PulseOperatorCommand,
} from "@/server/ingestion/operator-command";

const SOURCE_SLUG = "caffeine-informer";
const SOURCE_NAME = "Caffeine Informer";
const SOURCE_URL = "https://www.caffeineinformer.com";
const DEFAULT_LISTING_URL =
  "https://www.caffeineinformer.com/the-caffeine-database";
const COLLECTOR_ID = "c_mt33nlnkq376z132b";

function assertCaffeineInformerUrl(value: string): void {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    (parsed.hostname !== "caffeineinformer.com" &&
      !parsed.hostname.endsWith(".caffeineinformer.com"))
  ) {
    throw new Error("PulseRank collection is restricted to Caffeine Informer.");
  }
}

function inputFileUrls(file: string): string[] {
  const raw = readFileSync(file, "utf8").trim();
  if (raw.startsWith("[") || raw.startsWith("{")) {
    const parsed: unknown = JSON.parse(raw);
    const items = Array.isArray(parsed)
      ? parsed
      : parsed !== null &&
          typeof parsed === "object" &&
          Array.isArray((parsed as { urls?: unknown }).urls)
        ? (parsed as { urls: unknown[] }).urls
        : null;
    if (items === null) {
      throw new Error(
        "collection input JSON must be an array or an object with a urls array",
      );
    }
    return items.flatMap((item) => {
      if (typeof item === "string") return [item.trim()];
      if (item !== null && typeof item === "object" && "url" in item) {
        const url = (item as { url?: unknown }).url;
        return typeof url === "string" ? [url.trim()] : [];
      }
      return [];
    });
  }
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}

function normalizeCliInputFile(file: string): {
  path: string;
  cleanup: () => void;
} {
  const raw = readFileSync(file, "utf8").trim();
  if (!raw.startsWith("{")) return { path: file, cleanup: () => undefined };
  const directory = mkdtempSync(path.join(tmpdir(), "pulserank-input-"));
  const normalized = path.join(directory, "urls.txt");
  writeFileSync(normalized, `${inputFileUrls(file).join("\n")}\n`, "utf8");
  return {
    path: normalized,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}

function printStage(name: string, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ stage: name, result }, null, 2)}\n`);
}

function prepareLiveInput(command: Extract<PulseOperatorCommand, { kind: "collect" }>): {
  url: string | null;
  inputFile: string | null;
  cleanup: () => void;
} {
  const url = command.url ?? (command.mode === "discovery" ? DEFAULT_LISTING_URL : null);
  if (url !== null) assertCaffeineInformerUrl(url);
  if (command.inputFile !== null && !existsSync(command.inputFile)) {
    throw new Error("collection input file does not exist");
  }
  if (command.inputFile === null) {
    if (command.mode === "sample" && url === null) {
      throw new Error("sample mode needs --url or --input-file");
    }
    return { url, inputFile: null, cleanup: () => undefined };
  }
  const urls = inputFileUrls(command.inputFile);
  if (urls.length === 0) throw new Error("collection input file contains no URLs");
  for (const inputUrl of urls) assertCaffeineInformerUrl(inputUrl);
  const normalized = normalizeCliInputFile(command.inputFile);
  return { url, inputFile: normalized.path, cleanup: normalized.cleanup };
}

async function executeWithDatabase(
  command: PulseOperatorCommand,
  exportRows: unknown[] | null,
  preflight: ExportPreflightSummary | null,
): Promise<void> {
  const { and, count, eq, isNotNull, ne } = await import("drizzle-orm");
  const { db, sql } = await import("@/server/db/client");
  const {
    pulseCollectors,
    pulseProductObservations,
    pulseProducts,
    pulseSources,
  } = await import("@/server/db/schema/pulse");
  const { collectViaBdata } = await import("@/server/collection/bdata-client");
  const { runInPulseTransaction } = await import("@/server/ingestion/repo");
  const { createPulseJobHandlers } = await import("@/server/jobs/pulse-handlers");

  async function catalogCounts() {
    const [products, trustedProducts, trustedObservations] = await Promise.all([
      db.select({ value: count() }).from(pulseProducts),
      db
        .select({ value: count() })
        .from(pulseProducts)
        .where(isNotNull(pulseProducts.currentTrustedObservationId)),
      db
        .select({ value: count() })
        .from(pulseProductObservations)
        .where(eq(pulseProductObservations.status, "trusted")),
    ]);
    return {
      products: products[0]?.value ?? 0,
      trustedProducts: trustedProducts[0]?.value ?? 0,
      trustedObservations: trustedObservations[0]?.value ?? 0,
    };
  }

  async function registerSource(): Promise<void> {
    const sourceInsert = await db
      .insert(pulseSources)
      .values({
        slug: SOURCE_SLUG,
        displayName: SOURCE_NAME,
        homepageUrl: SOURCE_URL,
        active: true,
      })
      .onConflictDoUpdate({
        target: pulseSources.slug,
        set: {
          displayName: SOURCE_NAME,
          homepageUrl: SOURCE_URL,
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: pulseSources.id });
    const sourceId = sourceInsert[0]?.id;
    if (sourceId === undefined) throw new Error("could not register source");

    const collectorInsert = await db
      .insert(pulseCollectors)
      .values({
        sourceId,
        externalId: COLLECTOR_ID,
        zone: "caffeine-informer-v2",
        active: true,
      })
      .onConflictDoUpdate({
        target: pulseCollectors.externalId,
        set: {
          sourceId,
          zone: "caffeine-informer-v2",
          active: true,
          updatedAt: new Date(),
        },
      })
      .returning({ id: pulseCollectors.id });
    if (collectorInsert[0]?.id === undefined) {
      throw new Error("could not register PulseRank collector");
    }
    await db
      .update(pulseCollectors)
      .set({ active: false, updatedAt: new Date() })
      .where(
        and(
          eq(pulseCollectors.sourceId, sourceId),
          ne(pulseCollectors.externalId, COLLECTOR_ID),
        ),
      );
    printStage("registered", { source: SOURCE_SLUG, collector: COLLECTOR_ID });
  }

  const runtime = {
    runTransaction: runInPulseTransaction,
    flags: { collectionEnabled: true, discoveryEnabled: true },
    now: () => new Date(),
    collect:
      exportRows === null
        ? collectViaBdata
        : async () => ({
            rows: exportRows,
            fingerprint: rawOutputFingerprint(exportRows),
          }),
    provider: {
      async submit(input: { url: string }) {
        const { createDefaultBrightDataProvider } = await import(
          "@/server/collection/bright-data-provider"
        );
        return (await createDefaultBrightDataProvider()).submit(input);
      },
      async poll(collectionId: string) {
        const { createDefaultBrightDataProvider } = await import(
          "@/server/collection/bright-data-provider"
        );
        return (await createDefaultBrightDataProvider()).poll(collectionId);
      },
    },
    enqueue: async (
      input: Parameters<
        typeof import("@/server/jobs/queue")["enqueuePulseJob"]
      >[0],
    ) => {
      const { enqueuePulseJob } = await import("@/server/jobs/queue");
      return enqueuePulseJob(input);
    },
  } as const;
  const handlers = createPulseJobHandlers(runtime, (job) => async () => ({
    status: "not_implemented" as const,
    job,
  }));

  async function runPipeline(runId: string): Promise<void> {
    for (const job of [
      "pulse.ingest.run",
      "pulse.validate.run",
      "pulse.promote.snapshot",
      "pulse.rebuild.leaderboards",
    ] as const) {
      const result = await handlers[job]({ job, payload: { runId } });
      printStage(job, result);
      if (result.status !== "ok") {
        throw new Error(`${job} did not succeed: ${result.status}`);
      }
      if (job === "pulse.validate.run" && result.details.validationOk === false) {
        throw new Error("validation gate failed; promotion was not attempted");
      }
    }
  }

  try {
    const before = await catalogCounts();
    printStage("database-before", before);

    if (command.kind === "resume") {
      const polled = await handlers["pulse.collect.poll"]({
        job: "pulse.collect.poll",
        payload: { runId: command.runId, resume: true },
      });
      printStage("pulse.collect.poll", polled);
      if (polled.status !== "ok") throw new Error("provider resume failed");
      if (polled.details.providerStatus !== "ready") {
        printStage("resume-pending", {
          runId: command.runId,
          providerStatus: polled.details.providerStatus,
        });
        return;
      }
      await runPipeline(command.runId);
      printStage("database-after", await catalogCounts());
      printStage("complete", { runId: command.runId, source: SOURCE_SLUG });
      return;
    }

    await registerSource();
    if (command.kind === "export") {
      if (exportRows === null || preflight === null) {
        throw new Error("validated export rows were not provided");
      }
      const collected = await handlers["pulse.collect.sample"]({
        job: "pulse.collect.sample",
        payload: { url: DEFAULT_LISTING_URL },
      });
      printStage("raw-landing", collected);
      if (collected.status !== "ok") throw new Error("export landing failed");
      const runId = String(collected.details.runId ?? "");
      if (runId === "") throw new Error("export landing returned no run id");
      await runInPulseTransaction(async (repo) => {
        const run = await repo.getCollectionRun(runId);
        if (run === null) throw new Error("export run was not persisted");
        await repo.updateCollectionRun(runId, {
          report: {
            ...(run.report ?? {}),
            recoveryImport: { preflight, source: SOURCE_SLUG },
          },
        });
      });
      await runPipeline(runId);
      printStage("database-after", await catalogCounts());
      printStage("complete", { runId, source: SOURCE_SLUG, import: "reference-export" });
      return;
    }

    const live = prepareLiveInput(command);
    try {
      const job =
        command.mode === "sample"
          ? ("pulse.collect.sample" as const)
          : ("pulse.collect.discovery" as const);
      const basePayload =
        command.mode === "sample"
          ? { url: live.url ?? undefined, inputFile: live.inputFile ?? undefined }
          : { query: live.url ?? undefined, inputFile: live.inputFile ?? undefined };
      const payload =
        command.timeoutMs === undefined
          ? basePayload
          : { ...basePayload, timeoutMs: command.timeoutMs };
      const collected = await handlers[job]({ job, payload });
      printStage(job, collected);
      if (collected.status !== "ok") throw new Error("collection did not succeed");
      const runId = String(collected.details.runId ?? "");
      if (runId === "") throw new Error("collection returned no run id");
      if (command.mode === "discovery") {
        printStage("submitted", {
          runId,
          nextCommand: `bun run collect:pulse -- --resume-run ${runId}`,
        });
        return;
      }
      await runPipeline(runId);
      printStage("database-after", await catalogCounts());
      printStage("complete", { runId, source: SOURCE_SLUG });
    } finally {
      live.cleanup();
    }
  } finally {
    await sql.end({ timeout: 5 });
  }
}

async function main(): Promise<void> {
  const command = parsePulseOperatorCommand(process.argv.slice(2));
  if (command.kind !== "export") {
    await executeWithDatabase(command, null, null);
    return;
  }

  const rows = await readExportRows(command.path);
  const preflight = preflightExportRows(rows, {
    observedAt: new Date().toISOString(),
  });
  assertReferenceExportPreflight(preflight.summary);
  printStage("export-preflight", preflight.summary);
  if (command.dryRun) return;
  await executeWithDatabase(command, rows, preflight.summary);
}

await main();
