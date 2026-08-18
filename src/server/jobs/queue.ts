import { and, eq, inArray, lte } from "drizzle-orm";

import { db, sql } from "@/server/db/client";
import { collectionRuns, jobs } from "@/server/db/schema";
import {
  CollectionOverlapError,
  expireRawPayloadBodies,
  runCollection,
} from "@/server/services/collection";
import { expireIncidentArtifacts } from "@/server/services/incident-artifacts";
import { isIncidentJob, processIncidentJob } from "./incident-jobs";

const COLLECTION_JOB = "collect_sfmta_elevators";
const RETENTION_JOB = "expire_raw_payloads";

type JobTrigger = "scheduled" | "manual" | "retry";

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

function collectionBucket(now: Date) {
  const bucket = new Date(now);
  bucket.setUTCSeconds(0, 0);
  bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5);
  return bucket;
}

async function recoverAbandonedWork(now: Date) {
  const staleBefore = new Date(now.getTime() - 10 * 60 * 1_000);

  await db
    .update(jobs)
    .set({
      status: "queued",
      scheduledFor: now,
      lockedAt: null,
      lockedBy: null,
      lastError: "Worker heartbeat ended while this job was running.",
      updatedAt: now,
    })
    .where(
      and(
        eq(jobs.status, "running"),
        lte(jobs.lockedAt, staleBefore),
      ),
    );

  await db
    .update(collectionRuns)
    .set({
      status: "failed",
      classification: "ambiguous_contract_failure",
      finishedAt: now,
      errorCode: "COLLECTION_ABANDONED",
      errorSummary: "The worker ended before this collection reached a trust decision.",
      reasonCodes: ["COLLECTION_ABANDONED"],
    })
    .where(
      and(
        inArray(collectionRuns.status, ["collecting", "validating"]),
        lte(collectionRuns.startedAt, staleBefore),
      ),
    );
}

export async function enqueueScheduledJobs(now = new Date()) {
  await recoverAbandonedWork(now);
  const bucket = collectionBucket(now);
  const day = now.toISOString().slice(0, 10);

  await db
    .insert(jobs)
    .values([
      {
        type: COLLECTION_JOB,
        payload: { trigger: "scheduled", bucket: bucket.toISOString() },
        idempotencyKey: `collect:scheduled:${bucket.toISOString()}`,
        scheduledFor: bucket,
      },
      {
        type: RETENTION_JOB,
        payload: { day },
        idempotencyKey: `retention:${day}`,
        scheduledFor: new Date(`${day}T08:00:00.000Z`),
        maxAttempts: 3,
      },
    ])
    .onConflictDoNothing({ target: jobs.idempotencyKey });
}

export async function hasActiveCollection(now = new Date()) {
  await recoverAbandonedWork(now);

  const [activeJob] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(eq(jobs.type, COLLECTION_JOB), inArray(jobs.status, ["queued", "running"])),
    )
    .limit(1);
  if (activeJob) return true;

  const [activeRun] = await db
    .select({ id: collectionRuns.id })
    .from(collectionRuns)
    .where(inArray(collectionRuns.status, ["collecting", "validating"]))
    .limit(1);
  return Boolean(activeRun);
}

export async function enqueueManualCollection(idempotencyKey: string) {
  if (await hasActiveCollection()) throw new CollectionOverlapError();

  const [job] = await db
    .insert(jobs)
    .values({
      type: COLLECTION_JOB,
      payload: { trigger: "manual" },
      idempotencyKey: `collect:manual:${idempotencyKey}`,
      scheduledFor: new Date(),
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id, status: jobs.status });

  if (job) return job;
  const [existing] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(eq(jobs.idempotencyKey, `collect:manual:${idempotencyKey}`))
    .limit(1);
  if (!existing) throw new Error("Could not enqueue the collection job.");
  return existing;
}

export async function claimNextJob(workerId: string) {
  const [job] = await sql<ClaimedJob[]>`
    with candidate as (
      select id
      from jobs
      where status = 'queued' and scheduled_for <= now()
      order by scheduled_for asc, created_at asc
      for update skip locked
      limit 1
    )
    update jobs
    set
      status = 'running',
      attempts = jobs.attempts + 1,
      locked_at = now(),
      locked_by = ${workerId},
      started_at = coalesce(jobs.started_at, now()),
      updated_at = now()
    from candidate
    where jobs.id = candidate.id
    returning jobs.id, jobs.type, jobs.payload, jobs.attempts, jobs.max_attempts
  `;
  return job ?? null;
}

async function markSucceeded(jobId: string) {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: "succeeded",
      finishedAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: now,
    })
    .where(eq(jobs.id, jobId));
}

async function markFailed(job: ClaimedJob, error: unknown) {
  const terminal = job.attempts >= job.max_attempts;
  const now = new Date();
  const retryDelaySeconds = Math.min(60, 2 ** job.attempts) + Math.floor(Math.random() * 3);
  const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown job failure";
  await db
    .update(jobs)
    .set({
      status: terminal ? "failed" : "queued",
      scheduledFor: terminal
        ? now
        : new Date(now.getTime() + retryDelaySeconds * 1_000),
      finishedAt: terminal ? now : null,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      updatedAt: now,
    })
    .where(eq(jobs.id, job.id));
}

export async function processJob(job: ClaimedJob) {
  try {
    if (job.type === COLLECTION_JOB) {
      const requestedTrigger = job.payload.trigger;
      const trigger: JobTrigger =
        requestedTrigger === "manual"
          ? "manual"
          : job.attempts > 1
            ? "retry"
            : "scheduled";
      await runCollection(trigger);
    } else if (job.type === RETENTION_JOB) {
      await Promise.all([
        expireRawPayloadBodies(),
        expireIncidentArtifacts(),
      ]);
    } else if (isIncidentJob(job.type)) {
      await processIncidentJob(job);
    } else {
      throw new Error(`Unsupported job type: ${job.type}`);
    }
    await markSucceeded(job.id);
  } catch (error) {
    await markFailed(job, error);
    throw error;
  }
}
