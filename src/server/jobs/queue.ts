import { and, eq, inArray, lte, notInArray, sql as drizzleSql } from "drizzle-orm";

import { db, sql } from "@/server/db/client";
import { collectionRuns, jobs } from "@/server/db/schema";
import {
  CollectionOverlapError,
  expireRawPayloadBodies,
  runCollection,
} from "@/server/services/collection";
import { expireIncidentArtifacts } from "@/server/services/incident-artifacts";
import {
  isIncidentJob,
  MUTATING_INCIDENT_JOB_TYPES,
  processIncidentJob,
  reconcileAbandonedIncidentJob,
} from "./incident-jobs";

const COLLECTION_JOB = "collect_sfmta_elevators";
const RETENTION_JOB = "expire_raw_payloads";
export const JOB_LEASE_TIMEOUT_MS = 15 * 60 * 1_000;
export const JOB_LEASE_RENEWAL_INTERVAL_MS = 30 * 1_000;
const COLLECTION_ENQUEUE_LOCK_KEY = 7_431_926_118;
const OVERLAP_DEFER_MS = 15 * 1_000;

export function isJobLeaseExpired(
  lockedAt: Date | null,
  now = new Date(),
  timeoutMs = JOB_LEASE_TIMEOUT_MS,
) {
  return Boolean(lockedAt && now.getTime() - lockedAt.getTime() >= timeoutMs);
}

type JobTrigger = "scheduled" | "manual" | "retry";

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  locked_by: string;
};

function collectionBucket(now: Date) {
  const bucket = new Date(now);
  bucket.setUTCSeconds(0, 0);
  bucket.setUTCMinutes(Math.floor(bucket.getUTCMinutes() / 5) * 5);
  return bucket;
}

async function recoverAbandonedWork(now: Date) {
  const staleBefore = new Date(now.getTime() - JOB_LEASE_TIMEOUT_MS);
  const staleLease = and(eq(jobs.status, "running"), lte(jobs.lockedAt, staleBefore));
  const abandonedMutatingJobs = await db
    .update(jobs)
    .set({
      status: "failed",
      finishedAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: "MUTATING_JOB_ABANDONED: worker lease expired before completion.",
      updatedAt: now,
    })
    .where(and(staleLease, inArray(jobs.type, [...MUTATING_INCIDENT_JOB_TYPES])))
    .returning({ id: jobs.id, type: jobs.type, payload: jobs.payload });

  // Reconcile only rows atomically claimed by the stale predicate above.
  for (const job of abandonedMutatingJobs) {
    await reconcileAbandonedIncidentJob(job, now);
  }

  await db
    .update(jobs)
    .set({
      status: "queued",
      scheduledFor: now,
      lockedAt: null,
      lockedBy: null,
      lastError: "Worker lease expired while this job was running.",
      updatedAt: now,
    })
    .where(and(staleLease, notInArray(jobs.type, [...MUTATING_INCIDENT_JOB_TYPES])));

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

  await db.transaction(async (transaction) => {
    await transaction.execute(drizzleSql`select pg_advisory_xact_lock(${COLLECTION_ENQUEUE_LOCK_KEY})`);
    await transaction
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
  });
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
  const key = `collect:manual:${idempotencyKey}`;
  const now = new Date();
  await recoverAbandonedWork(now);

  return db.transaction(async (transaction) => {
    await transaction.execute(drizzleSql`select pg_advisory_xact_lock(${COLLECTION_ENQUEUE_LOCK_KEY})`);
    const [existing] = await transaction
      .select({ id: jobs.id, status: jobs.status })
      .from(jobs)
      .where(eq(jobs.idempotencyKey, key))
      .limit(1);
    if (existing) return existing;

    const [activeJob] = await transaction
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.type, COLLECTION_JOB), inArray(jobs.status, ["queued", "running"])))
      .limit(1);
    const [activeRun] = await transaction
      .select({ id: collectionRuns.id })
      .from(collectionRuns)
      .where(inArray(collectionRuns.status, ["collecting", "validating"]))
      .limit(1);
    if (activeJob || activeRun) throw new CollectionOverlapError();

    const [job] = await transaction
      .insert(jobs)
      .values({
        type: COLLECTION_JOB,
        payload: { trigger: "manual" },
        idempotencyKey: key,
        scheduledFor: now,
      })
      .returning({ id: jobs.id, status: jobs.status });
    if (!job) throw new Error("Could not enqueue the collection job.");
    return job;
  });
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
    returning jobs.id, jobs.type, jobs.payload, jobs.attempts, jobs.max_attempts, jobs.locked_by
  `;
  return job ?? null;
}

export async function renewJobLease(jobId: string, workerId: string) {
  const now = new Date();
  const [renewed] = await db
    .update(jobs)
    .set({ lockedAt: now, updatedAt: now })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.lockedBy, workerId)))
    .returning({ id: jobs.id });
  return Boolean(renewed);
}

async function markSucceeded(job: ClaimedJob) {
  const now = new Date();
  const [updated] = await db
    .update(jobs)
    .set({
      status: "succeeded",
      finishedAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: null,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.locked_by)))
    .returning({ id: jobs.id });
  return Boolean(updated);
}

async function markFailed(job: ClaimedJob, error: unknown) {
  const terminal = job.attempts >= job.max_attempts;
  const now = new Date();
  const retryDelaySeconds = Math.min(60, 2 ** job.attempts) + Math.floor(Math.random() * 3);
  const message = error instanceof Error ? error.message.slice(0, 300) : "Unknown job failure";
  const [updated] = await db
    .update(jobs)
    .set({
      status: terminal ? "failed" : "queued",
      scheduledFor: terminal ? now : new Date(now.getTime() + retryDelaySeconds * 1_000),
      finishedAt: terminal ? now : null,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.locked_by)))
    .returning({ id: jobs.id });
  return Boolean(updated);
}

async function deferJob(job: ClaimedJob, error: CollectionOverlapError) {
  const now = new Date();
  await db
    .update(jobs)
    .set({
      status: "queued",
      scheduledFor: new Date(now.getTime() + OVERLAP_DEFER_MS),
      finishedAt: null,
      lockedAt: null,
      lockedBy: null,
      lastError: error.message,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.locked_by)));
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
      await Promise.all([expireRawPayloadBodies(), expireIncidentArtifacts()]);
    } else if (isIncidentJob(job.type)) {
      await processIncidentJob(job);
    } else {
      throw new Error(`Unsupported job type: ${job.type}`);
    }
    if (!(await markSucceeded(job))) throw new Error("JOB_LEASE_LOST");
  } catch (error) {
    if (error instanceof CollectionOverlapError) {
      await deferJob(job, error);
    } else {
      await markFailed(job, error);
    }
    throw error;
  }
}
