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
import { enqueuePulseJob } from "@/server/jobs/queue";
import {
  acknowledgeIncident,
  IncidentNotFoundError,
  requireIncidentAction,
} from "@/server/services/incidents";

/**
 * Incident-action endpoint (disposition RETAIN_AND_REFACTOR): kept as the
 * pattern and re-pointed to PulseRank job names (`pulse.heal.preview`,
 * `pulse.heal.verify`). The operator-session gate went away with the
 * Better-Auth runtime, so mutations stay fail-closed behind
 * PULSERANK_JUDGE_MUTATIONS_ENABLED + origin check until the judge-mode actor
 * model lands. The legacy operator_actions audit reservation required a real
 * user FK and is intentionally not written here; re-wiring audit attribution
 * is a documented follow-up.
 */

const idSchema = z.string().uuid();
const idempotencySchema = z.string().min(16).max(128);

const PULSE_JOB_BY_ACTION = {
  heal: "pulse.heal.preview",
  verify: "pulse.heal.verify",
} as const;

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
    const pulseName: string | undefined =
      action.data === "heal" || action.data === "verify"
        ? PULSE_JOB_BY_ACTION[action.data]
        : undefined;
    if (!pulseName) {
      return NextResponse.json(
        { error: "This incident action is not available in judge mode yet." },
        { status: 503 },
      );
    }
    const job = await enqueuePulseJob({
      name: pulseName,
      payload: {
        incidentId: incidentId.data,
        prompt: parsedBody.data.prompt ?? null,
        confirmation: parsedBody.data.confirmation ?? null,
      },
      idempotencyKey: `${pulseName}:${incidentId.data}:${idempotency.data}`,
    });

    if (!job) {
      return NextResponse.json(
        { error: "This Idempotency-Key was already used for this action." },
        { status: 409 },
      );
    }

    return NextResponse.json({ job }, { status: 202 });
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
