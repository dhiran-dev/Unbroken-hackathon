import GtfsRealtimeBindings from "gtfs-realtime-bindings";

import type { RealtimeFeedType } from "@/domain/transit/realtime";
import type {
  RawRealtimeFeed,
  RealtimeSourceResponse,
} from "@/server/transit/realtime";

const endpoints = {
  trip_updates: "https://api.511.org/transit/tripupdates",
  vehicles: "https://api.511.org/transit/vehiclepositions",
  alerts: "https://api.511.org/transit/servicealerts",
} as const;

const byteLimits = {
  trip_updates: 8 * 1024 * 1024,
  vehicles: 2 * 1024 * 1024,
  alerts: 2 * 1024 * 1024,
} as const;

type LongLike = { toNumber(): number };

function safeInteger(value: unknown): number {
  const number =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^(0|[1-9][0-9]*)$/u.test(value)
        ? Number(value)
        : value &&
            typeof value === "object" &&
            typeof (value as Partial<LongLike>).toNumber === "function"
          ? (value as LongLike).toNumber()
          : Number.NaN;
  if (!Number.isSafeInteger(number)) {
    throw new Error("Realtime source value is invalid.");
  }
  return number;
}

function optionalInteger(value: unknown) {
  return value === undefined || value === null ? undefined : safeInteger(value);
}

function enumName(
  enumType: Record<string | number, string | number>,
  value: unknown,
) {
  if (typeof value === "string") return value;
  if (typeof value !== "number") return undefined;
  const name = enumType[value];
  return typeof name === "string" ? name : undefined;
}

function decodeProtobuf(body: Uint8Array): RawRealtimeFeed {
  const { transit_realtime: realtime } = GtfsRealtimeBindings;
  const message = realtime.FeedMessage.decode(body);
  const entities: Array<Record<string, unknown>> = [];
  for (const entity of message.entity) {
    const kinds = [entity.tripUpdate, entity.vehicle, entity.alert].filter(
      (value) => value !== undefined && value !== null,
    );
    if (kinds.length !== 1) {
      entities.push({ kind: "invalid", entityId: entity.id });
      continue;
    }
    if (entity.tripUpdate) {
      entities.push({
        kind: "trip_update",
        entityId: entity.id,
        tripId: entity.tripUpdate.trip.tripId,
        routeId: entity.tripUpdate.trip.routeId,
        scheduleRelationship: enumName(
          realtime.TripDescriptor.ScheduleRelationship,
          entity.tripUpdate.trip.scheduleRelationship,
        ),
        stopTimeUpdates: (entity.tripUpdate.stopTimeUpdate ?? []).map(
          (update) => ({
            stopId: update.stopId,
            stopSequence: optionalInteger(update.stopSequence),
            arrivalDelaySeconds: optionalInteger(update.arrival?.delay),
            departureDelaySeconds: optionalInteger(update.departure?.delay),
            arrivalTime: optionalInteger(update.arrival?.time),
            departureTime: optionalInteger(update.departure?.time),
          }),
        ),
      });
      continue;
    }
    if (entity.vehicle) {
      const tripId = entity.vehicle.trip?.tripId;
      const routeId = entity.vehicle.trip?.routeId;
      const hasTripId = typeof tripId === "string" && tripId.length > 0;
      const hasRouteId = typeof routeId === "string" && routeId.length > 0;
      // 511 also reports vehicles that are not assigned to a rider trip. They
      // are outside VehicleView; a partial descriptor still reaches validation.
      if (!hasTripId && !hasRouteId) continue;
      entities.push({
        kind: "vehicle",
        entityId: entity.id,
        vehicleId: entity.vehicle.vehicle?.id,
        label: entity.vehicle.vehicle?.label,
        tripId,
        routeId,
        stopId: entity.vehicle.stopId,
        currentStopSequence: optionalInteger(
          entity.vehicle.currentStopSequence,
        ),
        currentStatus: enumName(
          realtime.VehiclePosition.VehicleStopStatus,
          entity.vehicle.currentStatus,
        ),
        latitude: entity.vehicle.position?.latitude,
        longitude: entity.vehicle.position?.longitude,
        bearing: entity.vehicle.position?.bearing,
        speedMetersPerSecond: entity.vehicle.position?.speed,
        observedTimestamp: optionalInteger(entity.vehicle.timestamp),
      });
      continue;
    }
    entities.push({ kind: "invalid", entityId: entity.id });
  }
  return {
    headerTimestamp: safeInteger(message.header.timestamp),
    incrementality:
      message.header.incrementality === undefined ||
      message.header.incrementality === null
        ? undefined
        : message.header.incrementality,
    entities,
    sourceEntityCount: message.entity.length,
  } as RawRealtimeFeed;
}

function plainObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Realtime JSON is invalid.");
  }
  return value as Record<string, unknown>;
}

