/**
 * Explicit PulseRank collection runner.
 *
 * This is the operator-facing end-to-end path for the consented Caffeine
 * Informer source: register the source/collector, collect raw rows, ingest,
 * validate, promote trusted observations, and rebuild all three boards.
 * It never approves a Bright Data heal and refuses non-Caffeine Informer URLs.
 * Raw payloads remain in pulse.raw_records; this script prints only structured
 * stage summaries and ids.
 */

import { existsSync } from "node:fs";

const SOURCE_SLUG = "caffeine-informer";
const SOURCE_NAME = "Caffeine Informer";
const SOURCE_URL = "https://www.caffeineinformer.com";
const DEFAULT_LISTING_URL =
  "https://www.caffeineinformer.com/the-caffeine-database";
const COLLECTOR_ID = "c_mt33nlnkq376z132b";

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value !== undefined && value.trim() !== "" ? value.trim() : null;
}

function assertCaffeineInformerUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.hostname !== "www.caffeineinformer.com") {
    throw new Error("PulseRank collection is restricted to www.caffeineinformer.com.");
  }
}

function printStage(name: string, result: unknown): void {
  process.stdout.write(`${JSON.stringify({ stage: name, result }, null, 2)}\n`);
}

const mode = argument("--mode") ?? "discovery";
if (mode !== "discovery" && mode !== "sample") {
  throw new Error("--mode must be discovery or sample");
}

const url = argument("--url") ?? (mode === "discovery" ? DEFAULT_LISTING_URL : null);
const inputFile = argument("--input-file");
if (url !== null) assertCaffeineInformerUrl(url);
if (inputFile !== null && !existsSync(inputFile)) {
  throw new Error(`collection input file does not exist: ${inputFile}`);
}

const { and, eq, ne } = await import("drizzle-orm");
const { db, sql } = await import("@/server/db/client");
const { pulseCollectors, pulseSources } = await import("@/server/db/schema/pulse");
const { collectViaBdata } = await import("@/server/collection/bdata-client");
const { runInPulseTransaction } = await import("@/server/ingestion/repo");
const { createPulseJobHandlers } = await import("@/server/jobs/pulse-handlers");

try {
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
  if (sourceId === undefined) throw new Error("could not register Caffeine Informer source");

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
  const collectorId = collectorInsert[0]?.id;
  if (collectorId === undefined) throw new Error("could not register PulseRank collector");

  await db
    .update(pulseCollectors)
    .set({ active: false, updatedAt: new Date() })
    .where(
      and(
        eq(pulseCollectors.sourceId, sourceId),
        ne(pulseCollectors.externalId, COLLECTOR_ID),
      ),
    );

  printStage("registered", {
    source: SOURCE_SLUG,
    collector: COLLECTOR_ID,
    collectorRowId: collectorId,
  });

  const runtime = {
    runTransaction: runInPulseTransaction,
    flags: { collectionEnabled: true, discoveryEnabled: true },
    now: () => new Date(),
    collect: collectViaBdata,
  } as const;
  const handlers = createPulseJobHandlers(runtime, (job) => async () => ({
    status: "not_implemented" as const,
    job,
  }));

  const collectJob = mode === "sample" ? "pulse.collect.sample" : "pulse.collect.discovery";
  const collectPayload =
    mode === "sample"
      ? { url: url ?? undefined, ...(inputFile === null ? {} : { inputFile }) }
      : { query: url ?? undefined, ...(inputFile === null ? {} : { inputFile }) };
  if (mode === "sample" && url === null && inputFile === null) {
    throw new Error("sample mode needs --url or --input-file");
  }

  const collected = await handlers[collectJob]({
    job: collectJob,
    payload: collectPayload,
  });
  printStage("collected", collected);
  if (collected.status !== "ok") throw new Error(`collection stage did not succeed: ${collected.status}`);

  const runId = typeof collected.details.runId === "string" ? collected.details.runId : null;
  if (runId === null) throw new Error("collection succeeded without a run id");

  for (const job of [
    "pulse.ingest.run",
    "pulse.validate.run",
    "pulse.promote.snapshot",
    "pulse.rebuild.leaderboards",
  ] as const) {
    const result = await handlers[job]({
      job,
      payload: job === "pulse.rebuild.leaderboards" ? {} : { runId },
    });
    printStage(job, result);
    if (result.status !== "ok") throw new Error(`${job} did not succeed: ${result.status}`);
    if (job === "pulse.validate.run" && result.details.validationOk === false) {
      throw new Error("validation gate failed; promotion was not attempted");
    }
  }

  printStage("complete", { runId, collector: COLLECTOR_ID, source: SOURCE_SLUG });
} finally {
  await sql.end({ timeout: 5 });
}
