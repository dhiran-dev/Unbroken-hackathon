type JsonObject = Record<string, unknown>;

export type LiveRunInput = {
  status: string;
  trigger: string;
  rowCount: number | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  report: JsonObject | null;
};

function record(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (normalized === "" || normalized.length > 120) return null;
  return normalized;
}

const PUBLIC_TRIGGERS = new Set([
  "job:pulse.collect.sample",
  "job:pulse.collect.discovery",
  "job:pulse.heal.verify",
]);

function publicTrigger(value: unknown): string {
  const normalized = text(value);
  return normalized !== null && PUBLIC_TRIGGERS.has(normalized) ? normalized : "unknown";
}

function publicRunStatus(value: unknown): string {
  const normalized = text(value)?.toLowerCase();
  if (!normalized) return "unknown";
  if (normalized.includes("timeout") || normalized.includes("timed_out")) return "timed_out";
  if (["queued", "running", "succeeded", "validated", "failed", "cancelled"].includes(normalized)) {
    return normalized;
  }
  return "unknown";
}

function publicCollectionStage(value: unknown, hasProvider: boolean): string {
  const normalized = text(value)?.toLowerCase();
  if (!hasProvider || !normalized) return "not_applicable";
  if (normalized.includes("timeout") || normalized.includes("timed_out")) return "timed_out";
  if (["failed", "error", "rejected"].includes(normalized)) return "failed";
  if (["ready", "complete", "completed", "succeeded", "validated"].includes(normalized)) {
    return "complete";
  }
  if (["queued", "running", "processing", "pending", "waiting", "submitted", "retrying"].includes(normalized)) {
    return "in_progress";
  }
  return "unknown";
}

export type SanitizedLiveRun = ReturnType<typeof sanitizeLiveRun>;

/**
 * Explicit allowlist for public operational history. Provider collection IDs,
 * raw records, findings prose, credentials, and arbitrary report keys stay
 * private even if a future writer adds them to the run report.
 */
export function sanitizeLiveRun(input: LiveRunInput) {
  const provider = record(input.report?.provider);
  const landing = record(input.report?.landing);
  const ingestion = record(input.report?.ingestion);
  const validation = record(input.report?.validation);
  const promotion = record(input.report?.promotion);
  const leaderboard = record(input.report?.leaderboard);
  const providerStatus = text(provider?.status);

  return {
    status: publicRunStatus(input.status),
    trigger: publicTrigger(input.trigger),
    startedAt: input.startedAt?.toISOString() ?? null,
    finishedAt: input.finishedAt?.toISOString() ?? null,
    createdAt: input.createdAt.toISOString(),
    stages: {
      submit: provider ? "complete" : "not_applicable",
      collect: publicCollectionStage(providerStatus, provider !== null),
      land: landing ? "complete" : "pending",
      ingest: ingestion ? "complete" : "pending",
      validate:
        validation?.ok === true
          ? "passed"
          : validation?.ok === false
            ? "failed"
            : "pending",
      promote: promotion ? "complete" : "pending",
      rebuild: leaderboard ? "complete" : "pending",
    },
    rowCounts: {
      collected: integer(input.rowCount),
      input: integer(landing?.inputRows),
      stored: integer(landing?.storedRows),
      parsed: integer(ingestion?.parsedRowCount),
      promoted: integer(promotion?.promoted),
      warnings:
        integer(landing?.collectorErrorWarnings) ??
        integer(ingestion?.collectorErrorRecords),
    },
  };
}
