import { and, isNotNull, lte } from "drizzle-orm";

import { db } from "@/server/db/client";
import { rawPayloads } from "@/server/db/schema";

/**
 * Collection-run service seam (disposition RETAIN_AND_REFACTOR, plan 5.2).
 *
 * The legacy UNBROKEN elevator-collection runtime (SFMTA source fetch,
 * contract validation, station/equipment persistence, trusted-snapshot
 * promotion) was removed with the L1 cleanup batch together with the deleted
 * `@/domain/collection/{catalog,contract,validation}` modules it depended on.
 * What survives here:
 *
 * - `CollectionOverlapError`: reused by the run-trigger API route.
 * - `expireRawPayloadBodies`: generic raw-payload retention.
 * - `runCollection`: a fail-closed seam. The legacy implementation is gone and
 *   the PulseRank collection binding (Bright Data product-scrape runs over the
 *   pulse.* schema) has not landed yet, so every invocation resolves to a
 *   structured `unavailable` result — it can never execute legacy behavior or
 *   touch the retired collector identity.
 */

export class CollectionOverlapError extends Error {
  constructor() {
    super("Another collection is already active.");
    this.name = "CollectionOverlapError";
  }
}

export type CollectionTrigger = "scheduled" | "manual" | "manual_cli" | "retry";

export type PulseCollectionRunResult = {
  status: "unavailable";
  reason: "PULSERANK_COLLECTION_BINDING_PENDING";
  message: string;
};

/**
 * Fail-closed placeholder for the PulseRank collection pipeline (TODO A-series
 * binding). Never throws for expected unavailability; never performs I/O.
 */
export async function runCollection(
  trigger: CollectionTrigger,
): Promise<PulseCollectionRunResult> {
  void trigger;
  return {
    status: "unavailable",
    reason: "PULSERANK_COLLECTION_BINDING_PENDING",
    message:
      "The legacy collection runtime was removed; the PulseRank collection pipeline is not bound yet.",
  };
}

/** Nulls out raw payload bodies past their retention window. */
export async function expireRawPayloadBodies() {
  const expired = await db
    .update(rawPayloads)
    .set({ body: null })
    .where(
      and(
        lte(rawPayloads.expiresAt, new Date()),
        isNotNull(rawPayloads.body),
      ),
    )
    .returning({ id: rawPayloads.id });
  return expired.length;
}
