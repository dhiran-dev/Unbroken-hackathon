import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";

import { db as applicationDatabase } from "@/server/db/client";
import { sourceSnapshots, stopRelocations } from "@/server/db/schema/transit";
import {
  STOP_RELOCATION_COLLECTOR_ID,
  STOP_RELOCATION_SOURCE_URL,
  type StopRelocationRefreshAttempt,
  type StopRelocationRefreshResult,
  type StopRelocationStore,
  type StoredStopRelocationSnapshot,
} from "@/server/transit/stop-relocations";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SnapshotRow = typeof sourceSnapshots.$inferSelect;

const IMPORT_LOCK_ID = 1_431_196_244;
const SOURCE_KIND = "stop_relocations" as const;

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
        eq(sourceSnapshots.collectorId, STOP_RELOCATION_COLLECTOR_ID),
        eq(sourceSnapshots.sourceUrl, STOP_RELOCATION_SOURCE_URL),
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
): Promise<StoredStopRelocationSnapshot> {
  if (!snapshot.structuralFingerprint || !snapshot.sourceUpdatedAt) {
    throw new Error("The current stop relocation snapshot is incomplete.");
  }
  const rows = await database
    .select()
    .from(stopRelocations)
    .where(eq(stopRelocations.snapshotId, snapshot.id))
    .orderBy(stopRelocations.rowId);
  if (
    rows.some(
      (row) =>
        row.startsAt === null ||
        row.endsAt === null ||
        row.scheduleText === null ||
        row.publicUrl !== STOP_RELOCATION_SOURCE_URL,
    )
  ) {
    throw new Error("The current stop relocation rows are incomplete.");
  }
  return {
    snapshotId: snapshot.id,
    payloadHash: snapshot.payloadHash,
    structuralFingerprint: snapshot.structuralFingerprint,
    checkedAt: snapshot.checkedAt,
    sourceUpdatedAt: snapshot.sourceUpdatedAt,
    sourceUrl: snapshot.sourceUrl,
    relocations: rows.map((row) => ({
      rowId: row.rowId,
      stopId: row.stopId,
      stopName: row.stopName,
      applicant: row.applicant,
      routeNames: row.routeNames,
      temporaryStop: row.temporaryStop,
      scheduleText: row.scheduleText!,
      startsAt: row.startsAt!,
      endsAt: row.endsAt!,
      latitude: row.latitude,
      longitude: row.longitude,
      publicUrl: STOP_RELOCATION_SOURCE_URL,
      boardingInstruction: `Board at ${row.temporaryStop}. ${row.scheduleText!}`,
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
        eq(sourceSnapshots.collectorId, STOP_RELOCATION_COLLECTOR_ID),
        eq(sourceSnapshots.sourceUrl, STOP_RELOCATION_SOURCE_URL),
      ),
    )
    .orderBy(desc(sourceSnapshots.checkedAt), desc(sourceSnapshots.createdAt))
    .limit(1);
  return row ?? null;
}

function sameRelocations(
  left: StoredStopRelocationSnapshot["relocations"],
  right: StoredStopRelocationSnapshot["relocations"],
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function recordFailure(
  transaction: Transaction,
  attempt: Extract<
    StopRelocationRefreshAttempt,
    { status: "rejected" | "unavailable" }
  >,
  current: StoredStopRelocationSnapshot | null,
) {
  await transaction
    .insert(sourceSnapshots)
    .values({
      kind: SOURCE_KIND,
      collectorId: STOP_RELOCATION_COLLECTOR_ID,
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
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

export class PostgresStopRelocationStore implements StopRelocationStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async getCurrentSnapshot() {
    const row = await currentRow(this.database);
    return row ? toStoredSnapshot(this.database, row) : null;
  }

  async getLatestAttempt() {
    return latestAttempt(this.database);
  }

  async applyRefreshAttempt(
    attempt: StopRelocationRefreshAttempt,
  ): Promise<StopRelocationRefreshResult> {
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
          !sameRelocations(current.relocations, attempt.relocations)
        ) {
          return { status: "rejected", activeSnapshot: current };
        }
        await transaction
          .update(sourceSnapshots)
          .set({
            checkedAt: attempt.checkedAt,
            sourceUpdatedAt: attempt.sourceUpdatedAt,
            acceptedAt: attempt.checkedAt,
            validationReport: asJson(attempt.validationReport),
            rowCount: attempt.relocations.length,
          })
          .where(eq(sourceSnapshots.id, current.snapshotId));
        return {
          status: "unchanged",
          activeSnapshot: {
            ...current,
            checkedAt: attempt.checkedAt,
            sourceUpdatedAt: attempt.sourceUpdatedAt,
          },
        };
      }
      const [historicalHashOwner] = await transaction
        .select()
        .from(sourceSnapshots)
        .where(
          and(
            eq(sourceSnapshots.kind, SOURCE_KIND),
            eq(sourceSnapshots.collectorId, STOP_RELOCATION_COLLECTOR_ID),
            eq(sourceSnapshots.sourceUrl, STOP_RELOCATION_SOURCE_URL),
            eq(sourceSnapshots.payloadHash, attempt.payloadHash),
          ),
        )
        .limit(1);
      if (historicalHashOwner) {
        if (
          historicalHashOwner.status !== "current" ||
          historicalHashOwner.structuralFingerprint !==
            attempt.structuralFingerprint ||
          historicalHashOwner.sourceUpdatedAt === null
        ) {
          return { status: "rejected", activeSnapshot: current };
        }
        const historical = await toStoredSnapshot(
          transaction,
          historicalHashOwner,
        );
        if (!sameRelocations(historical.relocations, attempt.relocations)) {
          return { status: "rejected", activeSnapshot: current };
        }
        await transaction
          .update(sourceSnapshots)
          .set({
            checkedAt: attempt.checkedAt,
            sourceUpdatedAt: attempt.sourceUpdatedAt,
            acceptedAt: attempt.checkedAt,
            status: "current",
            validationReport: asJson(attempt.validationReport),
            rowCount: attempt.relocations.length,
          })
          .where(eq(sourceSnapshots.id, historical.snapshotId));
        return {
          status: "promoted",
          activeSnapshot: {
            ...historical,
            checkedAt: attempt.checkedAt,
            sourceUpdatedAt: attempt.sourceUpdatedAt,
          },
        };
      }

      const [created] = await transaction
        .insert(sourceSnapshots)
        .values({
          kind: SOURCE_KIND,
          collectorId: STOP_RELOCATION_COLLECTOR_ID,
          sourceUrl: STOP_RELOCATION_SOURCE_URL,
          payloadHash: attempt.payloadHash,
          structuralFingerprint: attempt.structuralFingerprint,
          checkedAt: attempt.checkedAt,
          sourceUpdatedAt: attempt.sourceUpdatedAt,
          acceptedAt: attempt.checkedAt,
          status: "current",
          validationReport: asJson(attempt.validationReport),
          rowCount: attempt.relocations.length,
        })
        .returning();
      if (!created)
        throw new Error(
          "The trusted stop relocation snapshot was not created.",
        );
      await transaction.insert(stopRelocations).values(
        attempt.relocations.map((row) => ({
          snapshotId: created.id,
          rowId: row.rowId,
          stopId: row.stopId,
          stopName: row.stopName,
          applicant: row.applicant,
          routeNames: row.routeNames,
          scheduleText: row.scheduleText,
          temporaryStop: row.temporaryStop,
          latitude: row.latitude,
          longitude: row.longitude,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          publicUrl: STOP_RELOCATION_SOURCE_URL,
        })),
      );
      return {
        status: "promoted",
        activeSnapshot: await toStoredSnapshot(transaction, created),
      };
    });
  }
}
