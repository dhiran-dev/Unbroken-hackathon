import { sha256Json } from "@/domain/collection/identity";
import {
  actionAllowed,
  canTransition,
  incidentStates,
  type IncidentState,
} from "@/domain/incidents/machine";

export const BRIGHT_DATA_JUDGE_COLLECTOR_ID = "c_msyjsllt1r9ej5tdub" as const;
export const BRIGHT_DATA_JUDGE_SOURCE_URL =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod" as const;
export const BRIGHT_DATA_JUDGE_CONTRACT_VERSION = "sfmta-elevator-v1" as const;

export type JudgeFunctionKind = "advisory" | "interception" | "extractor";

export type JudgeFunctionEvidence = {
  readonly key:
    | "navigate"
    | "wait"
    | "parse"
    | "relocation_on_response_json"
    | "accessible_stop_extraction";
  readonly label: string;
  readonly kind: JudgeFunctionKind;
  readonly description: string;
  readonly output: string;
  readonly safety: string;
};

const JUDGE_FUNCTION_INVENTORY: readonly JudgeFunctionEvidence[] = [
  {
    key: "navigate",
    label: "Advisory navigate",
    kind: "advisory",
    description: "Open the pinned SFMTA source page for inspection only.",
    output: "Source identity is checked before any interpretation.",
    safety: "Does not publish or mutate collector state.",
  },
  {
    key: "wait",
    label: "Advisory wait",
    kind: "advisory",
    description:
      "Wait for the source response within a bounded observation window.",
    output: "Timeout remains unavailable evidence.",
    safety: "Never turns a missing response into an in-service result.",
  },
  {
    key: "parse",
    label: "Structured parser",
    kind: "advisory",
    description:
      "Read the fixed contract fields without displaying source rows.",
    output: "Contract checks and a structural fingerprint are presented.",
    safety: "Unknown equipment status remains unknown.",
  },
  {
    key: "relocation_on_response_json",
    label: "Relocation on_response JSON interception",
    kind: "interception",
    description:
      "Observe the allowlisted relocation JSON response for source-summary review.",
    output: "A sanitized relocation summary or unavailable state.",
    safety: "Raw response bodies and private request details are never shown.",
  },
  {
    key: "accessible_stop_extraction",
    label: "Deterministic accessible-stop extraction",
    kind: "extractor",
    description:
      "Extract reviewed accessible-stop guidance through its fixed source contract.",
    output:
      "A count and checked time only when the trusted source summary is valid.",
    safety: "Missing or stale guidance remains unavailable.",
  },
] as const;

export function getJudgeFunctionInventory(): readonly JudgeFunctionEvidence[] {
  return JUDGE_FUNCTION_INVENTORY.map((item) => ({ ...item }));
}

const SENSITIVE_KEY =
  /authorization|api[_-]?key|access[_-]?token|secret|password|credential|raw|payload|artifact|private.*path|file.*path|(?:^|[_-])path$/iu;
const URL_KEY = /url|uri|href/iu;
const SENSITIVE_STRING =
  /bearer\s+\S+|(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*\S+|\/data\/incidents(?:\/|$)|incident_artifacts_dir/iu;
const SAFE_OFFICIAL_URL = /^https:\/\/(?:www\.sfmta\.com|511\.org)\//u;

function safeString(value: string, key?: string) {
  if (SENSITIVE_STRING.test(value)) return "[REDACTED]";
  if (key && URL_KEY.test(key)) {
    if (key === "sourceUrl" && SAFE_OFFICIAL_URL.test(value)) return value;
    return "[REDACTED]";
  }
  return value.slice(0, 500);
}

function redact(
  value: unknown,
  key?: string,
  depth = 0,
  seen = new WeakSet<object>(),
): unknown {
  if (depth > 8) return "[REDACTED]";
  if (key && SENSITIVE_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return safeString(value, key);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (value.length > 100) return "[REDACTED]";
    return value.map((item) => redact(item, undefined, depth + 1, seen));
  }
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[REDACTED]";
    seen.add(value);
    const entries = Object.entries(value).slice(0, 100);
    const result = Object.fromEntries(
      entries.map(([entryKey, entryValue]) => [
        entryKey.slice(0, 120),
        redact(entryValue, entryKey, depth + 1, seen),
      ]),
    );
    seen.delete(value);
    return result;
  }
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }
  return value === undefined ? null : "[REDACTED]";
}

export function redactJudgeEvidence(value: unknown): unknown {
  return redact(value);
}

export function hashJudgeEvidence(value: unknown): string {
  return sha256Json(redactJudgeEvidence(value));
}

export type JudgeWorkflowState = IncidentState;

export type JudgeAction =
  | "acknowledge"
  | "request_healing"
  | "preview_received"
  | "validate_preview"
  | "reject_preview"
  | "request_review"
  | "approve"
  | "reject"
  | "verify"
  | "verification_failed";

