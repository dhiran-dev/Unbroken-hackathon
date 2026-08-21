import { NextResponse } from "next/server";
import { z } from "zod";

import { publicEnv } from "@/lib/env";
import { pulserankServerFlags } from "@/config/pulserank-flags";
import { enqueuePulseJob } from "@/server/jobs/queue";

/**
 * Run-trigger endpoint (disposition RETAIN_AND_REFACTOR): re-pointed from the
 * legacy elevator collection job to the fail-closed PulseRank queue. The
 * operator-session gate went away with the Better-Auth runtime; until the
 * judge-mode actor model lands, mutations stay fail-closed behind
 * PULSERANK_JUDGE_MUTATIONS_ENABLED and the origin check.
 */

const idempotencySchema = z.string().min(16).max(128);

export async function POST(request: Request) {
  if (!pulserankServerFlags.judgeMutationsEnabled) {
    return NextResponse.json(
      {
        error:
          "Judge mode is disabled. Set PULSERANK_JUDGE_MUTATIONS_ENABLED=true to allow run triggers.",
      },
      { status: 503 },
    );
  }

  const expectedOrigin = new URL(publicEnv.NEXT_PUBLIC_APP_URL).origin;
  if (request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ error: "Origin rejected" }, { status: 403 });
  }

  const parsedIdempotency = idempotencySchema.safeParse(
    request.headers.get("idempotency-key"),
  );
  if (!parsedIdempotency.success) {
    return NextResponse.json(
      { error: "A valid Idempotency-Key header is required." },
      { status: 400 },
    );
  }

  const job = await enqueuePulseJob({
    name: "pulse.collect.sample",
    payload: { trigger: "manual" },
    idempotencyKey: `pulse.collect.sample:manual:${parsedIdempotency.data}`,
  });

  if (!job) {
    return NextResponse.json(
      { error: "This Idempotency-Key was already used." },
      { status: 409 },
    );
  }

  return NextResponse.json({ job }, { status: 202 });
}
