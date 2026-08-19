import { hostname } from "node:os";

import { sql } from "@/server/db/client";
import {
  claimNextJob,
  enqueueScheduledJobs,
  processJob,
  renewJobLease,
  JOB_LEASE_RENEWAL_INTERVAL_MS,
} from "@/server/jobs/queue";

const heartbeatIntervalMs = 30_000;
const schedulerIntervalMs = 30_000;
const jobPollIntervalMs = 2_000;
const workerId = `${hostname()}:${process.pid}`;
const startedAt = new Date();
let stopping = false;
let processing = false;
let activeWork: Promise<void> | null = null;
const timers: {
  heartbeat?: ReturnType<typeof setInterval>;
  scheduler?: ReturnType<typeof setInterval>;
  job?: ReturnType<typeof setInterval>;
} = {};

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
  if (timers.heartbeat) clearInterval(timers.heartbeat);
  if (timers.scheduler) clearInterval(timers.scheduler);
  if (timers.job) clearInterval(timers.job);
  process.stdout.write(`Worker received ${signal}; draining active work before closing.\n`);
  if (activeWork) await activeWork.catch(() => undefined);
  await sql.end({ timeout: 5 });
  process.exit(0);
}
async function schedule() {
  await enqueueScheduledJobs();
}

async function work() {
  if (processing || stopping) return;
  processing = true;
  const currentWork = (async () => {
    const job = await claimNextJob(workerId);
    if (!job) return;
    const leaseTimer = setInterval(() => {
      void renewJobLease(job.id, job.locked_by).then((alive) => {
        if (!alive) process.stderr.write(`Worker lease lost for job ${job.id}.\n`);
      }).catch(() => {
        process.stderr.write(`Worker lease renewal failed for job ${job.id}.\n`);
      });
    }, JOB_LEASE_RENEWAL_INTERVAL_MS);
    try {
      await processJob(job);
    } finally {
      clearInterval(leaseTimer);
    }
  })();
  activeWork = currentWork;
  try {
    await currentWork;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown worker error";
    process.stderr.write(`Worker job failed safely: ${message}\n`);
  } finally {
    if (activeWork === currentWork) activeWork = null;
    processing = false;
  }
}
process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

await heartbeat();
await schedule();
process.stdout.write(`Worker heartbeat active as ${workerId}.\n`);
process.stdout.write("Five-minute collection scheduler active.\n");

timers.heartbeat = setInterval(() => {
  void heartbeat().catch(() => {
    process.stderr.write("Worker heartbeat failed.\n");
  });
}, heartbeatIntervalMs);

timers.scheduler = setInterval(() => {
  void schedule().catch(() => {
    process.stderr.write("Worker scheduler failed.\n");
  });
}, schedulerIntervalMs);

timers.job = setInterval(() => void work(), jobPollIntervalMs);
void work();
