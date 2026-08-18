import { and, desc, eq, inArray } from "drizzle-orm";

import {
  assertActionAllowed,
  assertTransition,
  type IncidentState,
} from "@/domain/incidents/machine";
import type { IncidentAction } from "@/domain/incidents/contract";
import { db } from "@/server/db/client";
import {
  collectionRuns,
  incidentEvents,
  incidents,
  llmReviews,
} from "@/server/db/schema";

const TERMINAL_STATES: IncidentState[] = ["rejected", "verified"];

export class IncidentNotFoundError extends Error {
  constructor() {
    super("Incident was not found.");
    this.name = "IncidentNotFoundError";
  }
}

export async function getIncident(incidentId: string) {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(eq(incidents.id, incidentId))
    .limit(1);
  if (!incident) throw new IncidentNotFoundError();
  return incident;
}

export async function requireIncidentAction(
  incidentId: string,
  action: IncidentAction,
) {
  const incident = await getIncident(incidentId);
  assertActionAllowed(incident.state, action);
  return incident;
}

export async function transitionIncident(input: {
  incidentId: string;
  toState: IncidentState;
  eventType: string;
  actorUserId?: string | null;
  details: Record<string, unknown>;
}) {
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select()
      .from(incidents)
      .where(eq(incidents.id, input.incidentId))
      .limit(1);
    if (!current) throw new IncidentNotFoundError();

    assertTransition(current.state, input.toState);
    const now = new Date();
    const [updated] = await transaction
      .update(incidents)
      .set({
        state: input.toState,
        acknowledgedAt:
          input.toState === "acknowledged"
            ? now
            : current.acknowledgedAt,
        resolvedAt:
          input.toState === "verified" || input.toState === "rejected"
            ? now
            : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(incidents.id, input.incidentId),
          eq(incidents.state, current.state),
        ),
      )
      .returning();

    if (!updated) {
      throw new Error("Incident changed while the action was being applied.");
    }

    await transaction.insert(incidentEvents).values({
      incidentId: input.incidentId,
      eventType: input.eventType,
      fromState: current.state,
      toState: input.toState,
      actorUserId: input.actorUserId ?? null,
      details: input.details,
    });

    return updated;
  });
}

export async function recordIncidentEvidence(input: {
  incidentId: string;
  eventType: string;
  actorUserId?: string | null;
  details: Record<string, unknown>;
}) {
  const incident = await getIncident(input.incidentId);
  await db.insert(incidentEvents).values({
    incidentId: incident.id,
    eventType: input.eventType,
    fromState: incident.state,
    toState: incident.state,
    actorUserId: input.actorUserId ?? null,
    details: input.details,
  });
}

export async function acknowledgeIncident(
  incidentId: string,
  actorUserId: string,
) {
  await requireIncidentAction(incidentId, "acknowledge");
  return transitionIncident({
    incidentId,
    toState: "acknowledged",
    eventType: "incident.acknowledged",
    actorUserId,
    details: { acknowledgedByHuman: true },
  });
}

export async function latestIncidentEvidence(
  incidentId: string,
  eventType: string,
) {
  const [event] = await db
    .select()
    .from(incidentEvents)
    .where(
      and(
        eq(incidentEvents.incidentId, incidentId),
        eq(incidentEvents.eventType, eventType),
      ),
    )
    .orderBy(desc(incidentEvents.createdAt))
    .limit(1);
  return event ?? null;
}

export async function incidentDetail(incidentId: string) {
  const incident = await getIncident(incidentId);
  const [events, reviews, [run]] = await Promise.all([
    db
      .select()
      .from(incidentEvents)
      .where(eq(incidentEvents.incidentId, incidentId))
      .orderBy(desc(incidentEvents.createdAt)),
    db
      .select()
      .from(llmReviews)
      .where(eq(llmReviews.incidentId, incidentId))
      .orderBy(desc(llmReviews.createdAt)),
    incident.collectionRunId
      ? db
          .select()
          .from(collectionRuns)
          .where(eq(collectionRuns.id, incident.collectionRunId))
          .limit(1)
      : Promise.resolve([]),
  ]);
  return { incident, events, reviews, run: run ?? null };
}

export function activeIncidentStates() {
  return [
    "detected",
    "acknowledged",
    "heal_requested",
    "preview_received",
    "preview_rejected",
    "awaiting_review",
    "awaiting_approval",
    "approved",
    "verification_failed",
  ] as const;
}

export async function findActiveIncidentByFingerprint(fingerprint: string) {
  const [incident] = await db
    .select()
    .from(incidents)
    .where(
      and(
        eq(incidents.fingerprint, fingerprint),
        inArray(incidents.state, activeIncidentStates()),
      ),
    )
    .orderBy(desc(incidents.detectedAt))
    .limit(1);
  return incident ?? null;
}

export function isTerminalIncidentState(state: IncidentState) {
  return TERMINAL_STATES.includes(state);
}
