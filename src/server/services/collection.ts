import { and, desc, eq, isNotNull, lte } from "drizzle-orm";

import { getStationDefinition, SFMTA_STATIONS } from "@/domain/collection/catalog";
import { COLLECTION_CONTRACT_VERSION } from "@/domain/collection/contract";
import { sha256Json } from "@/domain/collection/identity";
import {
  validateCollectorDataset,
  type CollectionClassification,
  type NormalizedElevatorRow,
} from "@/domain/collection/validation";
import { getServerEnv } from "@/lib/env";
import { db, sql } from "@/server/db/client";
import {
  collectionRuns,
  componentChecks,
  equipment,
  equipmentStatusEvents,
  observations,
  rawPayloads,
  routeRecalculations,
  stations,
  stationStatusEvents,
  trustedSnapshots,
} from "@/server/db/schema";

import {
  BrightDataError,
  downloadBrightDataDataset,
  triggerBrightDataCollection,
} from "./bright-data";
import { detectIncidentWithoutAffectingRun } from "./incident-detection";

const COLLECTION_LOCK_KEY = 7_431_926_118;
const RAW_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

export class CollectionOverlapError extends Error {
  constructor() {
    super("Another collection is already active.");
    this.name = "CollectionOverlapError";
  }
}

type CollectionTrigger = "scheduled" | "manual" | "manual_cli" | "retry";

function safeError(error: unknown) {
  if (error instanceof BrightDataError) {
    return { code: error.code, summary: error.message, retryable: error.retryable };
  }
  if (error instanceof Error) {
    return {
      code: "COLLECTION_UNEXPECTED_FAILURE",
      summary: error.message.slice(0, 300),
      retryable: false,
    };
  }
  return {
    code: "COLLECTION_UNEXPECTED_FAILURE",
    summary: "The collection failed with an unknown error.",
    retryable: false,
  };
}

function countStatuses(rows: NormalizedElevatorRow[]) {
  return rows.reduce(
    (counts, row) => {
      counts[row.equipmentStatus] += 1;
      return counts;
    },
    { in_service: 0, out_of_service: 0, unknown: 0 },
  );
}

async function latestTrustedState() {
  const [latest] = await db
    .select({
      collectionRunId: trustedSnapshots.collectionRunId,
      structuralFingerprint: trustedSnapshots.structuralFingerprint,
    })
    .from(trustedSnapshots)
    .orderBy(desc(trustedSnapshots.acceptedAt))
    .limit(1);

  if (!latest) {
    return {
      collectionRunId: null,
      structuralFingerprint: null,
      equipmentStatuses: new Map<string, "in_service" | "out_of_service" | "unknown">(),
      stationStatuses: new Map<string, "accessible" | "limited" | "unavailable" | "unknown">(),
    };
  }

  const previousEquipment = await db
    .select({
      sourceKey: equipment.sourceKey,
      status: observations.equipmentStatus,
      stationName: stations.sourceName,
      stationStatus: observations.reportedStationAccessibility,
    })
    .from(observations)
    .innerJoin(equipment, eq(observations.equipmentId, equipment.id))
    .innerJoin(stations, eq(observations.stationId, stations.id))
    .where(eq(observations.collectionRunId, latest.collectionRunId));

  return {
    collectionRunId: latest.collectionRunId,
    structuralFingerprint: latest.structuralFingerprint,
    equipmentStatuses: new Map(previousEquipment.map((row) => [row.sourceKey, row.status])),
    stationStatuses: new Map(previousEquipment.map((row) => [row.stationName, row.stationStatus])),
  };
}

