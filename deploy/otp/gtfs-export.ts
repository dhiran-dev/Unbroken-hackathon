import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";

import type {
  GtfsCoverageSummary,
  GtfsValidatedSnapshot,
} from "../../src/domain/transit/gtfs-validation";

export type ActiveGtfsExportSnapshot = {
  snapshotId: string;
  feedHash: string;
  coverage: GtfsCoverageSummary;
  rows: GtfsValidatedSnapshot;
};

export type ActiveGtfsExportSource = {
  readActiveSnapshot: () => Promise<ActiveGtfsExportSnapshot | null>;
};

export type GtfsExportProvenance = {
  snapshotId: string;
  activeArchiveSha256: string;
  coverageFingerprint: string;
  counts: GtfsCoverageSummary["counts"];
  generatedArchiveBytes: number;
  generatedArchiveSha256: string;
};

export function sameGtfsIdentity(
  left: Pick<
    GtfsExportProvenance,
    "snapshotId" | "activeArchiveSha256" | "coverageFingerprint" | "counts"
  >,
  right: Pick<
    GtfsExportProvenance,
    "snapshotId" | "activeArchiveSha256" | "coverageFingerprint" | "counts"
  >,
) {
  return (
    left.snapshotId === right.snapshotId &&
    left.activeArchiveSha256 === right.activeArchiveSha256 &&
    left.coverageFingerprint === right.coverageFingerprint &&
    COUNT_KEYS.every((key) => left.counts[key] === right.counts[key])
  );
}

export type ActiveGtfsExportResult =
  | {
      status: "accepted";
      archive: Uint8Array;
      provenance: GtfsExportProvenance;
    }
  | {
      status: "rejected";
      code:
        | "NO_ACTIVE_SNAPSHOT"
        | "ACTIVE_COVERAGE_MISMATCH"
        | "INVALID_ACTIVE_EVIDENCE";
      message: "The active transit archive could not be exported.";
    };

const SHA256 = /^[a-f0-9]{64}$/;
const COUNT_KEYS = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;

function csv(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll(`"`, `""`)}"` : text;
}

function table(
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
) {
  return strToU8(
    [headers, ...rows].map((row) => row.map(csv).join(",")).join("\n") + "\n",
  );
}

