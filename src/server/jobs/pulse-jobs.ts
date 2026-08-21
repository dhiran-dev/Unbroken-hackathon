/**
 * PulseRank job dispatcher (Agent A7a skeleton — NO data binding).
 *
 * Single fail-closed gate between any enqueueing surface (API routes, worker,
 * CLI) and PulseRank job execution:
 *
 * - Only exact members of `PULSE_JOB_NAMES` are accepted.
 * - Every legacy UNBROKEN job name on `LEGACY_JOB_DENYLIST` is rejected, as is
 *   anything unknown, misspelled, or wrongly cased.
 * - Rejection never throws and never executes anything; it returns a structured
 *   `{ accepted: false }` result so callers can log and move on.
 *
 * Every accepted job resolves to a handler from `pulseJobHandlers`. All
 * handlers are typed stubs (`{ status: "not_implemented", job }`) until the
 * pipeline agents bind real implementations (ingestion, validation, promotion,
 * change detection, leaderboards, retention, incidents, healing).
 *
 * Deliberately dependency-free: importing this module must never open a
 * database connection or a network socket.
 */

/** The complete set of PulseRank job names. Nothing else may be dispatched. */
export const PULSE_JOB_NAMES = [
  "pulse.collect.sample",
  "pulse.collect.discovery",
  "pulse.collect.refresh-batch",
  "pulse.ingest.run",
  "pulse.validate.run",
  "pulse.promote.snapshot",
  "pulse.detect.changes",
  "pulse.rebuild.leaderboards",
  "pulse.retention",
  "pulse.incident.open",
  "pulse.heal.preview",
  "pulse.heal.verify",
] as const;

export type PulseJobName = (typeof PULSE_JOB_NAMES)[number];

/**
 * Legacy UNBROKEN job names that must never run again. Kept as an explicit
 * denylist (not merely "absent from the allowlist") so the repo-safety intent
 * is auditable and future refactors cannot silently resurrect a legacy name by
 * adding it to the pulse.* list.
 */
export const LEGACY_JOB_DENYLIST = [
  "collect-elevator-status",
  "refresh-gtfs",
  "refresh-accessibility-advisories",
  "refresh-stop-relocations",
  "refresh-stop-guides",
  "journey-refresh",
  "commute-notification",
] as const;

export type LegacyJobName = (typeof LEGACY_JOB_DENYLIST)[number];

/** Structured rejection reason. One value today; room for more later. */
export type PulseJobRejectionReason = "legacy_or_unknown_job_rejected";

export interface PulseJobRequest {
  /** Job name to dispatch. Compared case-sensitively against the allowlist. */
  readonly name: string;
  /** Arbitrary JSON-compatible payload; handlers validate their own shape. */
  readonly payload?: unknown;
}

export type PulseJobNotImplementedResult = {
  status: "not_implemented";
  job: PulseJobName;
};

export type PulseJobHandlerErrorResult = {
  status: "handler_error";
  job: PulseJobName;
  message: string;
};

export type PulseJobExecutionResult =
  | PulseJobNotImplementedResult
  | PulseJobHandlerErrorResult;

export type PulseJobDispatchResult =
  | { accepted: true; result: PulseJobExecutionResult }
  | { accepted: false; reason: PulseJobRejectionReason };

export interface PulseJobHandlerContext {
  readonly job: PulseJobName;
  readonly payload: Record<string, unknown>;
}

export type PulseJobHandler = (
  context: PulseJobHandlerContext,
) => Promise<PulseJobExecutionResult>;

function notImplementedHandler(job: PulseJobName): PulseJobHandler {
  return async () => ({ status: "not_implemented", job });
}

/**
 * Handler registry, one entry per PulseRank job name. Every handler is a typed
 * stub until its pipeline agent lands the real implementation; the dispatch
 * contract (fail-closed, never throws) does not change when they do.
 */
export const pulseJobHandlers: Readonly<
  Record<PulseJobName, PulseJobHandler>
> = Object.freeze({
  "pulse.collect.sample": notImplementedHandler("pulse.collect.sample"),
  "pulse.collect.discovery": notImplementedHandler("pulse.collect.discovery"),
  "pulse.collect.refresh-batch": notImplementedHandler(
    "pulse.collect.refresh-batch",
  ),
  "pulse.ingest.run": notImplementedHandler("pulse.ingest.run"),
  "pulse.validate.run": notImplementedHandler("pulse.validate.run"),
  "pulse.promote.snapshot": notImplementedHandler("pulse.promote.snapshot"),
  "pulse.detect.changes": notImplementedHandler("pulse.detect.changes"),
  "pulse.rebuild.leaderboards": notImplementedHandler(
    "pulse.rebuild.leaderboards",
  ),
  "pulse.retention": notImplementedHandler("pulse.retention"),
  "pulse.incident.open": notImplementedHandler("pulse.incident.open"),
  "pulse.heal.preview": notImplementedHandler("pulse.heal.preview"),
  "pulse.heal.verify": notImplementedHandler("pulse.heal.verify"),
});

/** True only for an exact, case-sensitive PulseRank job name. */
export function isPulseJobName(name: unknown): name is PulseJobName {
  return (
    typeof name === "string" &&
    (PULSE_JOB_NAMES as readonly string[]).includes(name)
  );
}

/** True only for an exact legacy denylisted job name. */
export function isLegacyDeniedJobName(name: unknown): name is LegacyJobName {
  return (
    typeof name === "string" &&
    (LEGACY_JOB_DENYLIST as readonly string[]).includes(name)
  );
}

/**
 * Fail-closed dispatch. Accepts only exact `pulse.*` names from
 * `PULSE_JOB_NAMES`; every other name — legacy denylisted, unknown, or
 * malformed — returns `{ accepted: false }` without executing anything.
 *
 * This function never throws: handler failures are converted into a structured
 * `handler_error` execution result so a broken handler can never take down the
 * worker loop through the dispatch boundary.
 */
export async function dispatch(job: PulseJobRequest): Promise<PulseJobDispatchResult> {
  // Fail closed on malformed requests before any registry lookup.
  if (!isPulseJobName(job?.name)) {
    return { accepted: false, reason: "legacy_or_unknown_job_rejected" };
  }

  const payload =
    job.payload !== null && typeof job.payload === "object"
      ? (job.payload as Record<string, unknown>)
      : {};

  try {
    const handler = pulseJobHandlers[job.name];
    const result = await handler({ job: job.name, payload });
    return { accepted: true, result };
  } catch (error) {
    return {
      accepted: true,
      result: {
        status: "handler_error",
        job: job.name,
        message: error instanceof Error ? error.message : "Unknown handler failure",
      },
    };
  }
}
