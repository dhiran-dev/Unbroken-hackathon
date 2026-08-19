import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";

import { db as applicationDatabase } from "@/server/db/client";
import {
  sourceSnapshots,
  stopAccessibilityGuides,
} from "@/server/db/schema/transit";
import {
  STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  type StopAccessibilityGuideRefreshAttempt,
  type StopAccessibilityGuideRefreshResult,
  type StopAccessibilityGuideStore,
  type StoredStopAccessibilityGuideSnapshot,
} from "@/server/transit/stop-accessibility-guides";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SnapshotRow = typeof sourceSnapshots.$inferSelect;

const IMPORT_LOCK_ID = 1_431_197_044;
const SOURCE_KIND = "stop_accessibility" as const;
const EXPECTED_GUIDE_COUNT = 52;

function asJson(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

async function currentRow(database: Database | Transaction) {
  const [row] = await database
    .select()
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.kind, SOURCE_KIND),
        eq(sourceSnapshots.collectorId, STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID),
        eq(sourceSnapshots.sourceUrl, STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
        eq(sourceSnapshots.status, "current"),
      ),
    )
    .orderBy(desc(sourceSnapshots.acceptedAt), desc(sourceSnapshots.createdAt))
    .limit(1);
  return row ?? null;
}

async function toStoredSnapshot(
  database: Database | Transaction,
  snapshot: SnapshotRow,
): Promise<StoredStopAccessibilityGuideSnapshot> {
  if (
    !snapshot.structuralFingerprint ||
    snapshot.sourceUpdatedAt !== null ||
    snapshot.sourceUrl !== STOP_ACCESSIBILITY_GUIDE_SOURCE_URL
  ) {
    throw new Error("The current accessible-stop snapshot is incomplete.");
  }
  const rows = await database
    .select()
    .from(stopAccessibilityGuides)
    .where(eq(stopAccessibilityGuides.snapshotId, snapshot.id))
    .orderBy(stopAccessibilityGuides.guideId);
  if (
    rows.length !== EXPECTED_GUIDE_COUNT ||
    rows.some(
      (row) =>
        row.stopId !== null ||
        row.accessibilityState !== "unknown" ||
        !row.reviewed ||
        row.publicUrl !== STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    )
  ) {
    throw new Error("The current accessible-stop guides are incomplete.");
  }
  return {
    snapshotId: snapshot.id,
    payloadHash: snapshot.payloadHash,
    structuralFingerprint: snapshot.structuralFingerprint,
    checkedAt: snapshot.checkedAt,
    sourceUpdatedAt: null,
    sourceUrl: snapshot.sourceUrl,
    guides: rows.map((row) => ({
      guideId: row.guideId,
      stopId: null,
      stationName: row.stationName,
      routeNames: row.routeNames,
      guidance: row.guidance,
      accessibilityState: "unknown",
      reviewed: true,
      publicUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    })),
  };
}

async function currentInside(transaction: Transaction) {
  const row = await currentRow(transaction);
  return row ? toStoredSnapshot(transaction, row) : null;
}

async function latestAttempt(database: Database | Transaction) {
  const [row] = await database
    .select({
      status: sourceSnapshots.status,
      checkedAt: sourceSnapshots.checkedAt,
    })
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.kind, SOURCE_KIND),
        eq(sourceSnapshots.collectorId, STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID),
        eq(sourceSnapshots.sourceUrl, STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
      ),
    )
    .orderBy(desc(sourceSnapshots.checkedAt), desc(sourceSnapshots.createdAt))
    .limit(1);
  return row ?? null;
}

