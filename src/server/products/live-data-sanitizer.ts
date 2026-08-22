type JsonObject = Record<string, unknown>;

export type LiveRunInput = {
  id: string;
  status: string;
  trigger: string;
  rowCount: number | null;
  errorCode: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
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
  return typeof value === "string" && value.trim() !== "" ? value : null;
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
    runId: input.id,
    status: input.status,
    trigger: input.trigger,
    startedAt: input.startedAt?.toISOString() ?? null,
    finishedAt: input.finishedAt?.toISOString() ?? null,
    errorCode: input.errorCode,
    provider: provider
      ? {
          kind: text(provider.kind),
          status: providerStatus,
          attempts: integer(provider.attempts) ?? 0,
          submittedAt: text(provider.submittedAt),
          lastPollAt: text(provider.lastPollAt),
          hasCollectionId:
            typeof provider.collectionId === "string" &&
            provider.collectionId.length > 0,
          resumable:
            providerStatus === "timed_out" ||
            providerStatus === "failed" ||
            input.status === "provider_wait_timeout",
        }
      : null,
    stages: {
      submit: provider ? "complete" : "not_applicable",
      provider: providerStatus ?? "not_applicable",
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
      collected: input.rowCount,
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
