import { createHash } from "node:crypto";

import type {
  RealtimeFeedType,
  ServiceAlertView,
  TripUpdate,
  TrustedRealtimeSnapshot,
  VehicleView,
} from "@/domain/transit/realtime";
import {
  validateAlertEntities,
  validateRealtimeTransport,
  validateVehicleEntities,
} from "@/server/transit/realtime-validation";

export type StaticRealtimeReferences = {
  snapshotId: string;
  routeIds: Set<string>;
  stopIds: Set<string>;
  tripRoutes: Map<string, string>;
};

export type RawTripStopUpdate = {
  stopId?: unknown;
  stopSequence?: unknown;
  arrivalDelaySeconds?: unknown;
  departureDelaySeconds?: unknown;
  arrivalTime?: unknown;
  departureTime?: unknown;
};

export type RawRealtimeEntity =
  | {
      kind: "trip_update";
      entityId: unknown;
      tripId: unknown;
      routeId?: unknown;
      scheduleRelationship?: unknown;
      stopTimeUpdates?: unknown;
    }
  | ({ kind: "vehicle" } & Record<string, unknown>)
  | ({ kind: "alert" } & Record<string, unknown>);

export type RawRealtimeFeed = {
  headerTimestamp: unknown;
  incrementality?: unknown;
  entities: unknown;
  sourceEntityCount?: unknown;
};

export type RealtimeSourceResponse = {
  body: Uint8Array;
  bodyBytes: number;
  contentType: string;
  checkedAt: Date;
};

export type PollReasonCode =
  | "FETCH_FAILED"
  | "DECODE_FAILED"
  | "INVALID_HEADER_TIME"
  | "STALE_HEADER"
  | "FUTURE_HEADER"
  | "DIFFERENTIAL_FEED"
  | "INVALID_ENTITY"
  | "DUPLICATE_ENTITY"
  | "UNKNOWN_ROUTE"
  | "UNKNOWN_TRIP"
  | "UNKNOWN_STOP"
  | "ROUTE_MISMATCH"
  | "INVALID_DELAY"
  | "INVALID_EVENT_TIME"
  | "INVALID_POSITION"
  | "INVALID_BEARING"
  | "INVALID_SPEED"
  | "INVALID_ACTIVE_PERIOD"
  | "INVALID_TEXT"
  | "INVALID_URL"
  | "INVALID_INFORMED_ENTITY"
  | "OVERSIZE_BODY"
  | "INVALID_CONTENT_TYPE"
  | "INVALID_CHECKED_TIME"
  | "STALE_STATIC_BASELINE";

export type PollResult =
  | {
      status: "accepted";
      feedType: RealtimeFeedType;
      entityCount: number;
      checkedAt: Date;
      sourceUpdatedAt: Date;
      expiresAt: Date;
    }
  | {
      status: "rejected" | "unavailable";
      feedType: RealtimeFeedType;
      reasons: PollReasonCode[];
    }
  | { status: "deferred" | "not_due"; feedType: RealtimeFeedType };

export type PollClaim =
  | {
      status: "claimed";
      claimId: string;
      transitSnapshotId: string;
      startedAt: Date;
    }
  | { status: "deferred" | "not_due" };

export interface RealtimeSnapshotStore {
  claimPoll(input: {
    feedType: RealtimeFeedType;
    at: Date;
    cadenceMs: number;
  }): Promise<PollClaim>;
  recordClaimOutcome(input: {
    claimId: string;
    outcome: "accepted" | "rejected" | "unavailable";
    bodyBytes: number;
    contentType: string | null;
    payloadHash: string | null;
    reasons: PollReasonCode[];
  }): Promise<void>;
  applyTrustedSnapshot(input: {
    claimId: string;
    baselineSnapshotId: string;
    payloadHash: string;
    entityCount: number;
    snapshot: TrustedRealtimeSnapshot;
  }): Promise<"accepted" | "stale_baseline">;
}

export type RealtimePollDependencies = {
  store: RealtimeSnapshotStore;
  source: {
    load(
      feedType: RealtimeFeedType,
      startedAt: Date,
    ): Promise<RealtimeSourceResponse>;
  };
  decoder: {
    decode(
      feedType: RealtimeFeedType,
      response: RealtimeSourceResponse,
    ): RawRealtimeFeed;
  };
  references: {
    load(snapshotId: string): Promise<StaticRealtimeReferences | null>;
  };
};

const cadence = {
  trip_updates: 150_000,
  vehicles: 180_000,
  alerts: 600_000,
} as const;
const freshness = {
  trip_updates: 300_000,
  vehicles: 300_000,
  alerts: 900_000,
} as const;
const safeRelationships = new Set([
  "SCHEDULED",
  "ADDED",
  "UNSCHEDULED",
  "CANCELED",
  "DELETED",
  "REPLACEMENT",
  "DUPLICATED",
  "NEW",
]);

function safeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function safeOptionalInteger(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null) return null;
  return safeInteger(value) ?? "invalid";
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sourceEntityCount(feed: RawRealtimeFeed) {
  return typeof feed.sourceEntityCount === "number" &&
    Number.isSafeInteger(feed.sourceEntityCount) &&
    feed.sourceEntityCount >= 0
    ? feed.sourceEntityCount
    : Array.isArray(feed.entities)
      ? feed.entities.length
      : 0;
}

function normalizedId(value: unknown) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    value.trim() === value &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

function updateId(
  entityId: string,
  tripId: string,
  stopId?: string,
  sequence?: number,
) {
  return (
    "tu:" +
    createHash("sha256")
      .update(
        JSON.stringify([entityId, tripId, stopId ?? null, sequence ?? null]),
      )
      .digest("hex")
  );
}

function validateHeader(
  feed: RawRealtimeFeed,
  checkedAt: Date,
  feedType: RealtimeFeedType,
) {
  const reasons: PollReasonCode[] = [];
  const timestamp = safeInteger(feed.headerTimestamp);
  if (timestamp === null || timestamp < 0) reasons.push("INVALID_HEADER_TIME");
  const sourceUpdatedAt =
    timestamp === null ? null : new Date(timestamp * 1000);
  if (sourceUpdatedAt && !Number.isFinite(sourceUpdatedAt.getTime())) {
    reasons.push("INVALID_HEADER_TIME");
  }
  if (
    sourceUpdatedAt &&
    sourceUpdatedAt.getTime() > checkedAt.getTime() + 60_000
  )
    reasons.push("FUTURE_HEADER");
  if (
    sourceUpdatedAt &&
    checkedAt.getTime() - sourceUpdatedAt.getTime() > freshness[feedType]
  )
    reasons.push("STALE_HEADER");
  if (
    feed.incrementality !== undefined &&
    feed.incrementality !== 0 &&
    feed.incrementality !== "FULL_DATASET"
  )
    reasons.push("DIFFERENTIAL_FEED");
  return { reasons, sourceUpdatedAt };
}

