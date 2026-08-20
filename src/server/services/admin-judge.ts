import {
  BRIGHT_DATA_JUDGE_COLLECTOR_ID,
  BRIGHT_DATA_JUDGE_CONTRACT_VERSION,
  BRIGHT_DATA_JUDGE_SOURCE_URL,
  buildJudgeTimeline,
  compareJudgeTimelineInputs,
  getJudgeFunctionInventory,
  hashJudgeEvidence,
  redactJudgeEvidence,
  type JudgeTimelineInput,
  type JudgeTimeline,
} from "@/domain/judge/model";
import { incidentStates, type IncidentState } from "@/domain/incidents/machine";
const ADMIN_REALTIME_FEED_TYPES = [
  "trip_updates",
  "vehicles",
  "alerts",
] as const;
const ADMIN_SOURCE_DEFINITIONS = [
  {
    key: "elevators",
    label: "Elevator observations",
    sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
  },
  {
    key: "accessibility_advisories",
    label: "Accessibility advisories",
    sourceUrl: "https://www.sfmta.com/travel-transit-updates",
  },
  {
    key: "stop_relocations",
    label: "Stop relocations",
    sourceUrl:
      "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  },
  {
    key: "stop_accessibility",
    label: "Accessible-stop guidance",
    sourceUrl:
      "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
  },
] as const;

const SYNTHETIC_TIMELINE_BASE = "2026-08-20T12:00:00.000Z";
const SAFE_SOURCE_URL = /^https:\/\/(?:www\.sfmta\.com|511\.org)\//u;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const EVENT_SUMMARIES: Record<string, string> = {
  "incident.detected": "A rejected source result opened a protected incident.",
  "incident.reobserved":
    "The same protected source condition was observed again.",
  "incident.worker_abandoned":
    "An incident worker stopped; the protected state remains unchanged.",
  "incident.acknowledged": "An operator acknowledged the protected incident.",
  "healing.requested":
    "A bounded healing preview was requested for the existing collector.",
  "healing.preview_received": "A healing preview stopped at the approval gate.",
  "healing.preview_validated":
    "Deterministic preview checks passed; publication remains frozen.",
  "healing.preview_rejected":
    "Deterministic preview checks failed; the proposal remains rejected.",
  "healing.proposal_rejected":
    "The healing proposal was rejected and the production collector stayed unchanged.",
  "llm.review_completed":
    "The structured advisory review completed; it cannot approve the collector.",
  "llm.review_requires_human":
    "The advisory review requires an explicit human decision.",
  "llm.review_unavailable":
    "The advisory review was unavailable; deterministic freeze remains active.",
  "healing.approved": "An authenticated human approved the reviewed proposal.",
  "healing.rejected": "An authenticated human rejected the reviewed proposal.",
  "healing.verification_started":
    "A fresh post-approval verification was requested.",
  "healing.verification_succeeded":
    "A fresh live verification passed and the incident was verified.",
  "healing.verified":
    "A fresh live verification passed and the incident was verified.",
  "healing.verification_failed":
    "Fresh verification failed; the incident remains protected.",
  "healing.failed":
    "The bounded healing operation failed; trusted data remains held.",
  "healing.no_preview_gate": "Healing did not reach the required preview gate.",
  "healing.reconciliation_failed":
    "Healing evidence could not be reconciled safely.",
  "healing.approval_ambiguous":
    "Approval could not be reconciled; fresh verification is required.",
  "healing.reconciliation_recorded":
    "A healing reconciliation result was recorded.",
  "artifact.heal_request.saved":
    "A redacted healing request hash was recorded.",
  "artifact.detection.saved": "A redacted detection artifact was recorded.",
  "healing.proposal_rejection_failed":
    "Proposal rejection could not be reconciled; the collector remains protected.",
  "healing.worker_abandoned":
    "A healing worker stopped; fresh verification remains required.",
};

type SafeStatus = "current" | "older" | "unavailable";
type JudgeSourceRow = {
  key: string;
  label: string;
  kind: "realtime" | "trusted" | "static";
  status: SafeStatus;
  count: number | null;
  checkedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceUrl: string | null;
};

export type JudgeSourceSummary = {
  status: "current" | "partial" | "unavailable";
  rows: readonly JudgeSourceRow[];
};

