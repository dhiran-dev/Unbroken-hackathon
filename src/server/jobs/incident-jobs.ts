import { eq } from "drizzle-orm";

import { db } from "@/server/db/client";
import { jobs } from "@/server/db/schema";
import {
  approveIncident,
  healIncident,
  rejectIncident,
  reviewIncident,
  verifyIncident,
} from "@/server/services/incident-workflow";
import { getIncident, recordIncidentEvidence, transitionIncident } from "@/server/services/incidents";

export const incidentJobActions = [
  "heal",
  "review",
  "approve",
  "reject",
  "verify",
] as const;

export type IncidentJobAction = (typeof incidentJobActions)[number];

type IncidentJobPayload = {
  incidentId: string;
  actorUserId: string;
  prompt?: string;
  confirmation?: string;
};

function isIncidentJobPayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & IncidentJobPayload {
  return (
    typeof value.incidentId === "string" &&
    typeof value.actorUserId === "string" &&
    (value.prompt === undefined || typeof value.prompt === "string") &&
    (value.confirmation === undefined || typeof value.confirmation === "string")
  );
}

export function isIncidentJob(type: string) {
  return incidentJobActions.some((action) => type === `incident_${action}`);
}

export const MUTATING_INCIDENT_JOB_TYPES = [
  "incident_heal",
  "incident_approve",
  "incident_reject",
  "incident_verify",
] as const;

export function isMutatingIncidentJobType(type: string) {
  return MUTATING_INCIDENT_JOB_TYPES.includes(type as (typeof MUTATING_INCIDENT_JOB_TYPES)[number]);
}

export async function reconcileAbandonedIncidentJob(job: {
  type: string;
  payload: Record<string, unknown>;
}, now = new Date()) {
  if (!isIncidentJobPayload(job.payload)) return;
  const action = job.type.replace(/^incident_/, "") as IncidentJobAction;
  try {
    const incident = await getIncident(job.payload.incidentId);
    if (action === "heal" && incident.state === "heal_requested") {
      await transitionIncident({
        incidentId: incident.id,
        toState: "acknowledged",
        eventType: "healing.worker_abandoned",
        actorUserId: job.payload.actorUserId,
        details: {
          code: "HEALING_WORKER_ABANDONED",
          productionCollectorChanged: false,
          abandonedAt: now.toISOString(),
        },
      });
      return;
    }
    if (
      (action === "approve" || action === "verify") &&
      ["awaiting_review", "awaiting_approval", "approved"].includes(incident.state)
    ) {
      await transitionIncident({
        incidentId: incident.id,
        toState: "verification_failed",
        eventType: "healing.worker_abandoned",
        actorUserId: job.payload.actorUserId,
        details: {
          code: "MUTATING_JOB_WORKER_ABANDONED",
          productionCollectorMayHaveChanged: action === "approve",
          verificationRequired: true,
          abandonedAt: now.toISOString(),
        },
      });
      return;
    }
    await recordIncidentEvidence({
      incidentId: incident.id,
      eventType: "incident.worker_abandoned",
      actorUserId: job.payload.actorUserId,
      details: { action, abandonedAt: now.toISOString() },
    });
  } catch {
    // Recovery must never prevent the queue from releasing its lease.
  }
}

export async function enqueueIncidentJob(input: {
  action: IncidentJobAction;
  incidentId: string;
  actorUserId: string;
  prompt?: string;
  confirmation?: string;
  idempotencyKey: string;
}) {
  const maxAttempts = ["heal", "approve", "reject"].includes(input.action)
    ? 1
    : 3;
  const [job] = await db
    .insert(jobs)
    .values({
      type: `incident_${input.action}`,
      payload: {
        incidentId: input.incidentId,
        actorUserId: input.actorUserId,
        ...(input.prompt ? { prompt: input.prompt } : {}),
        ...(input.confirmation ? { confirmation: input.confirmation } : {}),
      },
      idempotencyKey: `incident:${input.action}:${input.idempotencyKey}`,
      scheduledFor: new Date(),
      maxAttempts,
    })
    .onConflictDoNothing({ target: jobs.idempotencyKey })
    .returning({ id: jobs.id, status: jobs.status });

  if (job) return job;
  const [existing] = await db
    .select({ id: jobs.id, status: jobs.status })
    .from(jobs)
    .where(
      eq(
        jobs.idempotencyKey,
        `incident:${input.action}:${input.idempotencyKey}`,
      ),
    )
    .limit(1);
  if (!existing) throw new Error("Could not enqueue the incident action.");
  return existing;
}

export async function processIncidentJob(job: {
  id: string;
  type: string;
  payload: Record<string, unknown>;
}) {
  if (!isIncidentJobPayload(job.payload)) {
    throw new Error("Incident job payload is invalid.");
  }
  const action = job.type.replace(/^incident_/, "") as IncidentJobAction;
  const input = {
    incidentId: job.payload.incidentId,
    actorUserId: job.payload.actorUserId,
  };

  if (action === "heal") {
    if (!job.payload.prompt) throw new Error("Healing prompt is required.");
    await healIncident({ ...input, prompt: job.payload.prompt });
  } else if (action === "review") {
    await reviewIncident(input);
  } else if (action === "approve") {
    if (job.payload.confirmation === undefined) {
      throw new Error("Explicit approval confirmation is required.");
    }
    await approveIncident({ ...input, confirmation: job.payload.confirmation });
    await enqueueIncidentJob({
      action: "verify",
      ...input,
      idempotencyKey: `verify-after-approval:${job.id}`,
    });
  } else if (action === "reject") {
    if (job.payload.confirmation === undefined) {
      throw new Error("Explicit rejection confirmation is required.");
    }
    await rejectIncident({ ...input, confirmation: job.payload.confirmation });
  } else if (action === "verify") {
    await verifyIncident(input);
  } else {
    throw new Error(`Unsupported incident action: ${action}`);
  }
}
