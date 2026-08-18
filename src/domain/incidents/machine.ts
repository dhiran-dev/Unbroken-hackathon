import type { IncidentAction } from "./contract";

export const incidentStates = [
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

export type IncidentState = (typeof incidentStates)[number];

const transitions: Record<IncidentState, readonly IncidentState[]> = {
  detected: ["acknowledged"],
  acknowledged: ["heal_requested"],
  heal_requested: ["acknowledged", "preview_received", "preview_rejected"],
  preview_received: ["preview_rejected", "awaiting_review"],
  preview_rejected: ["heal_requested", "rejected"],
  awaiting_review: ["awaiting_approval", "approved", "rejected"],
  awaiting_approval: ["approved", "rejected"],
  approved: ["verified", "verification_failed"],
  rejected: ["heal_requested"],
  verified: [],
  verification_failed: ["heal_requested", "approved", "verified"],
};

export function canTransition(from: IncidentState, to: IncidentState) {
  return transitions[from].includes(to);
}

export function assertTransition(from: IncidentState, to: IncidentState) {
  if (!canTransition(from, to)) {
    throw new IncidentStateError(
      `Incident cannot transition from ${from} to ${to}.`,
    );
  }
}

export class IncidentStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IncidentStateError";
  }
}

export function actionAllowed(state: IncidentState, action: IncidentAction) {
  if (action === "acknowledge") return state === "detected";
  if (action === "heal") {
    return ["acknowledged", "preview_rejected", "rejected", "verification_failed"].includes(state);
  }
  if (action === "review") return state === "awaiting_review";
  if (action === "approve") {
    return ["awaiting_review", "awaiting_approval"].includes(state);
  }
  if (action === "reject") {
    return ["preview_rejected", "awaiting_review", "awaiting_approval"].includes(state);
  }
  if (action === "verify") return ["approved", "verification_failed"].includes(state);
  return false;
}

export function assertActionAllowed(state: IncidentState, action: IncidentAction) {
  if (!actionAllowed(state, action)) {
    throw new IncidentStateError(
      `Action ${action} is not available while the incident is ${state}.`,
    );
  }
}