export type AdminJudgeReaders = {
  readSourceSummary: (at: Date) => Promise<unknown>;
  readIncidentEvidence: () => Promise<unknown>;
};

type SafeIncident = {
  state: IncidentState | null;
  events: readonly JudgeTimelineInput[];
  valid: boolean;
};

export type AdminJudgeEvidence = {
  status: "current" | "partial" | "unavailable";
  synthetic: true;
  sanitized: true;
  collector: {
    name: "SFMTA elevator status trusted collector";
    collectorId: typeof BRIGHT_DATA_JUDGE_COLLECTOR_ID;
    sourceUrl: typeof BRIGHT_DATA_JUDGE_SOURCE_URL;
    identityStable: true;
  };
  functions: ReturnType<typeof getJudgeFunctionInventory>;
  source: JudgeSourceSummary;
  preview: {
    synthetic: true;
    accepted: true;
    contractVersion: typeof BRIGHT_DATA_JUDGE_CONTRACT_VERSION;
    collectorIdStable: true;
    structuralFingerprintStable: true;
    identityDiff: { missing: readonly string[]; added: readonly string[] };
    checks: Readonly<Record<string, true>>;
  };
  advisory: {
    synthetic: true;
    provider: "Fireworks AI";
    model: "accounts/fireworks/models/deepseek-v4-flash-0731";
    reasoningEffort: "high";
    recommendation: "human_review";
    confidence: 86;
    advisoryOnly: true;
  };
  humanGate: {
    approvalRequired: true;
    automaticApproval: false;
    postApprovalVerificationRequired: true;
    actionsAvailable: false;
  };
  syntheticTimeline: JudgeTimeline;
  liveTimeline: JudgeTimeline;
  evidenceHash: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeStatus(value: unknown): SafeStatus {
  return value === "current" || value === "older" ? value : "unavailable";
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function safeDate(value: unknown, at: Date): string | null {
  if (!(value instanceof Date)) return null;
  const date = new Date(value.getTime());
  if (!Number.isFinite(date.getTime()) || date.getTime() > at.getTime())
    return null;
  return date.toISOString();
}

function safeSourceUrl(value: unknown): string | null {
  return typeof value === "string" && SAFE_SOURCE_URL.test(value)
    ? value
    : null;
}

function sourceRow(
  row: Record<string, unknown>,
  at: Date,
  kind: JudgeSourceRow["kind"],
  key: string,
  label: string,
  countKey: "entityCount" | "rowCount" | "activeServiceCount",
  expectedUrl?: string,
): JudgeSourceRow {
  const status = safeStatus(row.status);
  const count = safeCount(row[countKey]);
  const checkedAt = safeDate(row.checkedAt, at);
  const sourceUpdatedProvided =
    Object.hasOwn(row, "sourceUpdatedAt") &&
    row.sourceUpdatedAt !== null &&
    row.sourceUpdatedAt !== undefined;
  const sourceUpdatedAt = sourceUpdatedProvided
    ? safeDate(row.sourceUpdatedAt, at)
    : null;
  const sourceUrl = safeSourceUrl(row.sourceUrl);
  const valid =
    status !== "unavailable" &&
    count !== null &&
    checkedAt !== null &&
    sourceUrl !== null &&
    (!expectedUrl || sourceUrl === expectedUrl) &&
    (!sourceUpdatedProvided ||
      (sourceUpdatedAt !== null &&
        checkedAt !== null &&
        new Date(sourceUpdatedAt).getTime() <= new Date(checkedAt).getTime()));
  return {
    key,
    label,
    kind,
    status: valid ? status : "unavailable",
    count: valid ? count : null,
    checkedAt: valid ? checkedAt : null,
    sourceUpdatedAt: valid ? sourceUpdatedAt : null,
    sourceUrl: valid ? sourceUrl : null,
  };
}

function unavailableSourceRow(
  kind: JudgeSourceRow["kind"],
  key: string,
  label: string,
): JudgeSourceRow {
  return {
    key,
    label,
    kind,
    status: "unavailable",
    count: null,
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl: null,
  };
}

function unavailableSourceSummary(): JudgeSourceSummary {
  return {
    status: "unavailable",
    rows: [
      unavailableSourceRow("static", "static_schedule", "Static schedule"),
      ...ADMIN_REALTIME_FEED_TYPES.map((feedType) =>
        unavailableSourceRow(
          "realtime",
          feedType,
          (
            {
              trip_updates: "Trip updates",
              vehicles: "Vehicle positions",
              alerts: "Service alerts",
            } satisfies Record<
              (typeof ADMIN_REALTIME_FEED_TYPES)[number],
              string
            >
          )[feedType],
        ),
      ),
      ...ADMIN_SOURCE_DEFINITIONS.map((definition) =>
        unavailableSourceRow("trusted", definition.key, definition.label),
      ),
    ],
  };
}

function normalizeSourceSummary(value: unknown, at: Date): JudgeSourceSummary {
  if (!isRecord(value)) return unavailableSourceSummary();
  const rows: JudgeSourceRow[] = [];
  const staticValue = isRecord(value.static) ? value.static : null;
  rows.push(
    staticValue
      ? sourceRow(
          staticValue,
          at,
          "static",
          "static_schedule",
          "Static schedule",
          "activeServiceCount",
          "https://511.org/open-data/transit",
        )
      : unavailableSourceRow("static", "static_schedule", "Static schedule"),
  );

  const realtimeLabels = {
    trip_updates: "Trip updates",
    vehicles: "Vehicle positions",
    alerts: "Service alerts",
  } satisfies Record<(typeof ADMIN_REALTIME_FEED_TYPES)[number], string>;
  const realtime = value.realtime;
  const realtimeRows = Array.isArray(realtime) ? realtime : [];
  const realtimeCollectionMalformed =
    !Array.isArray(realtime) ||
    realtimeRows.some(
      (item) =>
        !isRecord(item) ||
        !(ADMIN_REALTIME_FEED_TYPES as readonly string[]).includes(
          item.feedType as string,
        ),
    );
  for (const feedType of ADMIN_REALTIME_FEED_TYPES) {
    const matches = realtimeRows.filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.feedType === feedType,
    );
    rows.push(
      !realtimeCollectionMalformed && matches.length === 1
        ? sourceRow(
            matches[0]!,
            at,
            "realtime",
            feedType,
            realtimeLabels[feedType],
            "entityCount",
            "https://511.org/open-data/transit",
          )
        : unavailableSourceRow("realtime", feedType, realtimeLabels[feedType]),
    );
  }

  const sourceRows = value.sources;
  const trustedRows = Array.isArray(sourceRows) ? sourceRows : [];
  const trustedCollectionMalformed =
    !Array.isArray(sourceRows) ||
    trustedRows.some(
      (item) =>
        !isRecord(item) ||
        !ADMIN_SOURCE_DEFINITIONS.some(
          (definition) => definition.key === item.key,
        ),
    );
  for (const definition of ADMIN_SOURCE_DEFINITIONS) {
    const matches = trustedRows.filter(
      (item): item is Record<string, unknown> =>
        isRecord(item) && item.key === definition.key,
    );
    rows.push(
      !trustedCollectionMalformed && matches.length === 1
        ? sourceRow(
            matches[0]!,
            at,
            "trusted",
            definition.key,
            definition.label,
            "rowCount",
            definition.sourceUrl,
          )
        : unavailableSourceRow("trusted", definition.key, definition.label),
    );
  }

  const statuses = rows.map((row) => row.status);
  const status = statuses.every((item) => item === "current")
    ? "current"
    : statuses.every((item) => item === "unavailable")
      ? "unavailable"
      : "partial";
  return { status, rows };
}

function safeActor(
  event: Record<string, unknown>,
): JudgeTimelineInput["actor"] {
  if (
    typeof event.eventType === "string" &&
    event.eventType.startsWith("llm.")
  ) {
    return "advisory";
  }
  return event.actorUserId ? "human" : "system";
}

function normalizeIncident(value: unknown, at: Date): SafeIncident {
  if (
    !isRecord(value) ||
    !Array.isArray(value.events) ||
    !isRecord(value.incident)
  )
    return { state: null, events: [], valid: false };
  const state = incidentStates.includes(value.incident.state as IncidentState)
    ? (value.incident.state as IncidentState)
    : null;
  if (!state || value.events.length === 0 || value.events.length > 100)
    return { state, events: [], valid: false };
  const events: JudgeTimelineInput[] = [];
  const ids = new Set<string>();
  for (const candidate of value.events) {
    if (!isRecord(candidate)) return { state, events: [], valid: false };
    const eventType = candidate.eventType;
    const id = candidate.id;
    const toState = candidate.toState;
    const fromState = candidate.fromState;
    const createdAt = candidate.createdAt;
    const validEvent =
      typeof eventType === "string" &&
      Object.hasOwn(EVENT_SUMMARIES, eventType) &&
      typeof id === "string" &&
      UUID.test(id) &&
      !ids.has(id) &&
      incidentStates.includes(toState as IncidentState) &&
      (fromState === null ||
        incidentStates.includes(fromState as IncidentState)) &&
      createdAt instanceof Date &&
      Number.isFinite(createdAt.getTime()) &&
      createdAt.getTime() <= at.getTime();
    if (!validEvent) return { state, events: [], valid: false };
    ids.add(id as string);
    events.push({
      id: id as string,
      eventType: eventType as string,
      createdAt: createdAt as Date,
      fromState: fromState as IncidentState | null,
      toState: toState as IncidentState,
      actor: safeActor(candidate),
      summary: EVENT_SUMMARIES[eventType as string]!,
      evidence: candidate.details,
    });
  }
  const canonicalEvents = [...events].sort(compareJudgeTimelineInputs);
  return { state, events: canonicalEvents, valid: true };
}

function syntheticTimeline(at: Date): JudgeTimeline {
  const fixedBase = new Date(SYNTHETIC_TIMELINE_BASE);
  const timelineAt =
    at instanceof Date && Number.isFinite(at.getTime())
      ? at
      : new Date(fixedBase.getTime() + 7_000);
  const base = new Date(
    Math.min(fixedBase.getTime(), timelineAt.getTime() - 7_000),
  );
  const timestamp = (seconds: number) =>
    new Date(base.getTime() + seconds * 1_000).toISOString();
  return buildJudgeTimeline(
    [
      {
        id: "synthetic-detected",
        eventType: "incident.detected",
        createdAt: timestamp(0),
        fromState: null,
        toState: "detected",
        actor: "system",
        summary: "Synthetic layout-drift evidence is frozen for demonstration.",
      },
      {
        id: "synthetic-acknowledged",
        eventType: "incident.acknowledged",
        createdAt: timestamp(1),
        fromState: "detected",
        toState: "acknowledged",
        actor: "human",
        summary: "A synthetic operator acknowledgement is shown.",
      },
      {
        id: "synthetic-heal",
        eventType: "healing.requested",
        createdAt: timestamp(2),
        fromState: "acknowledged",
        toState: "heal_requested",
        actor: "human",
        summary: "A synthetic bounded healing preview is requested.",
      },
      {
        id: "synthetic-received",
        eventType: "healing.preview_received",
        createdAt: timestamp(3),
        fromState: "heal_requested",
        toState: "preview_received",
        actor: "system",
        summary: "A synthetic preview stops at the approval gate.",
      },
      {
        id: "synthetic-preview",
        eventType: "healing.preview_validated",
        createdAt: timestamp(4),
        fromState: "preview_received",
        toState: "awaiting_review",
        actor: "system",
        summary: "Synthetic deterministic preview checks passed.",
      },
      {
        id: "synthetic-advisory",
        eventType: "llm.review_completed",
        createdAt: timestamp(5),
        fromState: "awaiting_review",
        toState: "awaiting_approval",
        actor: "advisory",
        summary: "Synthetic advisory review remains non-authoritative.",
      },
      {
        id: "synthetic-human-gate",
        eventType: "human.approval_gate_opened",
        createdAt: timestamp(6),
        fromState: "awaiting_approval",
        toState: "awaiting_approval",
        actor: "system",
        summary:
          "Synthetic evidence still requires human approval and fresh verification.",
      },
    ],
    timelineAt,
  );
}

function productionReaders(): AdminJudgeReaders {
  return {
    readSourceSummary: async (at) => {
      const { getAdminCoverage } =
        await import("@/server/services/admin-coverage");
      return getAdminCoverage(at);
    },
    readIncidentEvidence: async () => {
      const [{ parseIncidentFilters, queryIncidents }, { incidentDetail }] =
        await Promise.all([
          import("@/server/services/admin-data"),
          import("@/server/services/incidents"),
        ]);
      const result = await queryIncidents({
        ...parseIncidentFilters({}),
        pageSize: 1,
      });
      const latest = result.rows[0];
      return latest ? incidentDetail(latest.id) : null;
    },
  };
}

function safeRead<T>(reader: () => Promise<T>): Promise<T | null> {
  return reader().catch(() => null);
}

function buildEvidenceHash(value: Omit<AdminJudgeEvidence, "evidenceHash">) {
  return hashJudgeEvidence(value);
}

export function createAdminJudgeService(
  readers: AdminJudgeReaders = productionReaders(),
) {
  return {
    async getEvidence(at = new Date()): Promise<AdminJudgeEvidence> {
      const validAt = at instanceof Date && Number.isFinite(at.getTime());
      let source: JudgeSourceSummary;
      let liveTimeline: JudgeTimeline;
      if (!validAt) {
        source = unavailableSourceSummary();
        liveTimeline = { status: "unavailable", events: [] };
      } else {
        const [rawSource, rawIncident] = await Promise.all([
          safeRead(() => readers.readSourceSummary(at)),
          safeRead(readers.readIncidentEvidence),
        ]);
        source = normalizeSourceSummary(rawSource, at);
        const incident = normalizeIncident(rawIncident, at);
        const builtTimeline: JudgeTimeline = incident.valid
          ? buildJudgeTimeline(incident.events, at)
          : { status: "unavailable", events: [] };
        liveTimeline =
          incident.valid &&
          builtTimeline.status === "current" &&
          builtTimeline.events.at(-1)?.toState === incident.state
            ? builtTimeline
            : { status: "unavailable", events: [] };
      }
      const synthetic = syntheticTimeline(at);
      const status =
        validAt &&
        source.status === "current" &&
        liveTimeline.status === "current"
          ? "current"
          : source.status === "unavailable" &&
              liveTimeline.status === "unavailable"
            ? "unavailable"
            : "partial";
      const evidenceWithoutHash = {
        status,
        synthetic: true as const,
        sanitized: true as const,
        collector: {
          name: "SFMTA elevator status trusted collector",
          collectorId: BRIGHT_DATA_JUDGE_COLLECTOR_ID,
          sourceUrl: BRIGHT_DATA_JUDGE_SOURCE_URL,
          identityStable: true as const,
        },
        functions: getJudgeFunctionInventory(),
        source,
        preview: {
          synthetic: true as const,
          accepted: true as const,
          contractVersion: BRIGHT_DATA_JUDGE_CONTRACT_VERSION,
          collectorIdStable: true as const,
          structuralFingerprintStable: true as const,
          identityDiff: { missing: [] as const, added: [] as const },
          checks: {
            contract: true,
            sourceIdentity: true,
            freshness: true,
            stationCoverage: true,
            uniqueEquipment: true,
            statusValues: true,
            stationConsistency: true,
            stableStructure: true,
          },
        },
        advisory: {
          synthetic: true as const,
          provider: "Fireworks AI" as const,
          model: "accounts/fireworks/models/deepseek-v4-flash-0731" as const,
          reasoningEffort: "high" as const,
          recommendation: "human_review" as const,
          confidence: 86 as const,
          advisoryOnly: true as const,
        },
        humanGate: {
          approvalRequired: true as const,
          automaticApproval: false as const,
          postApprovalVerificationRequired: true as const,
          actionsAvailable: false as const,
        },
        syntheticTimeline: synthetic,
        liveTimeline,
      } satisfies Omit<AdminJudgeEvidence, "evidenceHash">;
      const result = {
        ...evidenceWithoutHash,
        evidenceHash: buildEvidenceHash(evidenceWithoutHash),
      } satisfies AdminJudgeEvidence;
      return redactJudgeEvidence(result) as AdminJudgeEvidence;
    },
  };
}

export async function getAdminJudgeEvidence(at = new Date()) {
  return createAdminJudgeService().getEvidence(at);
}
