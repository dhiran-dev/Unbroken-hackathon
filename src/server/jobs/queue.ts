import { and, eq, inArray, lte, sql as drizzleSql } from "drizzle-orm";

import {
  isLegacyDeniedJobName,
  isPulseJobName,
  PULSE_JOB_NAMES,
  dispatch,
} from "@/server/jobs/pulse-jobs";

import { db, sql } from "@/server/db/client";
import { jobs } from "@/server/db/schema";

/**
 * PulseRank-only job-queue primitives (disposition RETAIN_AND_REFACTOR, plan
 * 5.2): locking, leases, retries, and idempotency are carried over from the
 * legacy queue; every legacy job type (elevator collection, GTFS/advisory/
 * relocation/guide refresh) and the transit refresh dispatch were removed with
 * the L1 cleanup batch. The only accepted job names are exact members of
 * `PULSE_JOB_NAMES`, dispatched fail-closed through `@/server/jobs/pulse-jobs`.
 */

export const JOB_LEASE_TIMEOUT_MS = 15 * 60 * 1_000;
export const JOB_LEASE_RENEWAL_INTERVAL_MS = 30 * 1_000;
const PULSE_ENQUEUE_LOCK_KEY = 7_431_926_118;

export function isJobLeaseExpired(
  lockedAt: Date | null,
  now = new Date(),
  timeoutMs = JOB_LEASE_TIMEOUT_MS,
) {
  return Boolean(lockedAt && now.getTime() - lockedAt.getTime() >= timeoutMs);
}

export type ClaimedJob = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  locked_by: string;
};

/**
 * Requeue running jobs whose worker lease expired. The production PulseRank
 * worker invokes this once before it starts claiming work.
 */
export async function recoverAbandonedWork(now = new Date()) {
  const staleBefore = new Date(now.getTime() - JOB_LEASE_TIMEOUT_MS);
  const staleLease = and(
    eq(jobs.status, "running"),
    lte(jobs.lockedAt, staleBefore),
    inArray(jobs.type, [...PULSE_JOB_NAMES]),
  );

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
    .where(staleLease);
}

/**
 * Fail-closed enqueue. Only exact PulseRank job names are accepted; legacy
 * denylisted or unknown names are rejected without touching the database.
 */
export async function enqueuePulseJob(input: {
  name: string;
  payload?: Record<string, unknown>;
  idempotencyKey: string;
  scheduledFor?: Date;
  maxAttempts?: number;
}) {
  if (!isPulseJobName(input.name)) {
    throw new Error(`Unsupported job name: ${input.name}`);
  }
  if (isLegacyDeniedJobName(input.name)) {
    throw new Error(`Legacy job names can never be enqueued: ${input.name}`);
  }

  const now = new Date();
  return db.transaction(async (transaction) => {
    await transaction.execute(
      drizzleSql`select pg_advisory_xact_lock(${PULSE_ENQUEUE_LOCK_KEY})`,
    );
    const [job] = await transaction
      .insert(jobs)
      .values({
        type: input.name,
        payload: input.payload ?? {},
        idempotencyKey: input.idempotencyKey,
        scheduledFor: input.scheduledFor ?? now,
        maxAttempts: input.maxAttempts ?? 3,
      })
      .onConflictDoNothing({ target: jobs.idempotencyKey })
      .returning({ id: jobs.id, status: jobs.status });
    return job ?? null;
  });
}

export async function claimNextJob(workerId: string) {
  const [job] = await sql<ClaimedJob[]>`
    with candidate as (
      select id
      from jobs
      where status = 'queued'
        and scheduled_for <= now()
        and type = any(${sql.array([...PULSE_JOB_NAMES])})
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

/**
 * Rejected legacy/unknown jobs are terminal. Retrying them would only keep
 * retired government work in circulation and would obscure the safety event.
 */
async function markRejected(job: ClaimedJob, error: unknown) {
  const now = new Date();
  const message =
    error instanceof Error ? error.message.slice(0, 300) : "PulseRank rejected this job.";
  const [updated] = await db
    .update(jobs)
    .set({
      status: "failed",
      finishedAt: now,
      lockedAt: null,
      lockedBy: null,
      lastError: message,
      updatedAt: now,
    })
    .where(and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.lockedBy, job.locked_by)))
    .returning({ id: jobs.id });
  return Boolean(updated);
}

/** Settle a claimed job after the worker has completed its handler. */
export async function settleClaimedJob(
  job: ClaimedJob,
  outcome: "succeeded" | "failed" | "rejected",
  error?: unknown,
) {
  if (outcome === "succeeded") return markSucceeded(job);
  if (outcome === "rejected") {
    return markRejected(job, error ?? new Error("PulseRank rejected this job."));
  }
  return markFailed(job, error ?? new Error("PulseRank job failed."));
}

/**
 * Production queue adapter used by the PulseRank worker.
 *
 * The worker keeps the claimed row in this adapter until settlement so a
 * lease-renewal callback cannot accidentally settle a different retry of the
 * same id. Unknown/legacy job names are still rejected by the dispatcher
 * before any handler can run.
 */
export function createPostgresPulseJobQueue() {
  const claimed = new Map<string, ClaimedJob>();

  return {
    async claimNext(workerId: string) {
      const job = await claimNextJob(workerId);
      if (job !== null) claimed.set(job.id, job);
      return job;
    },
    renewLease: renewJobLease,
    async settle(
      jobId: string,
      workerId: string,
      outcome: "succeeded" | "failed" | "rejected",
      error?: unknown,
    ) {
      const job = claimed.get(jobId);
      if (job === undefined || job.locked_by !== workerId) return false;
      const settled = await settleClaimedJob(job, outcome, error);
      if (settled) claimed.delete(jobId);
      return settled;
    },
  };
}

/**
 * Process one claimed job through the fail-closed PulseRank dispatcher.
 *
 * - Rejected names (legacy denylisted / unknown / malformed) never execute and
 *   settle as failed with the rejection reason.
 * - `not_implemented` and `handler_error` results settle as failures so the
 *   queue never reports an unwired or broken pipeline as successful work.
 */
export async function processJob(job: ClaimedJob) {
  try {
    const result = await dispatch({ name: job.type, payload: job.payload });
    if (!result.accepted) {
      if (
        !(await settleClaimedJob(
          job,
          "rejected",
          new Error(`JOB_REJECTED: ${result.reason} (${job.type})`),
        ))
      ) {
        throw new Error("JOB_LEASE_LOST");
      }
      return;
    }
    if (
      result.result.status === "failed" ||
      result.result.status === "handler_error" ||
      result.result.status === "not_implemented"
    ) {
      const message =
        result.result.status === "failed" || result.result.status === "handler_error"
          ? result.result.message
          : `Job ${job.type} is not implemented.`;
      throw new Error(message || "PulseRank handler failed.");
    }
    if (!(await settleClaimedJob(job, "succeeded"))) {
      throw new Error("JOB_LEASE_LOST");
    }
  } catch (error) {
    await settleClaimedJob(job, "failed", error);
    throw error;
  }
}