async function recordRejectedRun(input: {
  runId: string;
  collectionId: string;
  payload: unknown;
  collectedAt: Date;
  result: ReturnType<typeof validateCollectorDataset>;
}) {
  const finishedAt = new Date();
  const payloadText = JSON.stringify(input.payload);

  await db.transaction(async (transaction) => {
    await transaction.insert(rawPayloads).values({
      collectionRunId: input.runId,
      payloadHash: sha256Json(input.payload),
      mediaType: "application/json",
      body: input.payload,
      byteLength: new TextEncoder().encode(payloadText).byteLength,
      expiresAt: new Date(input.collectedAt.getTime() + RAW_RETENTION_MS),
    });
    await transaction
      .update(collectionRuns)
      .set({
        collectionId: input.collectionId,
        status: "rejected",
        classification: input.result.classification,
        sourceValidAt: input.result.report.sourceValidAt
          ? new Date(input.result.report.sourceValidAt)
          : null,
        collectedAt: input.collectedAt,
        finishedAt,
        rowCount: input.result.report.rowCount,
        stationCount: input.result.report.stationCount,
        structuralFingerprint: input.result.report.structuralFingerprint,
        contractReport: input.result.report as unknown as Record<string, unknown>,
        reasonCodes: input.result.report.reasonCodes,
      })
      .where(eq(collectionRuns.id, input.runId));
    await transaction.insert(componentChecks).values({
      component: "validator",
      status: "degraded",
      message: `Collection rejected: ${input.result.classification}`,
      metadata: {
        runId: input.runId,
        reasonCodes: input.result.report.reasonCodes,
      },
      checkedAt: finishedAt,
    });
  });
}

