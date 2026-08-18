import { NextResponse } from "next/server";
import { z } from "zod";

import { sha256Json } from "@/domain/collection/identity";
import { getAppEnv } from "@/lib/env";
import { getOperatorSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { operatorActions } from "@/server/db/schema";
import { enqueueManualCollection } from "@/server/jobs/queue";
import { CollectionOverlapError } from "@/server/services/collection";

const idempotencySchema = z.string().min(16).max(128);

export async function POST(request: Request) {
  const session = await getOperatorSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expectedOrigin = new URL(getAppEnv().BETTER_AUTH_URL).origin;
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

  try {
    const job = await enqueueManualCollection(parsedIdempotency.data);
    await db
      .insert(operatorActions)
      .values({
        actorUserId: session.user.id,
        action: "collection.run_now",
        targetType: "job",
        targetId: job.id,
        idempotencyKey: `collection.run_now:${parsedIdempotency.data}`,
        requestHash: sha256Json({ action: "collection.run_now" }),
        outcome: "queued",
        metadata: { jobStatus: job.status },
      })
      .onConflictDoNothing({ target: operatorActions.idempotencyKey });

    return NextResponse.json({ job }, { status: 202 });
  } catch (error) {
    if (error instanceof CollectionOverlapError) {
      return NextResponse.json(
        { error: "A collection is already running." },
        { status: 409 },
      );
    }
    throw error;
  }
}
