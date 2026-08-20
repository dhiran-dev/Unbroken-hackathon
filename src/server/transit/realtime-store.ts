import { randomUUID } from "node:crypto";

import { and, eq, gt, gte, lte, sql as drizzleSql } from "drizzle-orm";

import type {
  RealtimeFeedType,
  ServiceAlertView,
  TrustedRealtimeSnapshot,
  VehicleView,
} from "@/domain/transit/realtime";
import { db as applicationDatabase } from "@/server/db/client";
import {
  realtimeAlerts,
  realtimeFeedSnapshots,
  realtimeTripUpdates,
  realtimeVehiclePositions,
  transitFeedSnapshots,
  transitRoutes,
  transitStops,
  transitTrips,
} from "@/server/db/schema/transit";
import type {
  PollReasonCode,
  RealtimeSnapshotStore,
  StaticRealtimeReferences,
} from "@/server/transit/realtime";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const BUDGET_LOCK_ID = 1_431_196_245;
const REQUEST_BUDGET = 52;

function json(value: object) {
  return value as Record<string, unknown>;
}

function trustedReport(feedType: RealtimeFeedType, payloadHash: string) {
  return json({ kind: "trusted", feedType, payloadHash });
}

async function activeSnapshotId(database: Database | Transaction) {
  const active = await database.query.transitFeedSnapshots.findFirst({
    columns: { id: true },
    where: eq(transitFeedSnapshots.status, "active"),
    orderBy: (table, { desc }) => [desc(table.acceptedAt)],
  });
  return active?.id ?? null;
}

function safeDate(value: unknown) {
  const date =
    value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseAlertPeriods(value: unknown) {
  if (!Array.isArray(value)) return null;
  const periods: ServiceAlertView["activePeriods"] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") return null;
    const period = raw as Record<string, unknown>;
    const startsAt =
      period.startsAt === null ? null : safeDate(period.startsAt);
    const endsAt = period.endsAt === null ? null : safeDate(period.endsAt);
    if (period.startsAt !== null && !startsAt) return null;
    if (period.endsAt !== null && !endsAt) return null;
    periods.push({ startsAt, endsAt });
  }
  return periods;
}

function parseInformedEntities(value: unknown) {
  if (!Array.isArray(value)) return null;
  return value.every(
    (entity) =>
      entity &&
      typeof entity === "object" &&
      ["agencyId", "routeId", "tripId", "stopId"].every((key) => {
        const field = (entity as Record<string, unknown>)[key];
        return field === null || typeof field === "string";
      }),
  )
    ? (value as ServiceAlertView["informedEntities"])
    : null;
}

