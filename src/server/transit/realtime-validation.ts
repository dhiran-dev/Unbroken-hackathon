import type { ServiceAlertView, VehicleView } from "@/domain/transit/realtime";
import type {
  PollReasonCode,
  RawRealtimeFeed,
  RealtimeSourceResponse,
  StaticRealtimeReferences,
} from "@/server/transit/realtime";

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function safeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function optionalInteger(value: unknown): number | null | "invalid" {
  if (value === undefined || value === null) return null;
  return safeInteger(value) ?? "invalid";
}

function safeId(value: unknown) {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    value.trim() === value &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
    ? value
    : null;
}

function optionalId(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return safeId(value);
}

function safeText(value: unknown, maximum: number, required: boolean) {
  if (value === undefined || value === null || value === "") {
    return required ? null : "";
  }
  if (typeof value !== "string") return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 &&
    normalized.length <= maximum &&
    !/[<>\u0000-\u001f\u007f]/u.test(normalized)
    ? normalized
    : null;
}

function publicUrl(value: unknown): string | null | "invalid" {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 500) return "invalid";
  try {
    const url = new URL(value);
    const officialPath =
      (url.hostname === "www.sfmta.com" &&
        url.pathname.startsWith("/travel-updates/")) ||
      (url.hostname === "511.org" && url.pathname === "/open-data/transit");
    return url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      url.search === "" &&
      url.hash === "" &&
      officialPath
      ? url.toString()
      : "invalid";
  } catch {
    return "invalid";
  }
}

function canonicalEntity(value: object) {
  return JSON.stringify(
    Object.entries(value).sort(([left], [right]) => compareText(left, right)),
  );
}

export function validateRealtimeTransport(
  feedType: "trip_updates" | "vehicles" | "alerts",
  response: RealtimeSourceResponse,
  startedAt: Date,
) {
  const reasons: PollReasonCode[] = [];
  const maximumBytes =
    feedType === "trip_updates" ? 8 * 1024 * 1024 : 2 * 1024 * 1024;
  if (
    response.bodyBytes !== response.body.byteLength ||
    response.bodyBytes > maximumBytes
  ) {
    reasons.push("OVERSIZE_BODY");
  }
  const allowed =
    feedType === "alerts"
      ? /^(application\/json|text\/json)(?:;|$)/iu.test(response.contentType)
      : /^(application\/(?:(?:x-google-|x-)?protobuf)|application\/octet-stream)(?:;|$)/iu.test(
          response.contentType,
        );
  if (!allowed) reasons.push("INVALID_CONTENT_TYPE");
  const checkedAtMs =
    response.checkedAt instanceof Date
      ? response.checkedAt.getTime()
      : Number.NaN;
  const startedAtMs =
    startedAt instanceof Date ? startedAt.getTime() : Number.NaN;
  if (
    !Number.isFinite(checkedAtMs) ||
    !Number.isFinite(startedAtMs) ||
    checkedAtMs < startedAtMs ||
    checkedAtMs > startedAtMs + 10_000
  ) {
    reasons.push("INVALID_CHECKED_TIME");
  }
  return reasons;
}