function validateTrips(
  feed: RawRealtimeFeed,
  references: StaticRealtimeReferences,
  sourceUpdatedAt: Date,
) {
  const reasons: PollReasonCode[] = [];
  const updates: TripUpdate[] = [];
  if (!Array.isArray(feed.entities))
    return { reasons: ["INVALID_ENTITY"] as PollReasonCode[], updates };
  const entities = feed.entities as RawRealtimeEntity[];
  const entityIds = new Set<string>();
  const updateIds = new Set<string>();
  for (const entity of entities) {
    if (!entity || entity.kind !== "trip_update") {
      reasons.push("INVALID_ENTITY");
      continue;
    }
    const entityId = normalizedId(entity.entityId);
    const tripId = normalizedId(entity.tripId);
    const routeId =
      entity.routeId === undefined || entity.routeId === null
        ? null
        : normalizedId(entity.routeId);
    if (entity.routeId !== undefined && entity.routeId !== null && !routeId) {
      reasons.push("INVALID_ENTITY");
    }
    if (!entityId || !tripId) {
      reasons.push("INVALID_ENTITY");
      continue;
    }
    if (entityIds.has(entityId)) reasons.push("DUPLICATE_ENTITY");
    entityIds.add(entityId);
    const staticRoute = references.tripRoutes.get(tripId);
    if (!staticRoute) reasons.push("UNKNOWN_TRIP");
    if (routeId && !references.routeIds.has(routeId))
      reasons.push("UNKNOWN_ROUTE");
    if (routeId && staticRoute && routeId !== staticRoute)
      reasons.push("ROUTE_MISMATCH");
    const relationship =
      entity.scheduleRelationship === undefined ||
      entity.scheduleRelationship === null
        ? "SCHEDULED"
        : typeof entity.scheduleRelationship === "string"
          ? entity.scheduleRelationship
          : "";
    if (!safeRelationships.has(relationship)) reasons.push("INVALID_ENTITY");
    const rawStops =
      entity.stopTimeUpdates === undefined ? [] : entity.stopTimeUpdates;
    if (
      !Array.isArray(rawStops) ||
      (relationship !== "CANCELED" &&
        relationship !== "DELETED" &&
        rawStops.length === 0)
    ) {
      reasons.push("INVALID_ENTITY");
      continue;
    }
    if (rawStops.length === 0) {
      const id = updateId(entityId, tripId);
      if (updateIds.has(id)) reasons.push("DUPLICATE_ENTITY");
      updateIds.add(id);
      updates.push({
        updateId: id,
        entityId,
        tripId,
        routeId,
        scheduleRelationship: relationship,
        stopId: null,
        stopSequence: null,
        arrivalDelaySeconds: null,
        departureDelaySeconds: null,
        arrivalAt: null,
        departureAt: null,
      });
      continue;
    }
    for (const raw of rawStops as RawTripStopUpdate[]) {
      const stopId = normalizedId(raw.stopId);
      const sequence = safeOptionalInteger(raw.stopSequence);
      const arrivalDelay = safeOptionalInteger(raw.arrivalDelaySeconds);
      const departureDelay = safeOptionalInteger(raw.departureDelaySeconds);
      const arrivalTime = safeOptionalInteger(raw.arrivalTime);
      const departureTime = safeOptionalInteger(raw.departureTime);
      if (
        !stopId ||
        sequence === "invalid" ||
        sequence === null ||
        sequence < 0
      )
        reasons.push("INVALID_ENTITY");
      if (stopId && !references.stopIds.has(stopId))
        reasons.push("UNKNOWN_STOP");
      if (
        [arrivalDelay, departureDelay].some(
          (delay) =>
            delay === "invalid" ||
            (typeof delay === "number" && Math.abs(delay) > 21_600),
        )
      )
        reasons.push("INVALID_DELAY");
      if (
        [arrivalTime, departureTime].some(
          (time) =>
            time === "invalid" ||
            (typeof time === "number" &&
              (!Number.isFinite(new Date(time * 1000).getTime()) ||
                Math.abs(time * 1000 - sourceUpdatedAt.getTime()) >
                  86_400_000)),
        )
      )
        reasons.push("INVALID_EVENT_TIME");
      if (!stopId || typeof sequence !== "number") continue;
      const id = updateId(entityId, tripId, stopId, sequence);
      if (updateIds.has(id)) reasons.push("DUPLICATE_ENTITY");
      updateIds.add(id);
      updates.push({
        updateId: id,
        entityId,
        tripId,
        routeId,
        scheduleRelationship: relationship,
        stopId,
        stopSequence: sequence,
        arrivalDelaySeconds:
          typeof arrivalDelay === "number" ? arrivalDelay : null,
        departureDelaySeconds:
          typeof departureDelay === "number" ? departureDelay : null,
        arrivalAt:
          typeof arrivalTime === "number" ? new Date(arrivalTime * 1000) : null,
        departureAt:
          typeof departureTime === "number"
            ? new Date(departureTime * 1000)
            : null,
      });
    }
  }
  updates.sort((left, right) =>
    left.updateId < right.updateId
      ? -1
      : left.updateId > right.updateId
        ? 1
        : 0,
  );
  return { reasons, updates };
}

