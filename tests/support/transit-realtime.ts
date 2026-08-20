import { randomUUID } from "node:crypto";

import type {
  RealtimeFeedType,
  TrustedRealtimeSnapshot,
} from "../../src/domain/transit/realtime";
import type {
  PollReasonCode,
  RawRealtimeFeed,
  RealtimePollDependencies,
  RealtimeSnapshotStore,
  StaticRealtimeReferences,
} from "../../src/server/transit/realtime";

export function staticReferences(
  snapshotId = "static-a",
): StaticRealtimeReferences {
  return {
    snapshotId,
    routeIds: new Set(["ROUTE-1", "ROUTE-2"]),
    stopIds: new Set(["STOP-1", "STOP-2"]),
    tripRoutes: new Map([
      ["TRIP-1", "ROUTE-1"],
      ["TRIP-2", "ROUTE-2"],
    ]),
  };
}

export function tripFeed(sourceUpdatedAt: Date): RawRealtimeFeed {
  return {
    headerTimestamp: sourceUpdatedAt.getTime() / 1000,
    incrementality: 0,
    entities: [
      {
        kind: "trip_update",
        entityId: "cancelled",
        tripId: "TRIP-1",
        routeId: "ROUTE-1",
        scheduleRelationship: "CANCELED",
        stopTimeUpdates: [],
      },
      {
        kind: "trip_update",
        entityId: "delayed",
        tripId: "TRIP-2",
        routeId: "ROUTE-2",
        scheduleRelationship: "SCHEDULED",
        stopTimeUpdates: [
          {
            stopId: "STOP-2",
            stopSequence: 2,
            arrivalDelaySeconds: 120,
            departureDelaySeconds: 180,
            arrivalTime: Date.parse("2026-08-20T12:06:00.000Z") / 1000,
            departureTime: Date.parse("2026-08-20T12:07:00.000Z") / 1000,
          },
        ],
      },
    ],
  };
}

type Claim = {
  id: string;
  feedType: RealtimeFeedType;
  at: Date;
  baseline: string;
  outcome?: string;
  reasons?: PollReasonCode[];
};

export class MemoryRealtimeStore implements RealtimeSnapshotStore {
  readonly claims: Claim[] = [];
  readonly trusted = new Map<RealtimeFeedType, TrustedRealtimeSnapshot>();
  readonly trustedBaselines = new Map<RealtimeFeedType, string>();
  constructor(public references: StaticRealtimeReferences) {}
  async claimPoll(input: {
    feedType: RealtimeFeedType;
    at: Date;
    cadenceMs: number;
  }) {
    const recent = this.claims.filter(
      (claim) =>
        claim.at > new Date(input.at.getTime() - 3_600_000) &&
        claim.at <= input.at,
    );
    if (recent.length >= 52) return { status: "deferred" as const };
    const latest = recent
      .filter((claim) => claim.feedType === input.feedType)
      .sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    if (latest && input.at.getTime() - latest.at.getTime() < input.cadenceMs)
      return { status: "not_due" as const };
    const claim = {
      id: `claim:${randomUUID()}`,
      feedType: input.feedType,
      at: new Date(input.at),
      baseline: this.references.snapshotId,
    };
    this.claims.push(claim);
    return {
      status: "claimed" as const,
      claimId: claim.id,
      transitSnapshotId: claim.baseline,
      startedAt: new Date(input.at),
    };
  }
  async recordClaimOutcome(input: {
    claimId: string;
    outcome: "accepted" | "rejected" | "unavailable";
    bodyBytes: number;
    contentType: string | null;
    payloadHash: string | null;
    reasons: PollReasonCode[];
  }) {
    const claim = this.claims.find(
      (candidate) => candidate.id === input.claimId,
    );
    if (claim) {
      claim.outcome = input.outcome;
      claim.reasons = [...input.reasons];
    }
  }
  async applyTrustedSnapshot(input: {
    claimId: string;
    baselineSnapshotId: string;
    payloadHash: string;
    entityCount: number;
    snapshot: TrustedRealtimeSnapshot;
  }) {
    if (input.baselineSnapshotId !== this.references.snapshotId)
      return "stale_baseline" as const;
    this.trusted.set(input.snapshot.feedType, structuredClone(input.snapshot));
    this.trustedBaselines.set(
      input.snapshot.feedType,
      input.baselineSnapshotId,
    );
    return "accepted" as const;
  }
  async getTrustedSnapshot(feedType: RealtimeFeedType, at: Date) {
    const snapshot = this.trusted.get(feedType);
    return snapshot &&
      this.trustedBaselines.get(feedType) === this.references.snapshotId &&
      snapshot.checkedAt <= at &&
      snapshot.expiresAt >= at
      ? structuredClone(snapshot)
      : null;
  }
}

export function realtimeDependencies(
  store: MemoryRealtimeStore,
  feed: RawRealtimeFeed,
): RealtimePollDependencies {
  return {
    store,
    source: {
      load: async () => ({
        body: new Uint8Array([1]),
        bodyBytes: 1,
        contentType: "application/x-protobuf",
        checkedAt: new Date("2026-08-20T12:04:02.000Z"),
      }),
    },
    decoder: { decode: () => structuredClone(feed) },
    references: {
      load: async (snapshotId) =>
        snapshotId === store.references.snapshotId ? store.references : null,
    },
  };
}
