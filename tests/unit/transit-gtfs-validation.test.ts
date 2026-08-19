import { describe, expect, it } from "vitest";

import { validateGtfsFileSet } from "@/domain/transit/gtfs-validation";
import { minimalGtfsFeed, minimalGtfsPolicy } from "../support/minimal-gtfs";

function validate(
  files: Readonly<Record<string, string | undefined>> = minimalGtfsFeed(),
) {
  return validateGtfsFileSet({
    files,
    serviceDate: "2026-08-19",
    policy: minimalGtfsPolicy,
  });
}

describe("Muni schedule validation", () => {
  it("accepts a complete schedule and returns its coverage", () => {
    const result = validate();

    expect(result).toMatchObject({
      accepted: true,
      summary: {
        serviceDate: "2026-08-19",
        activeServiceCount: 1,
        counts: {
          stops: 2,
          routes: 1,
          trips: 1,
          stopTimes: 2,
          services: 1,
          shapePoints: 2,
        },
        fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
  });

  it("returns normalized import rows only after acceptance", () => {
    const result = validate();

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.snapshot.stops).toMatchObject([
      {
        stopId: "STOP-A",
        name: "Market at 5th",
        latitude: 37.7834,
        longitude: -122.4071,
        parentStationId: null,
      },
      {
        stopId: "STOP-B",
        name: "Embarcadero",
        latitude: 37.7929,
        longitude: -122.3969,
        parentStationId: null,
      },
    ]);
    expect(result.snapshot.services).toEqual([
      {
        serviceId: "WEEKDAY",
        weekdays: [true, true, true, true, true, false, false],
        startDate: "2026-08-01",
        endDate: "2026-08-31",
        exceptions: [],
      },
    ]);
    expect(result.snapshot.trips[0]).toMatchObject({
      tripId: "TRIP-1",
      routeId: "ROUTE-N",
      serviceId: "WEEKDAY",
      shapeId: "SHAPE-N",
    });
    expect(result.snapshot.stopTimes).toHaveLength(2);
  });

  it("parses quoted commas, escaped quotes, and CRLF rows", () => {
    const files = minimalGtfsFeed();
    files["stops.txt"] = [
      "stop_id,stop_name,stop_lat,stop_lon",
      'STOP-A,"Market, at ""5th""",37.7834,-122.4071',
      "STOP-B,Embarcadero,37.7929,-122.3969",
    ].join("\r\n");

    const result = validate(files);

    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.snapshot.stops[0]?.name).toBe('Market, at "5th"');
  });

  it.each([
    "agency.txt",
    "stops.txt",
    "routes.txt",
    "trips.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt",
    "shapes.txt",
  ])("rejects a schedule missing required %s", (fileName) => {
    const files: Record<string, string | undefined> = minimalGtfsFeed();
    delete files[fileName];

    expect(validate(files)).toEqual({
      accepted: false,
      reasons: [{ code: "MISSING_REQUIRED_FILE", file: fileName }],
    });
  });

  it("rejects malformed CSV and missing required columns", () => {
    const malformed = minimalGtfsFeed();
    malformed["stops.txt"] =
      'stop_id,stop_name,stop_lat,stop_lon\nSTOP-A,"unclosed,37.7,-122.4';
    expect(validate(malformed)).toMatchObject({
      accepted: false,
      reasons: [
        expect.objectContaining({ code: "INVALID_CSV", file: "stops.txt" }),
      ],
    });

    const missingColumn = minimalGtfsFeed();
    missingColumn["routes.txt"] =
      "route_id,route_short_name,route_long_name\nROUTE-N,N,Judah";
    expect(validate(missingColumn)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_REQUIRED_COLUMN",
          file: "routes.txt",
          field: "route_type",
        }),
      ]),
    });
  });

  it("aggregates broken references without exposing an accepted snapshot", () => {
    const files = minimalGtfsFeed();
    files["trips.txt"] = [
      "route_id,service_id,trip_id,shape_id",
      "MISSING-ROUTE,WEEKDAY,TRIP-1,MISSING-SHAPE",
    ].join("\n");
    files["stop_times.txt"] = [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "TRIP-1,08:00:00,08:00:00,MISSING-STOP,1",
      "MISSING-TRIP,08:10:00,08:10:00,STOP-B,2",
    ].join("\n");

    const result = validate(files);
    expect(result.accepted).toBe(false);
    if (result.accepted) return;
    expect(
      result.reasons.filter((reason) => reason.code === "INVALID_REFERENCE"),
    ).toHaveLength(4);
    expect(result).not.toHaveProperty("snapshot");
    expect(result).not.toHaveProperty("summary");
  });

  it("applies calendar exceptions and rejects dates with no active service", () => {
    const added = minimalGtfsFeed();
    added["calendar.txt"] = [
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      "WEEKDAY,0,0,0,0,0,0,0,20260801,20260831",
    ].join("\n");
    added["calendar_dates.txt"] = [
      "service_id,date,exception_type",
      "WEEKDAY,20260819,1",
    ].join("\n");
    expect(validate(added)).toMatchObject({
      accepted: true,
      summary: { activeServiceCount: 1 },
    });

    const removed = minimalGtfsFeed();
    removed["calendar_dates.txt"] = [
      "service_id,date,exception_type",
      "WEEKDAY,20260819,2",
    ].join("\n");
    expect(validate(removed)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({ code: "NO_ACTIVE_SERVICE" }),
      ]),
    });
  });

  it("rejects duplicate keys, unsafe coordinates, and invalid service times", () => {
    const files = minimalGtfsFeed();
    files["stops.txt"] = [
      "stop_id,stop_name,stop_lat,stop_lon",
      "STOP-A,Market,38.5000,-122.4071",
      "STOP-A,Duplicate,37.7929,-122.3969",
    ].join("\n");
    files["stop_times.txt"] = [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "TRIP-1,48:00:00,08:00:00,STOP-A,1",
      "TRIP-1,08:10:00,08:10:00,STOP-A,1",
    ].join("\n");
    const result = validate(files);
    expect(result).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_IDENTIFIER",
          file: "stops.txt",
        }),
        expect.objectContaining({
          code: "DUPLICATE_IDENTIFIER",
          file: "stop_times.txt",
        }),
        expect.objectContaining({
          code: "INVALID_COORDINATE",
          file: "stops.txt",
        }),
        expect.objectContaining({
          code: "INVALID_TIME",
          file: "stop_times.txt",
        }),
      ]),
    });
  });

  it("rejects count floors and contractions against the trusted snapshot", () => {
    const result = validateGtfsFileSet({
      files: minimalGtfsFeed(),
      serviceDate: "2026-08-19",
      policy: {
        ...minimalGtfsPolicy,
        minimumCounts: { ...minimalGtfsPolicy.minimumCounts, routes: 2 },
      },
      previousCoverage: {
        serviceDate: "2026-08-18",
        activeServiceCount: 1,
        counts: { ...minimalGtfsPolicy.minimumCounts, stops: 10 },
        fingerprint: "a".repeat(64),
      },
    });
    expect(result).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "BELOW_MINIMUM_COUNT",
          count: "routes",
          actual: 1,
        }),
        expect.objectContaining({
          code: "COVERAGE_CONTRACTION",
          count: "stops",
          actual: 2,
          expected: 8,
        }),
      ]),
    });
  });

  it("keeps the structural fingerprint stable when row order changes", () => {
    const first = validate();
    const reordered = minimalGtfsFeed();
    reordered["stops.txt"] = [
      "stop_id,stop_name,stop_lat,stop_lon",
      "STOP-B,Embarcadero,37.7929,-122.3969",
      "STOP-A,Market at 5th,37.7834,-122.4071",
    ].join("\n");
    const second = validate(reordered);
    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (!first.accepted || !second.accepted) return;
    expect(second.summary.fingerprint).toBe(first.summary.fingerprint);
  });

  it("returns normalized shape rows for database-derived coverage", () => {
    const result = validate();
    expect(result.accepted).toBe(true);
    if (!result.accepted) return;
    expect(result.snapshot.shapes).toEqual([
      {
        shapeId: "SHAPE-N",
        latitude: 37.7834,
        longitude: -122.4071,
        sequence: 1,
        distanceTraveled: null,
      },
      {
        shapeId: "SHAPE-N",
        latitude: 37.7929,
        longitude: -122.3969,
        sequence: 2,
        distanceTraveled: null,
      },
    ]);
  });

  it("rejects blank schedule times and invalid optional numeric fields", () => {
    const files = minimalGtfsFeed();
    files["stops.txt"] = [
      "stop_id,stop_name,stop_lat,stop_lon,location_type",
      "STOP-A,Market at 5th,37.7834,-122.4071,invalid",
      "STOP-B,Embarcadero,37.7929,-122.3969,0",
    ].join("\n");
    files["stop_times.txt"] = [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type",
      "TRIP-1,,,STOP-A,1,invalid",
      "TRIP-1,08:10:00,08:10:00,STOP-B,2,0",
    ].join("\n");

    expect(validate(files)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_VALUE",
          file: "stops.txt",
          field: "location_type",
        }),
        expect.objectContaining({
          code: "INVALID_TIME",
          file: "stop_times.txt",
        }),
        expect.objectContaining({
          code: "INVALID_VALUE",
          file: "stop_times.txt",
          field: "pickup_type",
        }),
      ]),
    });
  });

  it("rejects duplicate calendar exceptions", () => {
    const files = minimalGtfsFeed();
    files["calendar_dates.txt"] = [
      "service_id,date,exception_type",
      "WEEKDAY,20260819,1",
      "WEEKDAY,20260819,1",
    ].join("\n");

    expect(validate(files)).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "DUPLICATE_IDENTIFIER",
          file: "calendar_dates.txt",
        }),
      ]),
    });
  });

  it("rejects blank required identifiers even when references also match", () => {
    const files = minimalGtfsFeed();
    files["routes.txt"] = [
      "route_id,agency_id,route_short_name,route_long_name,route_type",
      ",SF,N,Judah,0",
    ].join("\n");
    files["trips.txt"] = [
      "route_id,service_id,trip_id,shape_id",
      ",WEEKDAY,TRIP-1,SHAPE-N",
    ].join("\n");

    const result = validate(files);

    expect(result).toMatchObject({
      accepted: false,
      reasons: expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_VALUE",
          file: "routes.txt",
          field: "route_id",
        }),
      ]),
    });
  });
});