async function publishTrustedRun(input: {
  runId: string;
  collectionId: string;
  payload: unknown;
  collectedAt: Date;
  previous: Awaited<ReturnType<typeof latestTrustedState>>;
  result: ReturnType<typeof validateCollectorDataset>;
}) {
  const acceptedAt = new Date();
  const payloadText = JSON.stringify(input.payload);
  const changedEquipment = input.result.rows.filter(
    (row) =>
      input.previous.equipmentStatuses.has(row.equipmentSourceKey) &&
      input.previous.equipmentStatuses.get(row.equipmentSourceKey) !== row.equipmentStatus,
  );
  const classification: CollectionClassification =
    changedEquipment.length > 0
      ? "semantic_service_change"
      : "healthy_no_change";
  const currentStationStatuses = new Map(
    input.result.rows.map((row) => [row.stationName, row.stationAccessibility]),
  );
  const stationIds = new Map<string, string>();
  const equipmentIds = new Map<string, string>();

  await db.transaction(async (transaction) => {
    await transaction.insert(rawPayloads).values({
      collectionRunId: input.runId,
      payloadHash: sha256Json(input.payload),
      mediaType: "application/json",
      body: input.payload,
      byteLength: new TextEncoder().encode(payloadText).byteLength,
      expiresAt: new Date(input.collectedAt.getTime() + RAW_RETENTION_MS),
    });

    for (const definition of SFMTA_STATIONS) {
      const [station] = await transaction
        .insert(stations)
        .values({
          slug: definition.slug,
          sourceName: definition.sourceName,
          displayName: definition.displayName,
          corridorOrder: definition.corridorOrder,
          reportedAccessibility:
            currentStationStatuses.get(definition.sourceName) ?? "unknown",
          updatedAt: acceptedAt,
        })
        .onConflictDoUpdate({
          target: stations.slug,
          set: {
            sourceName: definition.sourceName,
            displayName: definition.displayName,
            corridorOrder: definition.corridorOrder,
            reportedAccessibility:
              currentStationStatuses.get(definition.sourceName) ?? "unknown",
            active: true,
            updatedAt: acceptedAt,
          },
        })
        .returning({ id: stations.id });
      if (!station) throw new Error(`Could not save station: ${definition.sourceName}`);
      stationIds.set(definition.sourceName, station.id);
    }

    for (const row of input.result.rows) {
      const stationId = stationIds.get(row.stationName);
      const definition = getStationDefinition(row.stationName);
      if (!stationId || !definition) {
        throw new Error(`Validated station identity was not found: ${row.stationName}`);
      }

      const [savedEquipment] = await transaction
        .insert(equipment)
        .values({
          stationId,
          sourceKey: row.equipmentSourceKey,
          sourceName: row.equipmentName,
          displayName: row.equipmentName.replace(/^Elevator\s+/i, ""),
          equipmentType: "elevator",
          updatedAt: acceptedAt,
        })
        .onConflictDoUpdate({
          target: equipment.sourceKey,
          set: {
            stationId,
            sourceName: row.equipmentName,
            displayName: row.equipmentName.replace(/^Elevator\s+/i, ""),
            active: true,
            updatedAt: acceptedAt,
          },
        })
        .returning({ id: equipment.id });
      if (!savedEquipment) {
        throw new Error(`Could not save equipment: ${row.equipmentSourceKey}`);
      }
      equipmentIds.set(row.equipmentSourceKey, savedEquipment.id);

      await transaction.insert(observations).values({
        collectionRunId: input.runId,
        stationId,
        equipmentId: savedEquipment.id,
        equipmentStatus: row.equipmentStatus,
        reportedStationAccessibility: row.stationAccessibility,
        sourceValidAt: row.sourceValidAt,
        sourceLastChangedAt: row.sourceLastChangedAt,
        observedAt: input.collectedAt,
        rawFields: row.raw as unknown as Record<string, unknown>,
        normalizedHash: sha256Json({
          stationName: row.stationName,
          equipmentName: row.equipmentName,
          equipmentStatus: row.equipmentStatus,
          stationAccessibility: row.stationAccessibility,
          sourceValidAt: row.sourceValidAt.toISOString(),
          sourceLastChangedAt: row.sourceLastChangedAt?.toISOString() ?? null,
        }),
      });
    }

    for (const row of changedEquipment) {
      await transaction.insert(equipmentStatusEvents).values({
        equipmentId: equipmentIds.get(row.equipmentSourceKey)!,
        collectionRunId: input.runId,
        fromStatus: input.previous.equipmentStatuses.get(row.equipmentSourceKey)!,
        toStatus: row.equipmentStatus,
        effectiveAt: row.sourceLastChangedAt,
        observedAt: input.collectedAt,
        acceptedAt,
      });
    }

    if (input.previous.collectionRunId) {
      for (const [stationName, status] of currentStationStatuses) {
        const previousStatus = input.previous.stationStatuses.get(stationName);
        if (previousStatus && previousStatus !== status) {
          await transaction.insert(stationStatusEvents).values({
            stationId: stationIds.get(stationName)!,
            collectionRunId: input.runId,
            fromStatus: previousStatus,
            toStatus: status,
            acceptedAt,
            reason: "trusted_sfmta_station_status_change",
          });
        }
      }
    }

    if (changedEquipment.length > 0) {
      const affectedStationIds = [
        ...new Set(
          changedEquipment.map((row) => stationIds.get(row.stationName)!),
        ),
      ];
      await transaction.insert(routeRecalculations).values({
        collectionRunId: input.runId,
        reason: "trusted_equipment_status_change",
        affectedStationIds,
        affectedRouteCount: 0,
        startedAt: acceptedAt,
        finishedAt: acceptedAt,
      });
    }

    const firstRow = input.result.rows[0];
    if (!firstRow) throw new Error("Validated collection did not contain rows.");
    const sourceValidAt = firstRow.sourceValidAt;
    await transaction.insert(trustedSnapshots).values({
      collectionRunId: input.runId,
      trustState: "current",
      structuralFingerprint: input.result.report.structuralFingerprint!,
      sourceValidAt,
      collectedAt: input.collectedAt,
      acceptedAt,
      summary: {
        rowCount: input.result.report.rowCount,
        stationCount: input.result.report.stationCount,
        statusCounts: countStatuses(input.result.rows),
        changedEquipmentCount: changedEquipment.length,
      },
    });
    await transaction
      .update(collectionRuns)
      .set({
        collectionId: input.collectionId,
        status: "accepted",
        classification,
        sourceValidAt,
        collectedAt: input.collectedAt,
        acceptedAt,
        finishedAt: acceptedAt,
        rowCount: input.result.report.rowCount,
        stationCount: input.result.report.stationCount,
        structuralFingerprint: input.result.report.structuralFingerprint,
        contractReport: input.result.report as unknown as Record<string, unknown>,
        reasonCodes: input.result.report.reasonCodes,
      })
      .where(eq(collectionRuns.id, input.runId));
    await transaction.insert(componentChecks).values([
      {
        component: "bright_data",
        status: "operational",
        message: "Collector returned a completed dataset.",
        metadata: { runId: input.runId, collectionId: input.collectionId },
        checkedAt: acceptedAt,
      },
      {
        component: "validator",
        status: "operational",
        message: `Contract accepted ${input.result.report.rowCount} elevator rows.`,
        metadata: { runId: input.runId, classification },
        checkedAt: acceptedAt,
      },
      {
        component: "publisher",
        status: "operational",
        message: "Trusted snapshot published atomically.",
        metadata: { runId: input.runId, changedEquipmentCount: changedEquipment.length },
        checkedAt: acceptedAt,
      },
    ]);
  });

  return {
    runId: input.runId,
    collectionId: input.collectionId,
    status: "accepted" as const,
    classification,
    rowCount: input.result.report.rowCount,
    stationCount: input.result.report.stationCount,
    changedEquipmentCount: changedEquipment.length,
    sourceValidAt: input.result.report.sourceValidAt,
  };
}

