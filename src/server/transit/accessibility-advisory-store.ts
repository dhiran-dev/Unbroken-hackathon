import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";

import { db as applicationDatabase } from "@/server/db/client";
import {
  accessibilityAdvisories,
  sourceSnapshots,
} from "@/server/db/schema/transit";
import {
  ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  type AccessibilityAdvisoryStore,
  type AccessibilityRefreshAttempt,
  type AccessibilityRefreshResult,
  type StoredAccessibilitySnapshot,
} from "@/server/transit/accessibility-advisories";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SnapshotRow = typeof sourceSnapshots.$inferSelect;

const ADVISORY_IMPORT_LOCK_ID = 1_431_196_243;
const SOURCE_KIND = "accessibility_advisories" as const;

function asJson(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

async function advisoryRows(
  database: Database | Transaction,
  snapshotId: string,
) {
  return database
    .select()
    .from(accessibilityAdvisories)
    .where(eq(accessibilityAdvisories.snapshotId, snapshotId))
    .orderBy(accessibilityAdvisories.advisoryId);
}

async function toStoredSnapshot(
  database: Database | Transaction,
  row: SnapshotRow,
): Promise<StoredAccessibilitySnapshot> {
  const rows = await advisoryRows(database, row.id);
  if (!row.structuralFingerprint) {
    throw new Error("The current accessibility snapshot is incomplete.");
  }
  return {
    snapshotId: row.id,
    payloadHash: row.payloadHash,
    structuralFingerprint: row.structuralFingerprint,
    checkedAt: row.checkedAt,
    sourceUpdatedAt: row.sourceUpdatedAt,
    sourceUrl: row.sourceUrl,
    advisories: rows.map((advisory) => ({
      advisoryId: advisory.advisoryId,
      title: advisory.title,
      description: advisory.description,
      affectedStops: advisory.affectedStops,
      affectedRoutes: advisory.affectedRoutes,
      startsAt: advisory.startsAt,
      endsAt: advisory.endsAt,
      publicUrl: advisory.publicUrl,
    })),
  };
}

async function currentRow(database: Database | Transaction) {
  const [row] = await database
    .select()
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.kind, SOURCE_KIND),
        eq(sourceSnapshots.collectorId, ACCESSIBILITY_ADVISORY_COLLECTOR_ID),
        eq(sourceSnapshots.sourceUrl, ACCESSIBILITY_ADVISORY_SOURCE_URL),
        eq(sourceSnapshots.status, "current"),
      ),
    )
    .orderBy(desc(sourceSnapshots.acceptedAt), desc(sourceSnapshots.createdAt))
    .limit(1);
  return row ?? null;
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
        eq(sourceSnapshots.collectorId, ACCESSIBILITY_ADVISORY_COLLECTOR_ID),
        eq(sourceSnapshots.sourceUrl, ACCESSIBILITY_ADVISORY_SOURCE_URL),
      ),
    )
    .orderBy(desc(sourceSnapshots.checkedAt), desc(sourceSnapshots.createdAt))
    .limit(1);
  return row ?? null;
}

async function currentInside(transaction: Transaction) {
  const row = await currentRow(transaction);
  return row ? toStoredSnapshot(transaction, row) : null;
}

function sameAdvisories(
  stored: StoredAccessibilitySnapshot["advisories"],
  received: StoredAccessibilitySnapshot["advisories"],
) {
  return JSON.stringify(stored) === JSON.stringify(received);
}

async function recordFailed(
  transaction: Transaction,
  attempt: Extract<
    AccessibilityRefreshAttempt,
    { status: "rejected" | "unavailable" }
  >,
  current: StoredAccessibilitySnapshot | null,
) {
  await transaction
    .insert(sourceSnapshots)
    .values({
      kind: SOURCE_KIND,
      collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
      sourceUrl: attempt.sourceUrl,
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

export class PostgresAccessibilityAdvisoryStore implements AccessibilityAdvisoryStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async getCurrentSnapshot() {
    const row = await currentRow(this.database);
    return row ? toStoredSnapshot(this.database, row) : null;
  }

  async getLatestAttempt() {
    return latestAttempt(this.database);
  }

  async applyRefreshAttempt(
    attempt: AccessibilityRefreshAttempt,
  ): Promise<AccessibilityRefreshResult> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`select pg_advisory_xact_lock(${ADVISORY_IMPORT_LOCK_ID})`,
      );
      const current = await currentInside(transaction);
      if (
        attempt.basedOnSnapshotId !== (current?.snapshotId ?? null) ||
        (current !== null && attempt.checkedAt < current.checkedAt)
      ) {
        return { status: "rejected", activeSnapshot: current };
      }
      if (attempt.status !== "validated") {
        return recordFailed(transaction, attempt, current);
      }

      if (current?.payloadHash === attempt.payloadHash) {
        if (
          current.structuralFingerprint !== attempt.structuralFingerprint ||
          !sameAdvisories(current.advisories, attempt.advisories)
        ) {
          return { status: "rejected", activeSnapshot: current };
        }
        await transaction
          .update(sourceSnapshots)
          .set({
            checkedAt: attempt.checkedAt,
            acceptedAt: attempt.checkedAt,
            sourceUpdatedAt: null,
            validationReport: asJson(attempt.validationReport),
            rowCount: attempt.advisories.length,
          })
          .where(eq(sourceSnapshots.id, current.snapshotId));
        return {
          status: "unchanged",
          activeSnapshot: { ...current, checkedAt: attempt.checkedAt },
        };
      }

      const [historicalHashOwner] = await transaction
        .select({ id: sourceSnapshots.id })
        .from(sourceSnapshots)
        .where(
          and(
            eq(sourceSnapshots.kind, SOURCE_KIND),
            eq(sourceSnapshots.payloadHash, attempt.payloadHash),
          ),
        )
        .limit(1);
      if (historicalHashOwner) {
        return { status: "rejected", activeSnapshot: current };
      }
      const [created] = await transaction
        .insert(sourceSnapshots)
        .values({
          kind: SOURCE_KIND,
          collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
          sourceUrl: attempt.sourceUrl,
          payloadHash: attempt.payloadHash,
          structuralFingerprint: attempt.structuralFingerprint,
          checkedAt: attempt.checkedAt,
          sourceUpdatedAt: null,
          acceptedAt: attempt.checkedAt,
          status: "current",
          validationReport: asJson(attempt.validationReport),
          rowCount: attempt.advisories.length,
        })
        .returning();
      if (!created) {
        throw new Error("The trusted accessibility snapshot was not created.");
      }
      await transaction.insert(accessibilityAdvisories).values(
        attempt.advisories.map((advisory) => ({
          snapshotId: created.id,
          advisoryId: advisory.advisoryId,
          title: advisory.title,
          description: advisory.description,
          affectedStops: advisory.affectedStops,
          affectedRoutes: advisory.affectedRoutes,
          startsAt: advisory.startsAt,
          endsAt: advisory.endsAt,
          publicUrl: advisory.publicUrl,
        })),
      );
      return {
        status: "promoted",
        activeSnapshot: await toStoredSnapshot(transaction, created),
      };
    });
  }
}
