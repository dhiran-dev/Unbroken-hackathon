/**
 * PulseRank worker (Agent A7a skeleton — NO data binding).
 *
 * Lifecycle mirrors the legacy worker (`src/worker/index.ts`, kept in place
 * until this replacement is fully wired — disposition REWRITE in
 * docs/transition/file-disposition.csv): startup log, periodic poll, lease
 * renewal while a job runs, graceful drain on SIGTERM/SIGINT.
 *
 * Deliberate skeleton seams (this file must not open sockets or databases):
 *
 * - Queue: a minimal in-process `PulseJobQueue` stands in for the Postgres
 *   queue. TODO-REWIRE: swap in the existing primitives from
 *   `src/server/jobs/queue.ts` (`claimNextJob`, `renewJobLease`, and the
 *   succeeded/failed settlement used by `processJob`) once the A0
 *   RETAIN_AND_REFACTOR refactor of that module lands with PulseRank-only job
 *   names. The primitives are reusable; importing them today would drag the
 *   legacy dispatch graph and a live DB client into this skeleton.
 * - Flags: collect-family jobs are gated on `PULSERANK_COLLECTION_ENABLED` /
 *   `PULSERANK_DISCOVERY_ENABLED` (via `src/config/pulserank-flags.ts`). A
 *   disabled gate skips the job with a log line; the job is never dispatched.
 * - Handlers: every job resolves to a `not_implemented` stub from
 *   `src/server/jobs/pulse-jobs.ts`.
 */

import { hostname } from "node:os";

import { pulserankServerFlags } from "@/config/pulserank-flags";
import {
  dispatch,
  isLegacyDeniedJobName,
  type PulseJobName,
} from "@/server/jobs/pulse-jobs";

/** Lease renewal cadence. TODO-REWIRE: reuse JOB_LEASE_RENEWAL_INTERVAL_MS from @/server/jobs/queue. */
const JOB_LEASE_RENEWAL_INTERVAL_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

/** A job as the queue hands it to the worker. */
export interface PulseWorkerJob {
  readonly id: string;
  readonly name: string;
  readonly payload: Record<string, unknown>;
}

/** Terminal outcomes the worker records for a claimed job. */
export type PulseJobSettlement = "succeeded" | "skipped_flag_disabled" | "rejected";

/**
 * Minimal queue seam. TODO-REWIRE: replace with the Postgres-backed primitives
 * in `src/server/jobs/queue.ts` (claimNextJob / renewJobLease / settlement) —
 * the disposition for that file is RETAIN_AND_REFACTOR, so the locking, lease,
 * retry, and idempotency mechanics carry over; only the job-name surface
 * changes to pulse.*.
 */
export interface PulseJobQueue {
  claimNext(workerId: string): Promise<PulseWorkerJob | null>;
  renewLease(jobId: string, workerId: string): Promise<boolean>;
  settle(
    jobId: string,
    workerId: string,
    settlement: PulseJobSettlement,
  ): Promise<boolean>;
}

export interface SettledPulseJob {
  readonly job: PulseWorkerJob;
  readonly settlement: PulseJobSettlement;
  readonly settledAt: Date;
}

/** In-process FIFO queue used only by the skeleton and its tests. */
export function createInMemoryPulseJobQueue(
  initial: readonly PulseWorkerJob[] = [],
): PulseJobQueue & {
  enqueue(job: PulseWorkerJob): void;
  settled(): readonly SettledPulseJob[];
} {
  const pending = [...initial];
  const running = new Map<string, { job: PulseWorkerJob; workerId: string }>();
  const settledJobs: SettledPulseJob[] = [];

  return {
    enqueue(job: PulseWorkerJob) {
      pending.push(job);
    },
    async claimNext(workerId: string) {
      const job = pending.shift();
      if (!job) return null;
      running.set(job.id, { job, workerId });
      return job;
    },
    async renewLease(jobId: string, workerId: string) {
      return running.get(jobId)?.workerId === workerId;
    },
    async settle(jobId: string, workerId: string, settlement: PulseJobSettlement) {
      const entry = running.get(jobId);
      if (!entry || entry.workerId !== workerId) return false;
      running.delete(jobId);
      settledJobs.push({ job: entry.job, settlement, settledAt: new Date() });
      return true;
    },
    settled() {
      return [...settledJobs];
    },
  };
}

/** The feature flags the worker consults before running collect-family jobs. */
export interface PulseWorkerFlags {
  readonly collectionEnabled: boolean;
  readonly discoveryEnabled: boolean;
}

export type PulseCollectJobName = Extract<PulseJobName, `pulse.collect.${string}`>;

/** Which flag gates each collect-family job, and the env var that backs it. */
export const COLLECT_JOB_FLAG_REQUIREMENTS: Readonly<
  Record<
    PulseCollectJobName,
    { flag: keyof PulseWorkerFlags; env: "PULSERANK_COLLECTION_ENABLED" | "PULSERANK_DISCOVERY_ENABLED" }
  >
> = Object.freeze({
  "pulse.collect.sample": { flag: "collectionEnabled", env: "PULSERANK_COLLECTION_ENABLED" },
  "pulse.collect.refresh-batch": {
    flag: "collectionEnabled",
    env: "PULSERANK_COLLECTION_ENABLED",
  },
  "pulse.collect.discovery": { flag: "discoveryEnabled", env: "PULSERANK_DISCOVERY_ENABLED" },
});

export type CollectJobGateResult =
  | { allowed: true }
  | { allowed: false; flag: keyof PulseWorkerFlags; env: string };

/**
 * Gate check for a claimed job. Non-collect jobs are always allowed; collect
 * jobs require their flag to be enabled.
 */