export function validateVehicleEntities(
  feed: RawRealtimeFeed,
  references: StaticRealtimeReferences,
  sourceUpdatedAt: Date,
  checkedAt: Date,
) {
  const reasons: PollReasonCode[] = [];
  const vehicles: VehicleView[] = [];
  if (!Array.isArray(feed.entities)) {
    return { reasons: ["INVALID_ENTITY"] as PollReasonCode[], vehicles };
  }
  const seen = new Set<string>();
  for (const candidate of feed.entities) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      (candidate as { kind?: unknown }).kind !== "vehicle"
    ) {
      reasons.push("INVALID_ENTITY");
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const entityId = safeId(raw.entityId);
    const tripId = safeId(raw.tripId);
    const routeId = safeId(raw.routeId);
    const stopId = optionalId(raw.stopId);
    const sequence = optionalInteger(raw.currentStopSequence);
    const timestamp = safeInteger(raw.observedTimestamp);
    const latitude =
      typeof raw.latitude === "number" ? raw.latitude : Number.NaN;
    const longitude =
      typeof raw.longitude === "number" ? raw.longitude : Number.NaN;
    const bearing =
      raw.bearing === undefined || raw.bearing === null ? null : raw.bearing;
    const speed =
      raw.speedMetersPerSecond === undefined ||
      raw.speedMetersPerSecond === null
        ? null
        : raw.speedMetersPerSecond;
    const vehicleId = optionalId(raw.vehicleId);
    const label = safeText(raw.label, 120, false);
    const currentStatus = safeText(raw.currentStatus, 80, false);
    if (
      !entityId ||
      !tripId ||
      !routeId ||
      sequence === "invalid" ||
      (typeof sequence === "number" && sequence < 0) ||
      timestamp === null
    ) {
      reasons.push("INVALID_ENTITY");
    }
    if (
      (vehicleId === null &&
        raw.vehicleId !== undefined &&
        raw.vehicleId !== null &&
        raw.vehicleId !== "") ||
      label === null ||
      currentStatus === null
    ) {
      reasons.push("INVALID_ENTITY");
    }
    if (entityId && seen.has(entityId)) reasons.push("DUPLICATE_ENTITY");
    if (entityId) seen.add(entityId);
    const staticRoute = tripId ? references.tripRoutes.get(tripId) : undefined;
    if (tripId && !staticRoute) reasons.push("UNKNOWN_TRIP");
    if (routeId && !references.routeIds.has(routeId))
      reasons.push("UNKNOWN_ROUTE");
    if (routeId && staticRoute && routeId !== staticRoute) {
      reasons.push("ROUTE_MISMATCH");
    }
    if (
      stopId === null &&
      raw.stopId !== undefined &&
      raw.stopId !== null &&
      raw.stopId !== ""
    ) {
      reasons.push("INVALID_ENTITY");
    }
    if (stopId && !references.stopIds.has(stopId)) reasons.push("UNKNOWN_STOP");
    if (
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude) ||
      latitude < 37.68 ||
      latitude > 37.86 ||
      longitude < -122.58 ||
      longitude > -122.31
    ) {
      reasons.push("INVALID_POSITION");
    }
    if (
      bearing !== null &&
      (typeof bearing !== "number" ||
        !Number.isFinite(bearing) ||
        bearing < 0 ||
        bearing >= 360)
    ) {
      reasons.push("INVALID_BEARING");
    }
    if (
      speed !== null &&
      (typeof speed !== "number" ||
        !Number.isFinite(speed) ||
        speed < 0 ||
        speed > 50)
    ) {
      reasons.push("INVALID_SPEED");
    }
    const observedAt = timestamp === null ? null : new Date(timestamp * 1000);
    if (
      observedAt &&
      (Math.abs(observedAt.getTime() - sourceUpdatedAt.getTime()) > 300_000 ||
        observedAt.getTime() > checkedAt.getTime() + 60_000)
    ) {
      reasons.push("INVALID_EVENT_TIME");
    }
    if (
      !entityId ||
      !tripId ||
      !routeId ||
      timestamp === null ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      continue;
    }
    vehicles.push({
      entityId,
      vehicleId,
      label: label || null,
      tripId,
      routeId,
      stopId,
      currentStopSequence: typeof sequence === "number" ? sequence : null,
      currentStatus: currentStatus || null,
      latitude,
      longitude,
      bearing: typeof bearing === "number" ? bearing : null,
      speedMetersPerSecond: typeof speed === "number" ? speed : null,
      observedAt: new Date(timestamp * 1000),
    });
  }
  vehicles.sort((left, right) => compareText(left.entityId, right.entityId));
  return { reasons, vehicles };
}