function sameGuides(
  left: StoredStopAccessibilityGuideSnapshot["guides"],
  right: StoredStopAccessibilityGuideSnapshot["guides"],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function recordFailure(
  transaction: Transaction,
  attempt: Extract<
    StopAccessibilityGuideRefreshAttempt,
    { status: "rejected" | "unavailable" }
  >,
  current: StoredStopAccessibilityGuideSnapshot | null,
) {
  await transaction
    .insert(sourceSnapshots)
    .values({
      kind: SOURCE_KIND,
      collectorId: STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
      sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
      payloadHash: attempt.payloadHash,
      structuralFingerprint: null,
      checkedAt: attempt.checkedAt,
      sourceUpdatedAt: null,
      acceptedAt: null,
      status: attempt.status,
      validationReport: asJson(attempt.validationReport),
      rowCount: attempt.validationReport.rowCount,
    })
    .onConflictDoUpdate({
      target: [sourceSnapshots.kind, sourceSnapshots.payloadHash],
      set: {
        checkedAt: attempt.checkedAt,
        status: attempt.status,
        validationReport: asJson(attempt.validationReport),
        rowCount: attempt.validationReport.rowCount,
      },
    });
  return { status: attempt.status, activeSnapshot: current };
}

export class PostgresStopAccessibilityGuideStore implements StopAccessibilityGuideStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async getCurrentSnapshot() {
    const row = await currentRow(this.database);
    return row ? toStoredSnapshot(this.database, row) : null;
  }

  async getLatestAttempt() {
    return latestAttempt(this.database);
  }

  async applyRefreshAttempt(
    attempt: StopAccessibilityGuideRefreshAttempt,
  ): Promise<StopAccessibilityGuideRefreshResult> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`select pg_advisory_xact_lock(${IMPORT_LOCK_ID})`,
      );
      const current = await currentInside(transaction);
      if (
        attempt.basedOnSnapshotId !== (current?.snapshotId ?? null) ||
        (current !== null && attempt.checkedAt < current.checkedAt)
      ) {
        return { status: "rejected", activeSnapshot: current };
      }
      if (attempt.status !== "validated") {
        return recordFailure(transaction, attempt, current);
      }
      if (current?.payloadHash === attempt.payloadHash) {
        if (
          current.structuralFingerprint !== attempt.structuralFingerprint ||
          !sameGuides(current.guides, attempt.guides)
        ) {
          return { status: "rejected", activeSnapshot: current };
        }
        await transaction
          .update(sourceSnapshots)
          .set({
            checkedAt: attempt.checkedAt,
            sourceUpdatedAt: null,
            acceptedAt: attempt.checkedAt,
            validationReport: asJson(attempt.validationReport),
            rowCount: attempt.guides.length,
          })
          .where(eq(sourceSnapshots.id, current.snapshotId));
        return {
          status: "unchanged",
          activeSnapshot: { ...current, checkedAt: attempt.checkedAt },
        };
      }
      if (current !== null && attempt.checkedAt <= current.checkedAt) {
        return { status: "rejected", activeSnapshot: current };
      }
      const [historicalHashOwner] = await transaction
        .select()
        .from(sourceSnapshots)
        .where(
          and(
            eq(sourceSnapshots.kind, SOURCE_KIND),
            eq(
              sourceSnapshots.collectorId,
              STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
            ),
            eq(sourceSnapshots.sourceUrl, STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
            eq(sourceSnapshots.payloadHash, attempt.payloadHash),
          ),
        )
        .limit(1);
      if (historicalHashOwner) {
        if (
          historicalHashOwner.status !== "current" ||
          historicalHashOwner.structuralFingerprint !==
            attempt.structuralFingerprint ||
          historicalHashOwner.sourceUpdatedAt !== null
        ) {
          return { status: "rejected", activeSnapshot: current };
        }
        const historical = await toStoredSnapshot(
          transaction,
          historicalHashOwner,
        );
        if (!sameGuides(historical.guides, attempt.guides)) {
          return { status: "rejected", activeSnapshot: current };
        }
        await transaction
          .update(sourceSnapshots)
          .set({
            checkedAt: attempt.checkedAt,
            sourceUpdatedAt: null,
            acceptedAt: attempt.checkedAt,
            status: "current",
            validationReport: asJson(attempt.validationReport),
            rowCount: attempt.guides.length,
          })
          .where(eq(sourceSnapshots.id, historical.snapshotId));
        return {
          status: "promoted",
          activeSnapshot: { ...historical, checkedAt: attempt.checkedAt },
        };
      }

      const [created] = await transaction
        .insert(sourceSnapshots)
        .values({
          kind: SOURCE_KIND,
          collectorId: STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID,
          sourceUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
          payloadHash: attempt.payloadHash,
          structuralFingerprint: attempt.structuralFingerprint,
          checkedAt: attempt.checkedAt,
          sourceUpdatedAt: null,
          acceptedAt: attempt.checkedAt,
          status: "current",
          validationReport: asJson(attempt.validationReport),
          rowCount: attempt.guides.length,
        })
        .returning();
      if (!created) {
        throw new Error(
          "The trusted accessible-stop snapshot was not created.",
        );
      }
      await transaction.insert(stopAccessibilityGuides).values(
        attempt.guides.map((guide) => ({
          snapshotId: created.id,
          guideId: guide.guideId,
          stopId: null,
          stationName: guide.stationName,
          routeNames: guide.routeNames,
          guidance: guide.guidance,
          accessibilityState: "unknown",
          reviewed: true,
          publicUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
        })),
      );
      return {
        status: "promoted",
        activeSnapshot: await toStoredSnapshot(transaction, created),
      };
    });
  }
}