export async function runCollection(trigger: CollectionTrigger) {
  const reserved = await sql.reserve();
  const [lockResult] = await reserved<{ acquired: boolean }[]>`
    select pg_try_advisory_lock(${COLLECTION_LOCK_KEY}) as acquired
  `;
  const acquired = lockResult?.acquired ?? false;
  if (!acquired) {
    reserved.release();
    throw new CollectionOverlapError();
  }

  let runId: string | null = null;
  const startedAt = new Date();
  try {
    const env = getServerEnv();
    const [run] = await db
      .insert(collectionRuns)
      .values({
        collectorId: env.BRIGHTDATA_COLLECTOR_ID,
        trigger,
        status: "collecting",
        contractVersion: COLLECTION_CONTRACT_VERSION,
        startedAt,
      })
      .returning({ id: collectionRuns.id });
    if (!run) throw new Error("Could not create a collection run.");
    runId = run.id;

    const collectionId = await triggerBrightDataCollection(env);
    await db
      .update(collectionRuns)
      .set({ collectionId })
      .where(eq(collectionRuns.id, runId));
    const payload = await downloadBrightDataDataset(env, collectionId);
    const collectedAt = new Date();
    await db
      .update(collectionRuns)
      .set({ status: "validating", collectedAt })
      .where(eq(collectionRuns.id, runId));

    const previous = await latestTrustedState();
    const result = validateCollectorDataset({
      payload,
      collectedAt,
      expectedSourceUrl: env.SFMTA_SOURCE_URL,
      previousStructuralFingerprint: previous.structuralFingerprint,
    });

    if (!result.accepted) {
      await recordRejectedRun({
        runId,
        collectionId,
        payload,
        collectedAt,
        result,
      });
      await detectIncidentWithoutAffectingRun(runId);
      return {
        runId,
        collectionId,
        status: "rejected" as const,
        classification: result.classification,
        rowCount: result.report.rowCount,
        stationCount: result.report.stationCount,
        reasonCodes: result.report.reasonCodes,
        sourceValidAt: result.report.sourceValidAt,
      };
    }

    return await publishTrustedRun({
      runId,
      collectionId,
      payload,
      collectedAt,
      previous,
      result,
    });
  } catch (error) {
    const safe = safeError(error);
    if (runId) {
      const failedAt = new Date();
      await db
        .update(collectionRuns)
        .set({
          status: "failed",
          classification: "source_unavailable",
          finishedAt: failedAt,
          errorCode: safe.code,
          errorSummary: safe.summary,
          reasonCodes: [safe.code],
        })
        .where(eq(collectionRuns.id, runId));
      await db.insert(componentChecks).values({
        component: "bright_data",
        status: "outage",
        message: safe.summary,
        metadata: { runId, errorCode: safe.code, retryable: safe.retryable },
        checkedAt: failedAt,
      });
      await detectIncidentWithoutAffectingRun(runId);
    }
    throw error;
  } finally {
    await reserved`select pg_advisory_unlock(${COLLECTION_LOCK_KEY})`;
    reserved.release();
  }
}

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