export class PostgresRealtimeSnapshotStore implements RealtimeSnapshotStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async claimPoll(input: {
    feedType: RealtimeFeedType;
    at: Date;
    cadenceMs: number;
  }) {
    if (
      !Number.isFinite(input.at.getTime()) ||
      !Number.isSafeInteger(input.cadenceMs) ||
      input.cadenceMs < 0
    ) {
      return { status: "deferred" as const };
    }
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`select pg_advisory_xact_lock(${BUDGET_LOCK_ID})`,
      );
      const clockRows = await transaction.execute(
        drizzleSql`select clock_timestamp() as now`,
      );
      const claimedAt = safeDate(
        (clockRows[0] as { now?: unknown } | undefined)?.now,
      );
      const baseline = await activeSnapshotId(transaction);
      if (!claimedAt || !baseline) return { status: "deferred" as const };
      const windowStart = new Date(claimedAt.getTime() - 3_600_000);
      const [budget] = await transaction
        .select({ value: drizzleSql<number>`count(*)::int` })
        .from(realtimeFeedSnapshots)
        .where(
          and(
            gt(realtimeFeedSnapshots.checkedAt, windowStart),
            lte(realtimeFeedSnapshots.checkedAt, claimedAt),
            drizzleSql`${realtimeFeedSnapshots.validationReport}->>'kind' = 'poll_claim'`,
          ),
        );
      if (Number(budget?.value ?? 0) >= REQUEST_BUDGET) {
        return { status: "deferred" as const };
      }
      const latest = await transaction.query.realtimeFeedSnapshots.findFirst({
        columns: { checkedAt: true },
        where: and(
          eq(realtimeFeedSnapshots.feedType, input.feedType),
          lte(realtimeFeedSnapshots.checkedAt, claimedAt),
          drizzleSql`${realtimeFeedSnapshots.validationReport}->>'kind' = 'poll_claim'`,
        ),
        orderBy: (table, { desc }) => [desc(table.checkedAt)],
      });
      if (
        latest &&
        claimedAt.getTime() - latest.checkedAt.getTime() < input.cadenceMs
      ) {
        return { status: "not_due" as const };
      }
      const claimId = randomUUID();
      await transaction.insert(realtimeFeedSnapshots).values({
        id: claimId,
        transitSnapshotId: baseline,
        feedType: input.feedType,
        payloadHash: `claim:${claimId}`,
        checkedAt: claimedAt,
        sourceUpdatedAt: null,
        valid: false,
        validationReport: json({
          kind: "poll_claim",
          outcome: "claimed",
          reasonCodes: [],
        }),
        entityCount: 0,
        expiresAt: claimedAt,
      });
      return {
        status: "claimed" as const,
        claimId,
        transitSnapshotId: baseline,
        startedAt: claimedAt,
      };
    });
  }

  async recordClaimOutcome(input: {
    claimId: string;
    outcome: "accepted" | "rejected" | "unavailable";
    bodyBytes: number;
    contentType: string | null;
    payloadHash: string | null;
    reasons: PollReasonCode[];
  }) {
    await this.database
      .update(realtimeFeedSnapshots)
      .set({
        validationReport: json({
          kind: "poll_claim",
          outcome: input.outcome,
          bodyBytes:
            Number.isSafeInteger(input.bodyBytes) && input.bodyBytes >= 0
              ? input.bodyBytes
              : 0,
          contentType:
            input.contentType &&
            input.contentType.length <= 120 &&
            !/[<>\u0000-\u001f\u007f]/u.test(input.contentType)
              ? input.contentType
              : null,
          bodyHash:
            input.payloadHash && /^[a-f0-9]{64}$/u.test(input.payloadHash)
              ? input.payloadHash
              : null,
          reasonCodes: [...new Set(input.reasons)].sort(),
        }),
      })
      .where(
        and(
          eq(realtimeFeedSnapshots.id, input.claimId),
          drizzleSql`${realtimeFeedSnapshots.validationReport}->>'kind' = 'poll_claim'`,
        ),
      );
  }

  async applyTrustedSnapshot(input: {
    claimId: string;
    baselineSnapshotId: string;
    payloadHash: string;
    entityCount: number;
    snapshot: TrustedRealtimeSnapshot;
  }) {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(
        drizzleSql`select pg_advisory_xact_lock(${BUDGET_LOCK_ID})`,
      );
      if ((await activeSnapshotId(transaction)) !== input.baselineSnapshotId) {
        return "stale_baseline" as const;
      }
      const claim = await transaction.query.realtimeFeedSnapshots.findFirst({
        columns: { id: true, transitSnapshotId: true, feedType: true },
        where: and(
          eq(realtimeFeedSnapshots.id, input.claimId),
          drizzleSql`${realtimeFeedSnapshots.validationReport}->>'kind' = 'poll_claim'`,
        ),
      });
      if (
        !claim ||
        claim.transitSnapshotId !== input.baselineSnapshotId ||
        claim.feedType !== input.snapshot.feedType
      ) {
        return "stale_baseline" as const;
      }
      const existing = await transaction.query.realtimeFeedSnapshots.findFirst({
        where: and(
          eq(realtimeFeedSnapshots.feedType, input.snapshot.feedType),
          eq(realtimeFeedSnapshots.payloadHash, input.payloadHash),
        ),
      });
      const report = trustedReport(input.snapshot.feedType, input.payloadHash);
      if (existing) {
        if (
          !existing.valid ||
          (existing.validationReport as { kind?: unknown }).kind !==
            "trusted" ||
          input.snapshot.checkedAt < existing.checkedAt
        ) {
          return "stale_baseline" as const;
        }
        await transaction
          .update(realtimeFeedSnapshots)
          .set({
            transitSnapshotId: input.baselineSnapshotId,
            checkedAt: input.snapshot.checkedAt,
            sourceUpdatedAt: input.snapshot.sourceUpdatedAt,
            expiresAt: input.snapshot.expiresAt,
            entityCount: input.entityCount,
            validationReport: report,
          })
          .where(eq(realtimeFeedSnapshots.id, existing.id));
        return "accepted" as const;
      }
      const [inserted] = await transaction
        .insert(realtimeFeedSnapshots)
        .values({
          transitSnapshotId: input.baselineSnapshotId,
          feedType: input.snapshot.feedType,
          payloadHash: input.payloadHash,
          checkedAt: input.snapshot.checkedAt,
          sourceUpdatedAt: input.snapshot.sourceUpdatedAt,
          valid: true,
          validationReport: report,
          entityCount: input.entityCount,
          expiresAt: input.snapshot.expiresAt,
        })
        .returning({ id: realtimeFeedSnapshots.id });
      if (!inserted) return "stale_baseline" as const;
      if (input.snapshot.feedType === "trip_updates") {
        if (input.snapshot.tripUpdates.length > 0) {
          await transaction.insert(realtimeTripUpdates).values(
            input.snapshot.tripUpdates.map((update) => ({
              snapshotId: inserted.id,
              ...update,
            })),
          );
        }
      } else if (input.snapshot.feedType === "vehicles") {
        if (input.snapshot.vehicles.length > 0) {
          await transaction.insert(realtimeVehiclePositions).values(
            input.snapshot.vehicles.map((vehicle) => ({
              snapshotId: inserted.id,
              ...vehicle,
            })),
          );
        }
      } else if (input.snapshot.alerts.length > 0) {
        await transaction.insert(realtimeAlerts).values(
          input.snapshot.alerts.map((alert) => ({
            snapshotId: inserted.id,
            ...alert,
          })),
        );
      }
      return "accepted" as const;
    });
  }

  async getTrustedSnapshot(feedType: RealtimeFeedType, at: Date) {
    if (!Number.isFinite(at.getTime())) return null;
    const activeId = await activeSnapshotId(this.database);
    if (!activeId) return null;
    const snapshot = await this.database.query.realtimeFeedSnapshots.findFirst({
      where: and(
        eq(realtimeFeedSnapshots.transitSnapshotId, activeId),
        eq(realtimeFeedSnapshots.feedType, feedType),
        eq(realtimeFeedSnapshots.valid, true),
        lte(realtimeFeedSnapshots.checkedAt, at),
        gte(realtimeFeedSnapshots.expiresAt, at),
        drizzleSql`${realtimeFeedSnapshots.validationReport}->>'kind' = 'trusted'`,
      ),
      orderBy: (table, { desc }) => [desc(table.checkedAt)],
    });
    if (!snapshot?.sourceUpdatedAt) return null;
    const result: TrustedRealtimeSnapshot = {
      feedType,
      checkedAt: snapshot.checkedAt,
      sourceUpdatedAt: snapshot.sourceUpdatedAt,
      sourceUrl: "https://511.org/open-data/transit",
      expiresAt: snapshot.expiresAt,
      tripUpdates: [],
      vehicles: [],
      alerts: [],
    };
    if (feedType === "trip_updates") {
      result.tripUpdates =
        await this.database.query.realtimeTripUpdates.findMany({
          where: eq(realtimeTripUpdates.snapshotId, snapshot.id),
          orderBy: (table, { asc }) => [asc(table.updateId)],
        });
    } else if (feedType === "vehicles") {
      const vehicles =
        await this.database.query.realtimeVehiclePositions.findMany({
          where: eq(realtimeVehiclePositions.snapshotId, snapshot.id),
          orderBy: (table, { asc }) => [asc(table.entityId)],
        });
      if (
        vehicles.some(
          (vehicle) =>
            !vehicle.tripId || !vehicle.routeId || !vehicle.observedAt,
        )
      ) {
        return null;
      }
      result.vehicles = vehicles.map((vehicle): VehicleView => ({
        entityId: vehicle.entityId,
        vehicleId: vehicle.vehicleId,
        label: vehicle.label,
        tripId: vehicle.tripId!,
        routeId: vehicle.routeId!,
        stopId: vehicle.stopId,
        currentStopSequence: vehicle.currentStopSequence,
        currentStatus: vehicle.currentStatus,
        latitude: vehicle.latitude,
        longitude: vehicle.longitude,
        bearing: vehicle.bearing,
        speedMetersPerSecond: vehicle.speedMetersPerSecond,
        observedAt: vehicle.observedAt!,
      }));
    } else {
      const alerts = await this.database.query.realtimeAlerts.findMany({
        where: eq(realtimeAlerts.snapshotId, snapshot.id),
        orderBy: (table, { asc }) => [asc(table.entityId)],
      });
      for (const alert of alerts) {
        const activePeriods = parseAlertPeriods(alert.activePeriods);
        const informedEntities = parseInformedEntities(alert.informedEntities);
        if (!activePeriods || !informedEntities) return null;
        result.alerts.push({ ...alert, activePeriods, informedEntities });
      }
    }
    if ((await activeSnapshotId(this.database)) !== activeId) return null;
    return result;
  }
}

