import { NextResponse } from "next/server";
import { z } from "zod";

import { sha256Json } from "@/domain/collection/identity";
import {
  APPROVAL_CONFIRMATION,
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
    parsedBody.data.confirmation !== APPROVAL_CONFIRMATION
  ) {
    return NextResponse.json(
      { error: `Type ${APPROVAL_CONFIRMATION} to approve.` },
      { status: 400 },
    );
  }
  if (
    action.data === "reject" &&
    parsedBody.data.confirmation !== REJECTION_CONFIRMATION
  ) {
    return NextResponse.json(
      { error: `Type ${REJECTION_CONFIRMATION} to reject.` },
      { status: 400 },
    );
  }

  try {
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
        idempotencyKey: idempotency.data,
      });
      targetId = job.id;
      outcome = "queued";
      responseStatus = 202;
      responseBody = { job };
    }

    await db
      .insert(operatorActions)
      .values({
        actorUserId: session.user.id,
        action: `incident.${action.data}`,
        targetType: action.data === "acknowledge" ? "incident" : "job",
        targetId,
        idempotencyKey: `incident.${action.data}:${idempotency.data}`,
        requestHash: sha256Json({
          incidentId: incidentId.data,
          action: action.data,
          prompt: parsedBody.data.prompt ?? null,
          confirmed: Boolean(parsedBody.data.confirmation),
        }),
        outcome,
        metadata: {
          incidentId: incidentId.data,
          humanInitiated: true,
        },
      })
      .onConflictDoNothing({ target: operatorActions.idempotencyKey });

    return NextResponse.json(responseBody, { status: responseStatus });
  } catch (error) {
    if (error instanceof IncidentNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof IncidentStateError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }
}