export function evaluateCollectJobGate(
  name: string,
  flags: PulseWorkerFlags,
): CollectJobGateResult {
  const requirement = COLLECT_JOB_FLAG_REQUIREMENTS[name as PulseCollectJobName];
  if (!requirement) return { allowed: true };
  return flags[requirement.flag]
    ? { allowed: true }
    : { allowed: false, flag: requirement.flag, env: requirement.env };
}

function defaultFlags(): PulseWorkerFlags {
  return {
    collectionEnabled: pulserankServerFlags.collectionEnabled,
    discoveryEnabled: pulserankServerFlags.discoveryEnabled,
  };
}

export interface PulseWorkerOptions {
  /** Queue seam. Defaults to the in-process skeleton queue. TODO-REWIRE. */
  readonly queue?: PulseJobQueue;
  /** Flag provider, consulted before every collect job. Defaults to env flags. */
  readonly flags?: () => PulseWorkerFlags;
  readonly pollIntervalMs?: number;
  readonly workerId?: string;
  /** Install SIGTERM/SIGINT handlers (default true). Tests pass false. */
  readonly installSignalHandlers?: boolean;
  readonly log?: (line: string) => void;
  readonly logError?: (line: string) => void;
}

export interface PulseWorkerHandle {
  readonly workerId: string;
  /** Stop polling and drain the in-flight job. Idempotent. */
  stop(signal?: string): Promise<void>;
}

export function startPulseWorker(options: PulseWorkerOptions = {}): PulseWorkerHandle {
  const queue = options.queue ?? createInMemoryPulseJobQueue();
  const readFlags = options.flags ?? defaultFlags;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const workerId = options.workerId ?? `${hostname()}:${process.pid}`;
  const write = options.log ?? ((line: string) => process.stdout.write(`${line}\n`));
  const writeError =
    options.logError ?? ((line: string) => process.stderr.write(`${line}\n`));

  let stopping = false;
  let processing = false;
  let activeWork: Promise<void> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const signalHandlers = new Map<string, () => void>();

  function logStartup() {
    const flags = readFlags();
    write(`PulseRank worker starting as ${workerId}.`);
    write(
      `PulseRank flags: collection ${flags.collectionEnabled ? "enabled" : "disabled"}, discovery ${flags.discoveryEnabled ? "enabled" : "disabled"}.`,
    );
    write(`PulseRank worker polling every ${pollIntervalMs}ms (skeleton: stub handlers only).`);
  }

  async function runClaimedJob(job: PulseWorkerJob) {
    const leaseTimer = setInterval(() => {
      void queue
        .renewLease(job.id, workerId)
        .then((alive) => {
          if (!alive) writeError(`PulseRank worker lease lost for job ${job.id}.`);
        })
        .catch(() => {
          writeError(`PulseRank worker lease renewal failed for job ${job.id}.`);
        });
    }, JOB_LEASE_RENEWAL_INTERVAL_MS);

    try {
      // Read flags before ANY collect job; disabled => skip with a log line.
      const gate = evaluateCollectJobGate(job.name, readFlags());
      if (!gate.allowed) {
        write(
          `PulseRank worker skipping job ${job.id} (${job.name}): ${gate.env} is disabled.`,
        );
        await queue.settle(job.id, workerId, "skipped_flag_disabled");
        return;
      }

      if (isLegacyDeniedJobName(job.name)) {
        // Defense in depth: the dispatcher also rejects this; never execute.
        writeError(
          `PulseRank worker rejected legacy job ${job.id} (${job.name}): legacy_or_unknown_job_rejected.`,
        );
        await queue.settle(job.id, workerId, "rejected");
        return;
      }

      const result = await dispatch({ name: job.name, payload: job.payload });
      if (!result.accepted) {
        writeError(
          `PulseRank worker rejected job ${job.id} (${job.name}): ${result.reason}.`,
        );
        await queue.settle(job.id, workerId, "rejected");
        return;
      }

      write(
        `PulseRank worker job ${job.id} (${job.name}) finished with status ${result.result.status}.`,
      );
      await queue.settle(job.id, workerId, "succeeded");
    } finally {
      clearInterval(leaseTimer);
    }
  }

  async function work() {
    if (processing || stopping) return;
    processing = true;
    const currentWork = (async () => {
      const job = await queue.claimNext(workerId);
      if (!job) return;
      await runClaimedJob(job);
    })();
    activeWork = currentWork;
    try {
      await currentWork;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown worker error";
      writeError(`PulseRank worker job failed safely: ${message}`);
    } finally {
      if (activeWork === currentWork) activeWork = null;
      processing = false;
    }
  }

  async function stop(signal = "stop"): Promise<void> {
    if (stopping) return;
    stopping = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    for (const [name, handler] of signalHandlers) {
      process.off(name, handler);
    }
    signalHandlers.clear();
    write(`PulseRank worker received ${signal}; draining active work before closing.`);
    if (activeWork) await activeWork.catch(() => undefined);
    write(`PulseRank worker ${workerId} stopped.`);
  }

  function installSignals() {
    const onSignal = (signal: string) => () => {
      void stop(signal).then(() => process.exit(0));
    };
    const sigterm = onSignal("SIGTERM");
    const sigint = onSignal("SIGINT");
    process.on("SIGTERM", sigterm);
    process.on("SIGINT", sigint);
    signalHandlers.set("SIGTERM", sigterm);
    signalHandlers.set("SIGINT", sigint);
  }

  logStartup();
  if (options.installSignalHandlers !== false) installSignals();
  pollTimer = setInterval(() => void work(), pollIntervalMs);
  void work();

  return { workerId, stop };
}

/**
 * Entry point: `bun src/worker/pulse-worker.ts`. The guard keeps imports of
 * this module (tests, future API routes) from starting timers.
 */
if (import.meta.main) {
  startPulseWorker();
}
