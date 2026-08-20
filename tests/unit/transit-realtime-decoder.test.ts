import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import { describe, expect, it } from "vitest";

import { pollRealtimeFeed } from "../../src/server/transit/realtime";
import { realtimeFeedDecoder } from "../../src/server/transit/realtime-source";
import {
  MemoryRealtimeStore,
  realtimeDependencies,
  staticReferences,
  tripFeed,
} from "../support/transit-realtime";

const at = new Date("2026-08-20T12:04:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T12:03:00.000Z");

describe("production realtime decoder through the poll seam", () => {
  it("decodes an exact GTFS-realtime cancellation protobuf", async () => {
    const { transit_realtime: realtime } = GtfsRealtimeBindings;
    const body = realtime.FeedMessage.encode({
      header: {
        gtfsRealtimeVersion: "2.0",
        incrementality: realtime.FeedHeader.Incrementality.FULL_DATASET,
        timestamp: sourceUpdatedAt.getTime() / 1000,
      },
      entity: [
        {
          id: "cancelled",
          tripUpdate: {
            trip: {
              tripId: "TRIP-1",
              routeId: "ROUTE-1",
              scheduleRelationship:
                realtime.TripDescriptor.ScheduleRelationship.CANCELED,
            },
            stopTimeUpdate: [],
          },
        },
      ],
    }).finish();
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.decoder = realtimeFeedDecoder;
    dependencies.source.load = async () => ({
      body,
      bodyBytes: body.byteLength,
      contentType: "application/x-google-protobuf",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "trip_updates", at }, dependencies),
    ).resolves.toMatchObject({ status: "accepted", entityCount: 1 });
  });

  it("publishes referenced vehicles while omitting provider positions with no trip descriptor", async () => {
    const { transit_realtime: realtime } = GtfsRealtimeBindings;
    const body = realtime.FeedMessage.encode({
      header: {
        gtfsRealtimeVersion: "2.0",
        incrementality: realtime.FeedHeader.Incrementality.FULL_DATASET,
        timestamp: sourceUpdatedAt.getTime() / 1000,
      },
      entity: [
        {
          id: "referenced",
          vehicle: {
            trip: { tripId: "TRIP-1", routeId: "ROUTE-1" },
            position: { latitude: 37.78, longitude: -122.41 },
            timestamp: sourceUpdatedAt.getTime() / 1000,
          },
        },
        {
          id: "not-on-trip",
          vehicle: {
            position: { latitude: 37.77, longitude: -122.42 },
            timestamp: sourceUpdatedAt.getTime() / 1000,
          },
        },
      ],
    }).finish();
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.decoder = realtimeFeedDecoder;
    dependencies.source.load = async () => ({
      body,
      bodyBytes: body.byteLength,
      contentType: "application/x-google-protobuf",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "vehicles", at }, dependencies),
    ).resolves.toMatchObject({ status: "accepted", entityCount: 2 });
    await expect(
      store.getTrustedSnapshot(
        "vehicles",
        new Date("2026-08-20T12:04:02.000Z"),
      ),
    ).resolves.toMatchObject({
      vehicles: [{ entityId: "referenced", tripId: "TRIP-1" }],
    });
  });

  it("rejects a provider vehicle with only a partial trip descriptor", async () => {
    const { transit_realtime: realtime } = GtfsRealtimeBindings;
    const body = realtime.FeedMessage.encode({
      header: {
        gtfsRealtimeVersion: "2.0",
        incrementality: realtime.FeedHeader.Incrementality.FULL_DATASET,
        timestamp: sourceUpdatedAt.getTime() / 1000,
      },
      entity: [
        {
          id: "partial",
          vehicle: {
            trip: { routeId: "ROUTE-1" },
            position: { latitude: 37.78, longitude: -122.41 },
            timestamp: sourceUpdatedAt.getTime() / 1000,
          },
        },
      ],
    }).finish();
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.decoder = realtimeFeedDecoder;
    dependencies.source.load = async () => ({
      body,
      bodyBytes: body.byteLength,
      contentType: "application/x-google-protobuf",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "vehicles", at }, dependencies),
    ).resolves.toMatchObject({
      status: "rejected",
      reasons: expect.arrayContaining(["INVALID_ENTITY"]),
    });
  });

  it("accepts the exact PascalCase 511 service-alert envelope", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({
        Header: {
          GtfsRealtimeVersion: "2.0",
          Timestamp: sourceUpdatedAt.getTime() / 1000,
          incrementality: 0,
        },
        Entities: [
          {
            Id: "alert-1",
            TripUpdate: null,
            Vehicle: null,
            Alert: {
              ActivePeriods: [
                {
                  Start: Date.parse("2026-08-20T12:00:00.000Z") / 1000,
                  End: Date.parse("2026-08-20T13:00:00.000Z") / 1000,
                },
              ],
              InformedEntities: [
                { AgencyId: "SF", RouteId: "ROUTE-1", Trip: null },
              ],
              HeaderText: {
                Translations: [{ Language: "en", Text: "Route 1 detour" }],
              },
              DescriptionText: {
                Translations: [
                  { Language: "en", Text: "Use the signed stop." },
                ],
              },
              TtsDescriptionText: null,
              TtsHeaderText: null,
              Url: null,
            },
          },
        ],
      }),
    );
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.decoder = realtimeFeedDecoder;
    dependencies.source.load = async () => ({
      body,
      bodyBytes: body.byteLength,
      contentType: "application/json",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "alerts", at }, dependencies),
    ).resolves.toMatchObject({ status: "accepted", entityCount: 1 });
  });

  it("accepts the exact 511 alerts JSON shape with protobuf JSON integer strings", async () => {
    const body = new TextEncoder().encode(
      JSON.stringify({
        header: {
          gtfsRealtimeVersion: "2.0",
          incrementality: "FULL_DATASET",
          timestamp: String(sourceUpdatedAt.getTime() / 1000),
        },
        entity: [
          {
            id: "alert-1",
            alert: {
              cause: "CONSTRUCTION",
              effect: "DETOUR",
              activePeriod: [
                {
                  start: String(Date.parse("2026-08-20T12:00:00.000Z") / 1000),
                  end: String(Date.parse("2026-08-20T13:00:00.000Z") / 1000),
                },
              ],
              informedEntity: [{ agencyId: "SF", routeId: "ROUTE-1" }],
              headerText: {
                translation: [{ language: "en", text: "Route 1 detour" }],
              },
              descriptionText: {
                translation: [{ language: "en", text: "Use the signed stop." }],
              },
              url: {
                translation: [
                  {
                    language: "en",
                    text: "https://www.sfmta.com/travel-updates/route-1-detour",
                  },
                ],
              },
            },
          },
        ],
      }),
    );
    const store = new MemoryRealtimeStore(staticReferences());
    const dependencies = realtimeDependencies(store, tripFeed(sourceUpdatedAt));
    dependencies.decoder = realtimeFeedDecoder;
    dependencies.source.load = async () => ({
      body,
      bodyBytes: body.byteLength,
      contentType: "application/json",
      checkedAt: new Date("2026-08-20T12:04:02.000Z"),
    });

    await expect(
      pollRealtimeFeed({ feedType: "alerts", at }, dependencies),
    ).resolves.toMatchObject({ status: "accepted", entityCount: 1 });
    await expect(
      store.getTrustedSnapshot("alerts", new Date("2026-08-20T12:04:02.000Z")),
    ).resolves.toMatchObject({
      alerts: [
        {
          entityId: "alert-1",
          header: "Route 1 detour",
          url: "https://www.sfmta.com/travel-updates/route-1-detour",
        },
      ],
    });
  });

  it.each([
    [
      "trip_updates" as const,
      new Uint8Array([255, 255]),
      "application/x-google-protobuf",
    ],
    [
      "alerts" as const,
      new TextEncoder().encode("{not json"),
      "application/json",
    ],
  ])(
    "rejects malformed %s bodies without exposing parser details",
    async (feedType, body, contentType) => {
      const store = new MemoryRealtimeStore(staticReferences());
      const dependencies = realtimeDependencies(
        store,
        tripFeed(sourceUpdatedAt),
      );
      dependencies.decoder = realtimeFeedDecoder;
      dependencies.source.load = async () => ({
        body,
        bodyBytes: body.byteLength,
        contentType,
        checkedAt: new Date("2026-08-20T12:04:02.000Z"),
      });

      await expect(
        pollRealtimeFeed({ feedType, at }, dependencies),
      ).resolves.toEqual({
        status: "rejected",
        feedType,
        reasons: ["DECODE_FAILED"],
      });
    },
  );
});
