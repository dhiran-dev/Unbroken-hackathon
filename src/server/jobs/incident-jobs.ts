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
};

function isIncidentJobPayload(
  value: Record<string, unknown>,
): value is Record<string, unknown> & IncidentJobPayload {
  return (
    typeof value.incidentId === "string" &&
    typeof value.actorUserId === "string" &&
    (value.prompt === undefined || typeof value.prompt === "string")
  );
}

export function isIncidentJob(type: string) {
  return incidentJobActions.some((action) => type === `incident_${action}`);
}

export async function enqueueIncidentJob(input: {
  action: IncidentJobAction;
  incidentId: string;
  actorUserId: string;
  prompt?: string;
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
    await approveIncident(input);
    await enqueueIncidentJob({
      action: "verify",
      ...input,
      idempotencyKey: `verify-after-approval:${job.id}`,
    });
  } else if (action === "reject") {
    await rejectIncident(input);
  } else if (action === "verify") {
    await verifyIncident(input);
  } else {
    throw new Error(`Unsupported incident action: ${action}`);
  }
}