export class PostgresRealtimeReferenceSource {
  private cached: StaticRealtimeReferences | null = null;

  constructor(private readonly database: Database = applicationDatabase) {}

  async load(snapshotId: string) {
    if (this.cached?.snapshotId === snapshotId) return this.cached;
    if ((await activeSnapshotId(this.database)) !== snapshotId) return null;
    const [routes, stops, trips] = await Promise.all([
      this.database
        .select({ routeId: transitRoutes.routeId })
        .from(transitRoutes)
        .where(eq(transitRoutes.snapshotId, snapshotId)),
      this.database
        .select({ stopId: transitStops.stopId })
        .from(transitStops)
        .where(eq(transitStops.snapshotId, snapshotId)),
      this.database
        .select({ tripId: transitTrips.tripId, routeId: transitTrips.routeId })
        .from(transitTrips)
        .where(eq(transitTrips.snapshotId, snapshotId)),
    ]);
    if ((await activeSnapshotId(this.database)) !== snapshotId) return null;
    this.cached = {
      snapshotId,
      routeIds: new Set(routes.map((route) => route.routeId)),
      stopIds: new Set(stops.map((stop) => stop.stopId)),
      tripRoutes: new Map(trips.map((trip) => [trip.tripId, trip.routeId])),
    };
    return this.cached;
  }
}