function targetState(action: string): JudgeWorkflowState | null {
  switch (action) {
    case "acknowledge":
      return "acknowledged";
    case "request_healing":
      return "heal_requested";
    case "preview_received":
      return "preview_received";
    case "validate_preview":
    case "request_review":
      return "awaiting_review";
    case "reject_preview":
      return "preview_rejected";
    case "approve":
      return "approved";
    case "reject":
      return "rejected";
    case "verify":
      return "verified";
    case "verification_failed":
      return "verification_failed";
    default:
      return null;
  }
}

function existingIncidentAction(action: string) {
  if (action === "request_healing") return "heal" as const;
  if (action === "request_review") return "review" as const;
  if (
    action === "acknowledge" ||
    action === "approve" ||
    action === "reject" ||
    action === "verify"
  ) {
    return action;
  }
  return null;
}

export function transitionJudgeState(
  from: JudgeWorkflowState,
  action: string,
): JudgeWorkflowState {
  if (!incidentStates.includes(from)) {
    throw new Error(`Unknown judge state: ${from}.`);
  }
  const to = targetState(action);
  if (!to) throw new Error(`Unknown judge action: ${action}.`);
  const incidentAction = existingIncidentAction(action);
  if (incidentAction && !actionAllowed(from, incidentAction)) {
    throw new Error(`Judge action ${action} cannot transition from ${from}.`);
  }
  if (!canTransition(from, to)) {
    throw new Error(`Judge state cannot transition from ${from} to ${to}.`);
  }
  return to;
}

export type JudgeTimelineInput = {
  readonly id: string;
  readonly eventType: string;
  readonly createdAt: Date | string;
  readonly fromState: JudgeWorkflowState | null;
  readonly toState: JudgeWorkflowState;
  readonly actor: "system" | "advisory" | "human";
  readonly summary: string;
  readonly evidence?: unknown;
};

export type JudgeTimelineEvent = {
  readonly id: string;
  readonly eventType: string;
  readonly createdAt: string;
  readonly fromState: JudgeWorkflowState | null;
  readonly toState: JudgeWorkflowState;
  readonly actor: "system" | "advisory" | "human";
  readonly summary: string;
  readonly evidenceHash: string;
};

export type JudgeTimeline = {
  readonly status: "current" | "unavailable";
  readonly events: readonly JudgeTimelineEvent[];
};

const JUDGE_EVENT_TYPES = new Set([
  "incident.detected",
  "incident.reobserved",
  "incident.worker_abandoned",
  "incident.acknowledged",
  "healing.requested",
  "healing.preview_received",
  "healing.preview_validated",
  "healing.preview_rejected",
  "healing.proposal_rejected",
  "healing.proposal_rejection_failed",
  "healing.worker_abandoned",
  "llm.review_completed",
  "llm.review_requires_human",
  "llm.review_unavailable",
  "healing.approved",
  "healing.rejected",
  "healing.verification_started",
  "healing.verification_succeeded",
  "healing.verified",
  "healing.verification_failed",
  "healing.failed",
  "healing.no_preview_gate",
  "healing.reconciliation_failed",
  "healing.approval_ambiguous",
  "healing.reconciliation_recorded",
  "artifact.heal_request.saved",
  "artifact.detection.saved",
  "human.approved",
  "human.approval_gate_opened",
]);

type JudgeStateTransition = readonly [IncidentState | null, IncidentState];

const STATE_CHANGING_EVENT_TRANSITIONS: Readonly<
  Record<string, readonly JudgeStateTransition[]>
> = {
  "incident.detected": [[null, "detected"]],
  "incident.acknowledged": [["detected", "acknowledged"]],
  "healing.requested": [
    ["acknowledged", "heal_requested"],
    ["preview_rejected", "heal_requested"],
    ["rejected", "heal_requested"],
    ["verification_failed", "heal_requested"],
  ],
  "healing.preview_received": [["heal_requested", "preview_received"]],
  "healing.preview_validated": [["preview_received", "awaiting_review"]],
  "healing.preview_rejected": [["preview_received", "preview_rejected"]],
  "healing.failed": [["heal_requested", "acknowledged"]],
  "healing.no_preview_gate": [["heal_requested", "acknowledged"]],
  "healing.reconciliation_failed": [["preview_received", "preview_rejected"]],
  "healing.approval_ambiguous": [
    ["awaiting_review", "verification_failed"],
    ["awaiting_approval", "verification_failed"],
  ],
  "llm.review_completed": [["awaiting_review", "awaiting_approval"]],
  "healing.approved": [
    ["awaiting_review", "approved"],
    ["awaiting_approval", "approved"],
  ],
  "human.approved": [
    ["awaiting_review", "approved"],
    ["awaiting_approval", "approved"],
  ],
  "healing.rejected": [
    ["preview_rejected", "rejected"],
    ["awaiting_review", "rejected"],
    ["awaiting_approval", "rejected"],
  ],
  "healing.verification_failed": [
    ["awaiting_review", "verification_failed"],
    ["awaiting_approval", "verification_failed"],
    ["approved", "verification_failed"],
  ],
  "healing.verification_succeeded": [
    ["approved", "verified"],
    ["verification_failed", "verified"],
  ],
  "healing.verified": [
    ["approved", "verified"],
    ["verification_failed", "verified"],
  ],
  "healing.worker_abandoned": [
    ["heal_requested", "acknowledged"],
    ["awaiting_review", "verification_failed"],
    ["awaiting_approval", "verification_failed"],
    ["approved", "verification_failed"],
  ],
};

