import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import {
  APPROVAL_CONFIRMATION,
  hasExactIncidentConfirmation,
  incidentActionIdempotencyKey,
  incidentActionRequestHash,
  incidentActionBodySchema,
  incidentActionSchema,
  REJECTION_CONFIRMATION,
} from "@/domain/incidents/contract";
import { IncidentStateError } from "@/domain/incidents/machine";
import { getAppEnv } from "@/lib/env";
import { getOperatorSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { operatorActions } from "@/server/db/schema";
import { enqueueIncidentJob } from "@/server/jobs/incident-jobs";
import {
  acknowledgeIncident,
  IncidentNotFoundError,
  requireIncidentAction,
} from "@/server/services/incidents";

const idSchema = z.string().uuid();
const idempotencySchema = z.string().min(16).max(128);

export async function POST(
  request: Request,
  context: {
    params: Promise<{ incidentId: string; action: string }>;
  },
) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expectedOrigin = new URL(getAppEnv().BETTER_AUTH_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  }

  const { incidentId: rawIncidentId, action: rawAction } = await context.params;
  const incidentId = idSchema.safeParse(rawIncidentId);
  const action = incidentActionSchema.safeParse(rawAction);
  const idempotency = idempotencySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!incidentId.success || !action.success) {
    return NextResponse.json({ error: "Unknown incident action." }, { status: 404 });
  }
  if (!idempotency.success) {
    return NextResponse.json(
      { error: "A valid Idempotency-Key header is required." },
      { status: 400 },
    );
  }

  let body: unknown = {};
  const text = await request.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
    }
  }
  const parsedBody = incidentActionBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: "The incident action details are invalid." },
      { status: 400 },
    );
  }
  if (action.data === "heal" && !parsedBody.data.prompt) {
    return NextResponse.json(
      { error: "Describe the observed extraction problem before healing." },
      { status: 400 },
    );
  }
  if (
    action.data === "approve" &&
    !hasExactIncidentConfirmation(action.data, parsedBody.data.confirmation)
  ) {
    return NextResponse.json(
      { error: `Type ${APPROVAL_CONFIRMATION} to approve.` },
      { status: 400 },
    );
  }
  if (
    action.data === "reject" &&
    !hasExactIncidentConfirmation(action.data, parsedBody.data.confirmation)
  ) {
    return NextResponse.json(
      { error: `Type ${REJECTION_CONFIRMATION} to reject.` },
      { status: 400 },
    );
  }

  const requestHash = incidentActionRequestHash({
    incidentId: incidentId.data,
    action: action.data,
    prompt: parsedBody.data.prompt ?? null,
    confirmation: parsedBody.data.confirmation ?? null,
  });
  const auditIdempotencyKey = incidentActionIdempotencyKey(
    incidentId.data,
    idempotency.data,
  );
  let reservationId: string | undefined;

  try {
    const [reservation] = await db
      .insert(operatorActions)
      .values({
        actorUserId: session.user.id,
        action: `incident.${action.data}`,
        targetType: "incident",
        targetId: incidentId.data,
        idempotencyKey: auditIdempotencyKey,
        requestHash,
        outcome: "pending",
        metadata: {
          incidentId: incidentId.data,
          humanInitiated: true,
          pending: true,
        },
      })
      .onConflictDoNothing({ target: operatorActions.idempotencyKey })
      .returning({ id: operatorActions.id });

    if (!reservation) {
      const [existingAction] = await db
        .select({
          requestHash: operatorActions.requestHash,
          targetId: operatorActions.targetId,
          outcome: operatorActions.outcome,
        })
        .from(operatorActions)
        .where(eq(operatorActions.idempotencyKey, auditIdempotencyKey))
        .limit(1);
      if (!existingAction) {
        throw new Error("Could not resolve the incident Idempotency-Key.");
      }
      if (existingAction.requestHash !== requestHash) {
        return NextResponse.json(
          { error: "The Idempotency-Key was already used for a different incident action." },
          { status: 409 },
        );
      }
      if (existingAction.outcome === "pending") {
        return NextResponse.json(
          { error: "An incident action with this Idempotency-Key is already in progress." },
          { status: 409 },
        );
      }
      return NextResponse.json(
        {
          replayed: true,
          outcome: existingAction.outcome,
          targetId: existingAction.targetId,
        },
        { status: existingAction.outcome === "queued" ? 202 : existingAction.outcome === "completed" ? 200 : 409 },
      );
    }
    reservationId = reservation.id;

    let targetId = incidentId.data;
    let outcome = "completed";
    let responseStatus = 200;
    let responseBody: Record<string, unknown>;

    if (action.data === "acknowledge") {
      const incident = await acknowledgeIncident(
        incidentId.data,
        session.user.id,
      );
      responseBody = { incident };
    } else {
      await requireIncidentAction(incidentId.data, action.data);
      const job = await enqueueIncidentJob({
        action: action.data,
        incidentId: incidentId.data,
        actorUserId: session.user.id,
        prompt: parsedBody.data.prompt,
        confirmation: parsedBody.data.confirmation,
        idempotencyKey: idempotency.data,
      });
      targetId = job.id;
      outcome = "queued";
      responseStatus = 202;
      responseBody = { job };
    }

    await db
      .update(operatorActions)
      .set({
        targetType: action.data === "acknowledge" ? "incident" : "job",
        targetId,
        outcome,
        metadata: {
          incidentId: incidentId.data,
          humanInitiated: true,
        },
      })
      .where(eq(operatorActions.id, reservation.id));

    return NextResponse.json(responseBody, { status: responseStatus });

  } catch (error) {
    if (reservationId) {
      await db
        .update(operatorActions)
        .set({
          outcome: "failed",
          metadata: {
            incidentId: incidentId.data,
            humanInitiated: true,
            error:
              error instanceof Error ? error.message.slice(0, 300) : "unknown",
          },
        })
        .where(eq(operatorActions.id, reservationId));
    }
    if (error instanceof IncidentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof IncidentStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
