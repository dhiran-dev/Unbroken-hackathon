export const runStatusValues = [
  "queued",
  "collecting",
  "validating",
  "accepted",
  "rejected",
  "failed",
] as const;

export type RunStatusValue = (typeof runStatusValues)[number];

export const runStatusLabels: Record<RunStatusValue, string> = {
  queued: "Queued",
  collecting: "Collecting source data",
  validating: "Checking source data",
  accepted: "Trusted",
  rejected: "Not published",
  failed: "Collection failed",
};

export const runClassificationValues = [
  "healthy_no_change",
  "semantic_service_change",
  "probable_layout_drift",
  "source_unavailable",
  "source_stale",
  "ambiguous_contract_failure",
] as const;

export type RunClassificationValue = (typeof runClassificationValues)[number];

export const runClassificationLabels: Record<RunClassificationValue, string> = {
  healthy_no_change: "No changes detected",
  semantic_service_change: "Service status changed",
  probable_layout_drift: "Source layout changed",
  source_unavailable: "Source unavailable",
  source_stale: "Source update too old",
  ambiguous_contract_failure: "Data checks failed",
};

export const incidentStateValues = [
  "detected",
  "acknowledged",
  "heal_requested",
  "preview_received",
  "preview_rejected",
  "awaiting_review",
  "awaiting_approval",
  "approved",
  "rejected",
  "verified",
  "verification_failed",
] as const;

export type IncidentStateValue = (typeof incidentStateValues)[number];

export const incidentStateLabels: Record<IncidentStateValue, string> = {
  detected: "Detected",
  acknowledged: "Acknowledged",
  heal_requested: "Repair requested",
  preview_received: "Repair preview received",
  preview_rejected: "Repair preview rejected",
  awaiting_review: "Awaiting advisory review",
  awaiting_approval: "Awaiting human approval",
  approved: "Repair approved",
  rejected: "Repair rejected",
  verified: "Recovered",
  verification_failed: "Recovery check failed",
};

export const componentStatusValues = [
  "operational",
  "degraded",
  "outage",
  "unknown",
] as const;

export type ComponentStatusValue = (typeof componentStatusValues)[number];

export const componentStatusLabels: Record<ComponentStatusValue, string> = {
  operational: "Operational",
  degraded: "Degraded",
  outage: "Outage",
  unknown: "Not checked",
};

export const equipmentStatusLabels: Record<string, string> = {
  in_service: "Working",
  out_of_service: "Out of service",
  unknown: "Status not confirmed",
};

export const stationStatusLabels: Record<string, string> = {
  accessible: "Reported accessible",
  limited: "Reported with changes",
  unavailable: "Reported unavailable",
  unknown: "Status not confirmed",
};

export const triggerLabels: Record<string, string> = {
  scheduled: "Scheduled check",
  manual: "Operator requested",
  manual_cli: "CLI requested",
  retry: "Retry",
};

export const actionLabels: Record<string, string> = {
  "collection.run_now": "Run collection now",
  "incident.acknowledge": "Acknowledge incident",
  "incident.heal": "Request safe repair",
  "incident.review": "Request advisory review",
  "incident.approve": "Approve repair",
  "incident.reject": "Reject repair",
  "incident.verify": "Verify recovery",
};

export const checkLabels: Record<string, string> = {
  outer_shape: "Source response shape",
  source_url: "Official source URL",
  source_valid_at: "Source timestamp",
  freshness: "Source freshness",
  station_coverage: "Station coverage",
  row_count: "Elevator row count",
  identity_unique: "Unique elevator identities",
  allowed_values: "Allowed status values",
  critical_fields: "Required fields",
  station_consistency: "Station accessibility consistency",
  structural_fingerprint: "Source structure",
};

export function humanizeOperatorValue(value: string | null | undefined) {
  if (!value) return "Not available";
  return value
    .replaceAll(".", " ")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export function runStatusLabel(value: string | null | undefined) {
  return value && value in runStatusLabels
    ? runStatusLabels[value as RunStatusValue]
    : humanizeOperatorValue(value);
}

export function runClassificationLabel(value: string | null | undefined) {
  return value && value in runClassificationLabels
    ? runClassificationLabels[value as RunClassificationValue]
    : humanizeOperatorValue(value);
}

export function incidentStateLabel(value: string | null | undefined) {
  return value && value in incidentStateLabels
    ? incidentStateLabels[value as IncidentStateValue]
    : humanizeOperatorValue(value);
}

export function componentStatusLabel(value: string | null | undefined) {
  return value && value in componentStatusLabels
    ? componentStatusLabels[value as ComponentStatusValue]
    : humanizeOperatorValue(value);
}

export function equipmentStatusLabel(value: string | null | undefined) {
  return value ? equipmentStatusLabels[value] ?? humanizeOperatorValue(value) : "Status not confirmed";
}

export function stationStatusLabel(value: string | null | undefined) {
  return value ? stationStatusLabels[value] ?? humanizeOperatorValue(value) : "Status not confirmed";
}

export function triggerLabel(value: string | null | undefined) {
  return value ? triggerLabels[value] ?? humanizeOperatorValue(value) : "Not available";
}

export function actionLabel(value: string | null | undefined) {
  return value ? actionLabels[value] ?? humanizeOperatorValue(value) : "Unknown action";
}

export function checkLabel(value: string | null | undefined) {
  return value ? checkLabels[value] ?? humanizeOperatorValue(value) : "Data check";
}

export function eventLabel(value: string | null | undefined) {
  return humanizeOperatorValue(value).replace(/^Artifact /, "Evidence ");
}

export function statusTone(value: string | null | undefined) {
  if (["accepted", "verified", "operational", "in_service"].includes(value ?? "")) {
    return "success" as const;
  }
  if (["failed", "outage", "rejected", "preview_rejected", "out_of_service"].includes(value ?? "")) {
    return "danger" as const;
  }
  if (["degraded", "queued", "collecting", "validating", "detected", "acknowledged", "heal_requested", "preview_received", "awaiting_review", "awaiting_approval", "approved", "verification_failed", "unknown"].includes(value ?? "")) {
    return "warning" as const;
  }
  return "neutral" as const;
}

export function safeEvidenceEntries(details: Record<string, unknown>) {
  const blocked = /(prompt|token|secret|password|authorization|body|payload|envelope|preview_result)/i;
  return Object.entries(details).filter(([key, value]) => {
    if (blocked.test(key)) return false;
    return ["string", "number", "boolean"].includes(typeof value) || value === null;
  });
}