export function validateAlertEntities(
  feed: RawRealtimeFeed,
  references: StaticRealtimeReferences,
) {
  const reasons: PollReasonCode[] = [];
  const alerts: ServiceAlertView[] = [];
  if (!Array.isArray(feed.entities)) {
    return { reasons: ["INVALID_ENTITY"] as PollReasonCode[], alerts };
  }
  const seen = new Set<string>();
  for (const candidate of feed.entities) {
    if (
      !candidate ||
      typeof candidate !== "object" ||
      (candidate as { kind?: unknown }).kind !== "alert"
    ) {
      reasons.push("INVALID_ENTITY");
      continue;
    }
    const raw = candidate as Record<string, unknown>;
    const entityId = safeId(raw.entityId);
    if (!entityId) reasons.push("INVALID_ENTITY");
    if (entityId && seen.has(entityId)) reasons.push("DUPLICATE_ENTITY");
    if (entityId) seen.add(entityId);
    const header = safeText(raw.header, 300, true);
    const description = safeText(raw.description, 4000, false);
    if (!header || description === null) reasons.push("INVALID_TEXT");
    const url = publicUrl(raw.url);
    if (url === "invalid") reasons.push("INVALID_URL");

    const activePeriods: ServiceAlertView["activePeriods"] = [];
    if (!Array.isArray(raw.activePeriods))
      reasons.push("INVALID_ACTIVE_PERIOD");
    else {
      for (const candidatePeriod of raw.activePeriods) {
        if (!candidatePeriod || typeof candidatePeriod !== "object") {
          reasons.push("INVALID_ACTIVE_PERIOD");
          continue;
        }
        const period = candidatePeriod as Record<string, unknown>;
        const start = optionalInteger(period.start);
        const end = optionalInteger(period.end);
        if (
          start === "invalid" ||
          end === "invalid" ||
          (typeof start === "number" && start < 0) ||
          (typeof end === "number" && end < 0) ||
          (typeof start === "number" &&
            !Number.isFinite(new Date(start * 1000).getTime())) ||
          (typeof end === "number" &&
            !Number.isFinite(new Date(end * 1000).getTime())) ||
          (typeof start === "number" && typeof end === "number" && start > end)
        ) {
          reasons.push("INVALID_ACTIVE_PERIOD");
        } else {
          activePeriods.push({
            startsAt: typeof start === "number" ? new Date(start * 1000) : null,
            endsAt: typeof end === "number" ? new Date(end * 1000) : null,
          });
        }
      }
    }

    const informedEntities: ServiceAlertView["informedEntities"] = [];
    let applicable = false;
    if (
      !Array.isArray(raw.informedEntities) ||
      raw.informedEntities.length === 0
    ) {
      reasons.push("INVALID_INFORMED_ENTITY");
    } else {
      for (const candidateEntity of raw.informedEntities) {
        if (!candidateEntity || typeof candidateEntity !== "object") {
          reasons.push("INVALID_INFORMED_ENTITY");
          continue;
        }
        const entity = candidateEntity as Record<string, unknown>;
        const agencyId = optionalId(entity.agencyId);
        const routeId = optionalId(entity.routeId);
        const tripId = optionalId(entity.tripId);
        const stopId = optionalId(entity.stopId);
        const suppliedIdentifiers: Array<[unknown, string | null]> = [
          [entity.agencyId, agencyId],
          [entity.routeId, routeId],
          [entity.tripId, tripId],
          [entity.stopId, stopId],
        ];
        if (
          suppliedIdentifiers.some(
            ([rawValue, normalized]) =>
              rawValue !== undefined &&
              rawValue !== null &&
              rawValue !== "" &&
              normalized === null,
          )
        ) {
          reasons.push("INVALID_INFORMED_ENTITY");
        }
        if (agencyId && agencyId !== "SF")
          reasons.push("INVALID_INFORMED_ENTITY");
        if (routeId && !references.routeIds.has(routeId))
          reasons.push("UNKNOWN_ROUTE");
        const staticRoute = tripId
          ? references.tripRoutes.get(tripId)
          : undefined;
        if (tripId && !staticRoute) reasons.push("UNKNOWN_TRIP");
        if (tripId && routeId && staticRoute && routeId !== staticRoute) {
          reasons.push("ROUTE_MISMATCH");
        }
        if (stopId && !references.stopIds.has(stopId))
          reasons.push("UNKNOWN_STOP");
        if (
          agencyId === "SF" ||
          (routeId && references.routeIds.has(routeId)) ||
          (tripId && staticRoute !== undefined) ||
          (stopId && references.stopIds.has(stopId))
        ) {
          applicable = true;
        }
        informedEntities.push({ agencyId, routeId, tripId, stopId });
      }
    }
    if (!applicable) reasons.push("INVALID_INFORMED_ENTITY");
    activePeriods.sort((left, right) =>
      compareText(canonicalEntity(left), canonicalEntity(right)),
    );
    informedEntities.sort((left, right) =>
      compareText(canonicalEntity(left), canonicalEntity(right)),
    );
    if (entityId && header && description !== null && url !== "invalid") {
      alerts.push({
        entityId,
        cause: optionalId(raw.cause),
        effect: optionalId(raw.effect),
        header,
        description: description || null,
        url,
        activePeriods,
        informedEntities,
      });
    }
  }
  alerts.sort((left, right) => compareText(left.entityId, right.entityId));
  return { reasons, alerts };
}