function english(value: unknown, pascalCase: boolean) {
  const translated = plainObject(value);
  const rawTranslations = pascalCase
    ? translated.Translations
    : translated.translation;
  if (!Array.isArray(rawTranslations)) {
    throw new Error("Realtime JSON is invalid.");
  }
  const translations = rawTranslations.map(plainObject);
  const languageKey = pascalCase ? "Language" : "language";
  const textKey = pascalCase ? "Text" : "text";
  const selected =
    translations.find((item) => item[languageKey] === "en") ??
    translations.find(
      (item) => item[languageKey] === undefined || item[languageKey] === null,
    );
  return selected?.[textKey];
}

function decodeAlerts(body: Uint8Array): RawRealtimeFeed {
  const root = plainObject(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)),
  );
  const pascalCase = root.Header !== undefined || root.Entities !== undefined;
  if (pascalCase && (root.header !== undefined || root.entity !== undefined)) {
    throw new Error("Realtime JSON is invalid.");
  }
  const header = plainObject(pascalCase ? root.Header : root.header);
  const rawEntities = pascalCase ? root.Entities : root.entity;
  if (!Array.isArray(rawEntities)) {
    throw new Error("Realtime JSON is invalid.");
  }
  const field = (
    value: Record<string, unknown>,
    camel: string,
    pascal: string,
  ) => value[pascalCase ? pascal : camel];

  return {
    headerTimestamp: safeInteger(
      pascalCase ? header.Timestamp : header.timestamp,
    ),
    incrementality: header.incrementality ?? header.Incrementality,
    sourceEntityCount: rawEntities.length,
    entities: rawEntities.map((candidate) => {
      const entity = plainObject(candidate);
      const alert = plainObject(field(entity, "alert", "Alert"));
      const descriptionText = field(
        alert,
        "descriptionText",
        "DescriptionText",
      );
      const rawUrl = field(alert, "url", "Url");
      const activePeriod = field(alert, "activePeriod", "ActivePeriods");
      const informedEntity = field(alert, "informedEntity", "InformedEntities");
      return {
        kind: "alert",
        entityId: field(entity, "id", "Id"),
        cause: field(alert, "cause", "Cause"),
        effect: field(alert, "effect", "Effect"),
        header: english(field(alert, "headerText", "HeaderText"), pascalCase),
        description:
          descriptionText === undefined || descriptionText === null
            ? undefined
            : english(descriptionText, pascalCase),
        url:
          rawUrl === undefined || rawUrl === null
            ? undefined
            : english(rawUrl, pascalCase),
        activePeriods: Array.isArray(activePeriod)
          ? activePeriod.map((period) => {
              const item = plainObject(period);
              return {
                start: optionalInteger(field(item, "start", "Start")),
                end: optionalInteger(field(item, "end", "End")),
              };
            })
          : activePeriod,
        informedEntities: Array.isArray(informedEntity)
          ? informedEntity.map((selector) => {
              const item = plainObject(selector);
              const rawTrip = field(item, "trip", "Trip");
              const trip =
                rawTrip === undefined || rawTrip === null
                  ? null
                  : plainObject(rawTrip);
              return {
                agencyId: field(item, "agencyId", "AgencyId"),
                routeId:
                  field(item, "routeId", "RouteId") ??
                  (trip ? field(trip, "routeId", "RouteId") : undefined),
                tripId: trip ? field(trip, "tripId", "TripId") : undefined,
                stopId: field(item, "stopId", "StopId"),
              };
            })
          : informedEntity,
      };
    }),
  };
}

export const realtimeFeedDecoder = {
  decode(
    feedType: RealtimeFeedType,
    response: RealtimeSourceResponse,
  ): RawRealtimeFeed {
    return feedType === "alerts"
      ? decodeAlerts(response.body)
      : decodeProtobuf(response.body);
  },
};

async function boundedBody(response: Response, maximumBytes: number) {
  if (!response.body) throw new Error("Realtime response is unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error("Realtime response is too large.");
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function create511RealtimeSource(input: {
  token: string;
  fetcher?: (input: URL, init: RequestInit) => Promise<Response>;
  clock?: () => Date;
}) {
  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init));
  const clock = input.clock ?? (() => new Date());
  return {
    async load(feedType: RealtimeFeedType, startedAt: Date) {
      if (input.token.length === 0 || !Number.isFinite(startedAt.getTime()))
        throw new Error("Realtime source is unavailable.");
      const url = new URL(endpoints[feedType]);
      url.searchParams.set("api_key", input.token);
      url.searchParams.set("agency", "SF");
      if (feedType === "alerts") url.searchParams.set("format", "json");
      let response: Response;
      try {
        response = await fetcher(url, {
          method: "GET",
          headers: {
            Accept:
              feedType === "alerts"
                ? "application/json"
                : "application/x-google-protobuf",
          },
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(10_000),
        });
      } catch {
        throw new Error("Realtime source is unavailable.");
      }
      if (response.status !== 200)
        throw new Error("Realtime source is unavailable.");
      const body = await boundedBody(response, byteLimits[feedType]);
      return {
        body,
        bodyBytes: body.byteLength,
        contentType: response.headers.get("content-type") ?? "",
        checkedAt: clock(),
      };
    },
  };
}
