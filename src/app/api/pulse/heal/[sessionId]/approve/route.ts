import { NextResponse } from "next/server";
import { z } from "zod";

import { APPROVAL_CONFIRMATION } from "@/domain/incidents/contract";
import { pulserankServerFlags } from "@/config/pulserank-flags";
import { publicEnv } from "@/lib/env";
import { evaluateMutationGate } from "@/server/judge/mutation-gate";
import { approvePulseHealSession } from "@/server/services/pulse-healing";

const sessionIdSchema = z.string().uuid();
const approvalBodySchema = z.object({
  token: z.string().min(1),
  confirmation: z.literal(APPROVAL_CONFIRMATION),
});

/**
 * Explicit human approval endpoint for a stored PulseRank heal preview.
 * Origin + flag + token are checked before the Bright Data approve command;
 * this endpoint never exposes the token or provider envelope in its response.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  if (!pulserankServerFlags.judgeMutationsEnabled) {
    return NextResponse.json(
      { error: "PulseRank judge mutations are disabled." },
      { status: 503 },
    );
  }

  const expectedOrigin = new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  }

  const { sessionId: rawSessionId } = await context.params;
  const sessionId = sessionIdSchema.safeParse(rawSessionId);
  if (!sessionId.success) {
    return NextResponse.json({ error: "Unknown heal session." }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const parsedBody = approvalBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: `Type ${APPROVAL_CONFIRMATION} and provide the judge token.` },
      { status: 400 },
    );
  }

  const gate = evaluateMutationGate({
    mutationsEnabled: pulserankServerFlags.judgeMutationsEnabled,
    expectedToken: process.env.PULSERANK_JUDGE_TOKEN ?? null,
    providedToken: parsedBody.data.token,
  });
  if (!gate.allowed) {
    return NextResponse.json({ error: "Approval denied." }, { status: 403 });
  }

  const outcome = await approvePulseHealSession({
    sessionId: sessionId.data,
    approvedBy: "judge:token-gated-human",
  });
  if (outcome.status === "ok") {
    return NextResponse.json({
      status: outcome.status,
      sessionId: outcome.sessionId,
      collectorId: outcome.collectorId,
      providerStatus: outcome.providerStatus,
    });
  }
  return NextResponse.json(
    { error: outcome.message, errorCode: outcome.errorCode },
    { status: outcome.errorCode === "heal_session_not_found" ? 404 : 409 },
  );
}