const SELF_STATE_EVENT_STATES: Readonly<
  Record<string, readonly IncidentState[]>
> = {
  "incident.reobserved": incidentStates,
  "incident.worker_abandoned": incidentStates,
  "artifact.heal_request.saved": ["heal_requested"],
  "artifact.detection.saved": ["detected"],
  "healing.proposal_rejected": ["preview_rejected"],
  "healing.proposal_rejection_failed": ["preview_rejected"],
  "llm.review_requires_human": ["awaiting_review"],
  "llm.review_unavailable": ["awaiting_review"],
  "healing.reconciliation_recorded": incidentStates,
  "healing.verification_started": ["approved", "verification_failed"],
  "human.approval_gate_opened": ["awaiting_approval"],
};

function eventSemanticsValid(event: JudgeTimelineInput) {
  const expected = STATE_CHANGING_EVENT_TRANSITIONS[event.eventType];
  if (expected) {
    return expected.some(
      ([fromState, toState]) =>
        event.fromState === fromState && event.toState === toState,
    );
  }
  return (
    event.fromState !== null &&
    event.fromState === event.toState &&
    SELF_STATE_EVENT_STATES[event.eventType]?.includes(event.fromState) === true
  );
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,120}$/u;
const SAFE_EVENT_TYPE = /^[a-z][a-z0-9_.-]{1,100}$/u;
const SAFE_SUMMARY = /^[^\u0000-\u001f\u007f]{1,500}$/u;

function parseTimelineDate(value: Date | string) {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function compareJudgeTimelineInputs(
  left: JudgeTimelineInput,
  right: JudgeTimelineInput,
) {
  const leftDate =
    parseTimelineDate(left.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  const rightDate =
    parseTimelineDate(right.createdAt)?.getTime() ?? Number.POSITIVE_INFINITY;
  if (leftDate !== rightDate) return leftDate < rightDate ? -1 : 1;
  return String(left.id).localeCompare(String(right.id));
}

export function buildJudgeTimeline(
  input: readonly JudgeTimelineInput[],
  at = new Date(),
): JudgeTimeline {
  if (
    input.length === 0 ||
    input.length > 100 ||
    !(at instanceof Date) ||
    !Number.isFinite(at.getTime())
  ) {
    return { status: "unavailable", events: [] };
  }
  const sorted = [...input].sort(compareJudgeTimelineInputs);
  const seenIds = new Set<string>();
  const events: JudgeTimelineEvent[] = [];
  let currentState: JudgeWorkflowState | null = null;
  for (let index = 0; index < sorted.length; index += 1) {
    const event = sorted[index]!;
    const createdAt = parseTimelineDate(event.createdAt);
    const validFromState =
      event.fromState === null || incidentStates.includes(event.fromState);
    const validToState = incidentStates.includes(event.toState);
    if (
      !createdAt ||
      createdAt.getTime() > at.getTime() ||
      !SAFE_ID.test(event.id) ||
      seenIds.has(event.id) ||
      !SAFE_EVENT_TYPE.test(event.eventType) ||
      !JUDGE_EVENT_TYPES.has(event.eventType) ||
      !SAFE_SUMMARY.test(event.summary) ||
      !["system", "advisory", "human"].includes(event.actor) ||
      !validFromState ||
      !validToState
    ) {
      return { status: "unavailable", events: [] };
    }
    seenIds.add(event.id);
    if (index === 0) {
      if (event.fromState !== null || event.toState !== "detected") {
        return { status: "unavailable", events: [] };
      }
    } else {
      if (
        event.fromState === null ||
        currentState === null ||
        event.fromState !== currentState
      ) {
        return { status: "unavailable", events: [] };
      }
      if (
        event.fromState !== event.toState &&
        !canTransition(event.fromState, event.toState)
      ) {
        return { status: "unavailable", events: [] };
      }
    }
    if (!eventSemanticsValid(event)) {
      return { status: "unavailable", events: [] };
    }
    const summary = redactJudgeEvidence(event.summary);
    events.push({
      id: event.id,
      eventType: event.eventType,
      createdAt: createdAt.toISOString(),
      fromState: event.fromState,
      toState: event.toState,
      actor: event.actor,
      summary: typeof summary === "string" ? summary : "[REDACTED]",
      evidenceHash: hashJudgeEvidence({
        eventType: event.eventType,
        fromState: event.fromState,
        toState: event.toState,
        summary: event.summary,
        evidence: event.evidence,
      }),
    });
    currentState = event.toState;
  }
  return { status: "current", events };
}
