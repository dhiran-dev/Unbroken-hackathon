import { unzipSync, strFromU8 } from "fflate";
import { describe, expect, it } from "vitest";

import {
  exportActiveGtfsArchive,
  sameGtfsIdentity,
  type ActiveGtfsExportSnapshot,
} from "../../deploy/otp/gtfs-export";

const HASH = "a".repeat(64);
function active(shapeCount = 1): ActiveGtfsExportSnapshot {
  return {
    snapshotId: "active-1",
    feedHash: HASH,
    coverage: {
      serviceDate: "2026-08-20",
      activeServiceCount: 1,
      fingerprint: "b".repeat(64),
      counts: {
        stops: 1,
        routes: 1,
        trips: 1,
        stopTimes: 1,
        services: 2,
        shapePoints: shapeCount,
      },
    },
    rows: {
      stops: [
        {
          stopId: "S",
          stopCode: null,
          name: "Stop",
          description: null,
          latitude: 37.7,
          longitude: -122.4,
          locationType: 0,
          parentStationId: null,
          wheelchairBoarding: 0,
          platformCode: null,
          zoneId: null,
        },
      ],
      routes: [
        {
          routeId: "R",
          agencyId: "SF",
          shortName: "N",
          longName: "Judah",
          description: null,
          routeType: 0,
          url: null,
          color: null,
          textColor: null,
          sortOrder: null,
        },
      ],
      trips: [
        {
          tripId: "T",
          routeId: "R",
          serviceId: "W",
          shapeId: "SH",
          headsign: null,
          shortName: null,
          directionId: null,
          blockId: null,
          wheelchairAccessible: 0,
          bikesAllowed: 0,
        },
      ],
      stopTimes: [
        {
          tripId: "T",
          stopId: "S",
          arrivalSeconds: 3600,
          departureSeconds: 3600,
          stopSequence: 1,
          stopHeadsign: null,
          pickupType: 0,
          dropOffType: 0,
          shapeDistanceTraveled: null,
          timepoint: null,
        },
      ],
      services: [
        {
          serviceId: "E",
          weekdays: [false, false, false, false, false, false, false],
          startDate: null,
          endDate: null,
          exceptions: [{ date: "2026-08-21", type: "added" }],
        },
        {
          serviceId: "W",
          weekdays: [true, true, true, true, true, false, false],
          startDate: "2026-08-01",
          endDate: "2026-08-31",
          exceptions: [],
        },
      ],
      shapes: [
        {
          shapeId: "SH",
          latitude: 37.7,
          longitude: -122.4,
          sequence: 1,
          distanceTraveled: null,
        },
      ],
    },
  };
}

describe("authoritative active GTFS export", () => {
  it("compares count bindings by field rather than JSON key order", () => {
    const first = {
      snapshotId: "s",
      activeArchiveSha256: HASH,
      coverageFingerprint: "b".repeat(64),
      counts: {
        stops: 1,
        routes: 2,
        trips: 3,
        stopTimes: 4,
        services: 5,
        shapePoints: 6,
      },
    };
    const second = {
      ...first,
      counts: {
        shapePoints: 6,
        services: 5,
        stopTimes: 4,
        trips: 3,
        routes: 2,
        stops: 1,
      },
    };
    expect(sameGtfsIdentity(first, second)).toBe(true);
  });
  it("binds deterministic archive evidence to active identity, fingerprint, and exact stored counts", async () => {
    const source = { readActiveSnapshot: async () => active() };
    const first = await exportActiveGtfsArchive(source);
    const second = await exportActiveGtfsArchive(source);
    expect(first.status).toBe("accepted");
    expect(second).toEqual(first);
    if (first.status !== "accepted") return;
    expect(first.provenance).toMatchObject({
      snapshotId: "active-1",
      activeArchiveSha256: HASH,
      coverageFingerprint: "b".repeat(64),
      counts: active().coverage.counts,
    });
    const files = unzipSync(first.archive);
    expect(Object.keys(files)).toEqual([
      "agency.txt",
      "stops.txt",
      "routes.txt",
      "trips.txt",
      "stop_times.txt",
      "calendar.txt",
      "calendar_dates.txt",
      "shapes.txt",
    ]);
    expect(strFromU8(files["calendar.txt"]!)).not.toContain("E,");
    expect(strFromU8(files["calendar_dates.txt"]!)).toContain("E,20260821,1");
  });

  it("refuses missing active data and any metadata/persisted-row mismatch without returning rows", async () => {
    expect(
      await exportActiveGtfsArchive({ readActiveSnapshot: async () => null }),
    ).toEqual({
      status: "rejected",
      code: "NO_ACTIVE_SNAPSHOT",
      message: "The active transit archive could not be exported.",
    });
    const mismatch = await exportActiveGtfsArchive({
      readActiveSnapshot: async () => active(45_308),
    });
    expect(mismatch).toEqual({
      status: "rejected",
      code: "ACTIVE_COVERAGE_MISMATCH",
      message: "The active transit archive could not be exported.",
    });
    expect(JSON.stringify(mismatch)).not.toContain("Stop");
  });
});