function gtfsTime(seconds: number | null) {
  if (seconds === null) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  return [hours, minutes, remainder]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function gtfsDate(value: string | null) {
  return value?.replaceAll("-", "") ?? "";
}

function actualCounts(
  rows: GtfsValidatedSnapshot,
): GtfsCoverageSummary["counts"] {
  return {
    stops: rows.stops.length,
    routes: rows.routes.length,
    trips: rows.trips.length,
    stopTimes: rows.stopTimes.length,
    services: rows.services.length,
    shapePoints: rows.shapes.length,
  };
}

function validCounts(counts: GtfsCoverageSummary["counts"]) {
  return COUNT_KEYS.every(
    (key) => Number.isSafeInteger(counts[key]) && counts[key] > 0,
  );
}

function compareText(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createArchive(rows: GtfsValidatedSnapshot) {
  const sortedStops = [...rows.stops].sort((a, b) =>
    compareText(a.stopId, b.stopId),
  );
  const sortedRoutes = [...rows.routes].sort((a, b) =>
    compareText(a.routeId, b.routeId),
  );
  const sortedTrips = [...rows.trips].sort((a, b) =>
    compareText(a.tripId, b.tripId),
  );
  const sortedStopTimes = [...rows.stopTimes].sort(
    (a, b) =>
      compareText(a.tripId, b.tripId) || a.stopSequence - b.stopSequence,
  );
  const sortedServices = [...rows.services].sort((a, b) =>
    compareText(a.serviceId, b.serviceId),
  );
  const sortedShapes = [...rows.shapes].sort(
    (a, b) => compareText(a.shapeId, b.shapeId) || a.sequence - b.sequence,
  );
  const files: Record<string, Uint8Array> = {
    "agency.txt": table(
      ["agency_id", "agency_name", "agency_url", "agency_timezone"],
      [
        [
          "SF",
          "San Francisco Municipal Transportation Agency",
          "https://www.sfmta.com",
          "America/Los_Angeles",
        ],
      ],
    ),
    "stops.txt": table(
      [
        "stop_id",
        "stop_code",
        "stop_name",
        "stop_desc",
        "stop_lat",
        "stop_lon",
        "location_type",
        "parent_station",
        "wheelchair_boarding",
        "platform_code",
        "zone_id",
      ],
      sortedStops.map((row) => [
        row.stopId,
        row.stopCode,
        row.name,
        row.description,
        row.latitude,
        row.longitude,
        row.locationType,
        row.parentStationId,
        row.wheelchairBoarding,
        row.platformCode,
        row.zoneId,
      ]),
    ),
    "routes.txt": table(
      [
        "route_id",
        "agency_id",
        "route_short_name",
        "route_long_name",
        "route_desc",
        "route_type",
        "route_url",
        "route_color",
        "route_text_color",
        "route_sort_order",
      ],
      sortedRoutes.map((row) => [
        row.routeId,
        row.agencyId,
        row.shortName,
        row.longName,
        row.description,
        row.routeType,
        row.url,
        row.color,
        row.textColor,
        row.sortOrder,
      ]),
    ),
    "trips.txt": table(
      [
        "route_id",
        "service_id",
        "trip_id",
        "trip_headsign",
        "trip_short_name",
        "direction_id",
        "block_id",
        "shape_id",
        "wheelchair_accessible",
        "bikes_allowed",
      ],
      sortedTrips.map((row) => [
        row.routeId,
        row.serviceId,
        row.tripId,
        row.headsign,
        row.shortName,
        row.directionId,
        row.blockId,
        row.shapeId,
        row.wheelchairAccessible,
        row.bikesAllowed,
      ]),
    ),
    "stop_times.txt": table(
      [
        "trip_id",
        "arrival_time",
        "departure_time",
        "stop_id",
        "stop_sequence",
        "stop_headsign",
        "pickup_type",
        "drop_off_type",
        "shape_dist_traveled",
        "timepoint",
      ],
      sortedStopTimes.map((row) => [
        row.tripId,
        gtfsTime(row.arrivalSeconds),
        gtfsTime(row.departureSeconds),
        row.stopId,
        row.stopSequence,
        row.stopHeadsign,
        row.pickupType,
        row.dropOffType,
        row.shapeDistanceTraveled,
        row.timepoint,
      ]),
    ),
    "calendar.txt": table(
      [
        "service_id",
        "monday",
        "tuesday",
        "wednesday",
        "thursday",
        "friday",
        "saturday",
        "sunday",
        "start_date",
        "end_date",
      ],
      sortedServices
        .filter((row) => row.startDate !== null && row.endDate !== null)
        .map((row) => [
          row.serviceId,
          ...row.weekdays.map(Number),
          gtfsDate(row.startDate),
          gtfsDate(row.endDate),
        ]),
    ),
    "calendar_dates.txt": table(
      ["service_id", "date", "exception_type"],
      sortedServices.flatMap((row) =>
        row.exceptions.map((exception) => [
          row.serviceId,
          gtfsDate(exception.date),
          exception.type === "added" ? 1 : 2,
        ]),
      ),
    ),
    "shapes.txt": table(
      [
        "shape_id",
        "shape_pt_lat",
        "shape_pt_lon",
        "shape_pt_sequence",
        "shape_dist_traveled",
      ],
      sortedShapes.map((row) => [
        row.shapeId,
        row.latitude,
        row.longitude,
        row.sequence,
        row.distanceTraveled,
      ]),
    ),
  };
  return zipSync(files, {
    level: 6,
    mtime: new Date("1980-01-01T00:00:00.000Z"),
  });
}

export async function exportActiveGtfsArchive(
  source: ActiveGtfsExportSource,
): Promise<ActiveGtfsExportResult> {
  const active = await source.readActiveSnapshot();
  if (!active)
    return {
      status: "rejected",
      code: "NO_ACTIVE_SNAPSHOT",
      message: "The active transit archive could not be exported.",
    };
  if (
    !SHA256.test(active.feedHash) ||
    !SHA256.test(active.coverage.fingerprint) ||
    !validCounts(active.coverage.counts)
  )
    return {
      status: "rejected",
      code: "INVALID_ACTIVE_EVIDENCE",
      message: "The active transit archive could not be exported.",
    };
  const actual = actualCounts(active.rows);
  if (COUNT_KEYS.some((key) => actual[key] !== active.coverage.counts[key]))
    return {
      status: "rejected",
      code: "ACTIVE_COVERAGE_MISMATCH",
      message: "The active transit archive could not be exported.",
    };
  const archive = createArchive(active.rows);
  const generatedArchiveSha256 = createHash("sha256")
    .update(archive)
    .digest("hex");
  return {
    status: "accepted",
    archive,
    provenance: {
      snapshotId: active.snapshotId,
      activeArchiveSha256: active.feedHash,
      coverageFingerprint: active.coverage.fingerprint,
      counts: actual,
      generatedArchiveBytes: archive.byteLength,
      generatedArchiveSha256,
    },
  };
}
