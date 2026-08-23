/** Client-safe incident action vocabulary. Keep this module free of Node APIs. */
export const INCIDENT_ACTIONS = [
  "acknowledge",
  "heal",
  "review",
  "approve",
  "reject",
  "verify",
] as const;

export type IncidentAction = (typeof INCIDENT_ACTIONS)[number];

export const APPROVAL_CONFIRMATION = "APPROVE HEALED COLLECTOR";
export const REJECTION_CONFIRMATION = "REJECT HEALED COLLECTOR";
