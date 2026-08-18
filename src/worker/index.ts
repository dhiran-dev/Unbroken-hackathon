import { hostname } from "node:os";

import { sql } from "@/server/db/client";
import {
  claimNextJob,
  enqueueScheduledJobs,
  processJob,
} from "@/server/jobs/queue";

const heartbeatIntervalMs = 30_000;
const schedulerIntervalMs = 30_000;
const jobPollIntervalMs = 2_000;
const workerId = `${hostname()}:${process.pid}`;
const startedAt = new Date();
let stopping = false;
let processing = false;

async function heartbeat() {
  await sql`
    insert into worker_heartbeats (
      worker_id,
      process_version,
      started_at,
      last_seen_at,
      metadata
    ) values (
      ${workerId},
      ${process.env.SOURCE_COMMIT ?? "local"},
      ${startedAt.toISOString()}::timestamptz,
      ${new Date().toISOString()}::timestamptz,
      ${JSON.stringify({ runtime: "bun", role: "worker" })}::jsonb
    )
    on conflict (worker_id) do update set
      process_version = excluded.process_version,
      started_at = excluded.started_at,
      last_seen_at = excluded.last_seen_at,
      metadata = excluded.metadata
  `;
}

async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  clearInterval(heartbeatTimer);
  clearInterval(schedulerTimer);
  clearInterval(jobTimer);
  process.stdout.write(`Worker received ${signal}; closing database connection.\n`);
  await sql.end({ timeout: 5 });
  process.exit(0);
}

async function schedule() {
  await enqueueScheduledJobs();
}

async function work() {
  if (processing || stopping) return;
  processing = true;
  try {
    const job = await claimNextJob(workerId);
    if (job) await processJob(job);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    process.stderr.write(`Worker job failed safely: ${message}\n`);
  } finally {
    processing = false;
  }
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

await heartbeat();
await schedule();
process.stdout.write(`Worker heartbeat active as ${workerId}.\n`);
process.stdout.write("Five-minute collection scheduler active.\n");

const heartbeatTimer = setInterval(() => {
  void heartbeat().catch(() => {
    process.stderr.write("Worker heartbeat failed.\n");
  });
}, heartbeatIntervalMs);

const schedulerTimer = setInterval(() => {
  void schedule().catch(() => {
    process.stderr.write("Worker scheduler failed.\n");
  });
}, schedulerIntervalMs);

const jobTimer = setInterval(() => void work(), jobPollIntervalMs);
void work();