export async function pollRealtimeFeed(
  input: { feedType: RealtimeFeedType; at: Date },
  dependencies: RealtimePollDependencies,
): Promise<PollResult> {
  const claim = await dependencies.store.claimPoll({
    feedType: input.feedType,
    at: input.at,
    cadenceMs: cadence[input.feedType],
  });
  if (claim.status !== "claimed")
    return { status: claim.status, feedType: input.feedType };
  let response: RealtimeSourceResponse;
  try {
    response = await dependencies.source.load(input.feedType, claim.startedAt);
  } catch {
    await dependencies.store.recordClaimOutcome({
      claimId: claim.claimId,
      outcome: "unavailable",
      bodyBytes: 0,
      contentType: null,
      payloadHash: null,
      reasons: ["FETCH_FAILED"],
    });
    return {
      status: "unavailable",
      feedType: input.feedType,
      reasons: ["FETCH_FAILED"],
    };
  }
  const bodyHash = createHash("sha256").update(response.body).digest("hex");
  const transportReasons = validateRealtimeTransport(
    input.feedType,
    response,
    claim.startedAt,
  );
  if (transportReasons.length > 0) {
    await dependencies.store.recordClaimOutcome({
      claimId: claim.claimId,
      outcome: "rejected",
      bodyBytes: response.bodyBytes,
      contentType: response.contentType,
      payloadHash: bodyHash,
      reasons: transportReasons,
    });
    return {
      status: "rejected",
      feedType: input.feedType,
      reasons: transportReasons,
    };
  }
  let feed: RawRealtimeFeed;
  try {
    feed = dependencies.decoder.decode(input.feedType, response);
  } catch {
    await dependencies.store.recordClaimOutcome({
      claimId: claim.claimId,
      outcome: "rejected",
      bodyBytes: response.bodyBytes,
      contentType: response.contentType,
      payloadHash: bodyHash,
      reasons: ["DECODE_FAILED"],
    });
    return {
      status: "rejected",
      feedType: input.feedType,
      reasons: ["DECODE_FAILED"],
    };
  }
  const references = await dependencies.references.load(
    claim.transitSnapshotId,
  );
  if (!references || references.snapshotId !== claim.transitSnapshotId) {
    await dependencies.store.recordClaimOutcome({
      claimId: claim.claimId,
      outcome: "rejected",
      bodyBytes: response.bodyBytes,
      contentType: response.contentType,
      payloadHash: bodyHash,
      reasons: ["STALE_STATIC_BASELINE"],
    });
    return {
      status: "rejected",
      feedType: input.feedType,
      reasons: ["STALE_STATIC_BASELINE"],
    };
  }
  const header = validateHeader(feed, response.checkedAt, input.feedType);
  const trip =
    input.feedType === "trip_updates" && header.sourceUpdatedAt
      ? validateTrips(feed, references, header.sourceUpdatedAt)
      : { reasons: [] as PollReasonCode[], updates: [] as TripUpdate[] };
  const vehicle =
    input.feedType === "vehicles" && header.sourceUpdatedAt
      ? validateVehicleEntities(
          feed,
          references,
          header.sourceUpdatedAt,
          response.checkedAt,
        )
      : { reasons: [] as PollReasonCode[], vehicles: [] as VehicleView[] };
  const alert =
    input.feedType === "alerts"
      ? validateAlertEntities(feed, references)
      : { reasons: [] as PollReasonCode[], alerts: [] as ServiceAlertView[] };
  const reasons = [
    ...new Set([
      ...header.reasons,
      ...trip.reasons,
      ...vehicle.reasons,
      ...alert.reasons,
    ]),
  ].sort();
  if (!header.sourceUpdatedAt || reasons.length > 0) {
    await dependencies.store.recordClaimOutcome({
      claimId: claim.claimId,
      outcome: "rejected",
      bodyBytes: response.bodyBytes,
      contentType: response.contentType,
      payloadHash: bodyHash,
      reasons,
    });
    return { status: "rejected", feedType: input.feedType, reasons };
  }
  const expiresAt = new Date(
    header.sourceUpdatedAt.getTime() + freshness[input.feedType],
  );
  const snapshot: TrustedRealtimeSnapshot = {
    feedType: input.feedType,
    checkedAt: response.checkedAt,
    sourceUpdatedAt: header.sourceUpdatedAt,
    sourceUrl: "https://511.org/open-data/transit",
    expiresAt,
    tripUpdates: trip.updates,
    vehicles: vehicle.vehicles,
    alerts: alert.alerts,
  };
  const payloadHash = createHash("sha256")
    .update(
      canonical({
        tripUpdates: snapshot.tripUpdates,
        vehicles: snapshot.vehicles,
        alerts: snapshot.alerts,
      }),
    )
    .digest("hex");
  const applied = await dependencies.store.applyTrustedSnapshot({
    claimId: claim.claimId,
    baselineSnapshotId: claim.transitSnapshotId,
    payloadHash,
    entityCount: sourceEntityCount(feed),
    snapshot,
  });
  if (applied === "stale_baseline") {
    await dependencies.store.recordClaimOutcome({
      claimId: claim.claimId,
      outcome: "rejected",
      bodyBytes: response.bodyBytes,
      contentType: response.contentType,
      payloadHash: bodyHash,
      reasons: ["STALE_STATIC_BASELINE"],
    });
    return {
      status: "rejected",
      feedType: input.feedType,
      reasons: ["STALE_STATIC_BASELINE"],
    };
  }
  await dependencies.store.recordClaimOutcome({
    claimId: claim.claimId,
    outcome: "accepted",
    bodyBytes: response.bodyBytes,
    contentType: response.contentType,
    payloadHash: bodyHash,
    reasons: [],
  });
  return {
    status: "accepted",
    feedType: input.feedType,
    entityCount: sourceEntityCount(feed),
    checkedAt: response.checkedAt,
    sourceUpdatedAt: header.sourceUpdatedAt,
    expiresAt,
  };
}

export async function pollDueRealtimeFeeds(
  input: { at: Date },
  dependencies: RealtimePollDependencies & {
    readDataFlag(): string | undefined;
  },
) {
  if (dependencies.readDataFlag() !== "true") {
    return { status: "disabled" as const, results: [] as PollResult[] };
  }
  const feedTypes: RealtimeFeedType[] = ["trip_updates", "vehicles", "alerts"];
  const results = await Promise.all(
    feedTypes.map((feedType) =>
      pollRealtimeFeed({ feedType, at: input.at }, dependencies),
    ),
  );
  return { status: "completed" as const, results };
}
