import { NextResponse } from "next/server";
import { z } from "zod";

import {
  APPROVAL_CONFIRMATION,
  hasExactIncidentConfirmation,
  incidentActionBodySchema,
  incidentActionSchema,
  REJECTION_CONFIRMATION,
} from "@/domain/incidents/contract";
import { IncidentStateError } from "@/domain/incidents/machine";
import { pulserankServerFlags } from "@/config/pulserank-flags";
import { publicEnv } from "@/lib/env";
import {
  acknowledgeIncident,
  IncidentNotFoundError,
  requireIncidentAction,
} from "@/server/services/incidents";

/**
 * Legacy core-incident endpoint. It may acknowledge historical records, but
 * it must never route their heal/verify actions into the PulseRank collector.
 * PulseRank healing starts from a validated `pulse.heal.preview` session and
 * uses the dedicated token-gated approval endpoint instead.
 */

const idSchema = z.string().uuid();
const idempotencySchema = z.string().min(16).max(128);

export async function POST(
  request: Request,
  context: {
    params: Promise<{ incidentId: string; action: string }>;
  },
) {
  if (!pulserankServerFlags.judgeMutationsEnabled) {
    return NextResponse.json(
      {
        error:
          "Judge mode is disabled. Set PULSERANK_JUDGE_MUTATIONS_ENABLED=true to allow incident actions.",
      },
      { status: 503 },
    );
  }

  const expectedOrigin = new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin;
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
  if (action.data === "heal" || action.data === "verify") {
    return NextResponse.json(
      {
        error:
          "Legacy core incidents are quarantined and cannot route healing work. Use the PulseRank heal-session flow.",
      },
      { status: 410 },
    );
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

  try {
    if (action.data === "acknowledge") {
      // Incident events carry a free-form actor label (no user FK), so the
      // system actor is recorded until judge-mode identity lands.
      const incident = await acknowledgeIncident(
        incidentId.data,
        "system:pulse-judge-mode",
      );
      return NextResponse.json({ incident }, { status: 200 });
    }

    await requireIncidentAction(incidentId.data, action.data);
    return NextResponse.json(
      { error: "This legacy incident action is not available in PulseRank." },
      { status: 410 },
    );
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
