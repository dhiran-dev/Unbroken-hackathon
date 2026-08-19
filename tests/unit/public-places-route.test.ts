import { describe, expect, it } from "vitest";

import {
  createTransitCatalog,
  type TransitCatalog,
} from "../../src/domain/transit/catalog";
import { createPlacesGet } from "../../src/app/api/public/places/route";
import { MemoryTransitCatalogStore } from "../support/transit-catalog";

const choices = [
  {
    id: "stop:STOP-1",
    type: "stop" as const,
    name: "Market Street stop",
    description: "Stop code 1 \u2022 Market Street station \u2022 5 Fulton",
    latitude: 37.78,
    longitude: -122.41,
    stopIds: ["STOP-1"],
    routeNames: ["5 Fulton"],
  },
  {
    id: "station:STATION-1",
    type: "station" as const,
    name: "Market Street station",
    description: "Station \u2022 5 Fulton",
    latitude: 37.781,
    longitude: -122.411,
    stopIds: ["STOP-1"],
    routeNames: ["5 Fulton"],
  },
  {
    id: "landmark:ferry-building",
    type: "landmark" as const,
    name: "Ferry Building",
    description: "Destination point",
    latitude: 37.7955,
    longitude: -122.3937,
    stopIds: [],
    routeNames: [],
  },
];

function catalog(): TransitCatalog {
  return createTransitCatalog(
    new MemoryTransitCatalogStore(
      "active-a",
      new Map([
        [
          "active-a",
          {
            snapshotId: "active-a",
            stops: [
              {
                stopId: "STATION-1",
                stopCode: null,
                name: "Market Street station",
                latitude: 37.781,
                longitude: -122.411,
                locationType: 1,
                parentStationId: null,
                routeNames: [],
              },
              {
                stopId: "STOP-1",
                stopCode: "1",
                name: "Market Street stop",
                latitude: 37.78,
                longitude: -122.41,
                locationType: 0,
                parentStationId: "STATION-1",
                routeNames: ["5 Fulton"],
              },
            ],
            landmarks: [
              {
                id: "ferry-building",
                name: "Ferry Building",
                description: "Destination point",
                latitude: 37.7955,
                longitude: -122.3937,
                aliases: ["Market"],
                stopIds: [],
              },
            ],
          },
        ],
      ]),
      { available: false },
    ),
  );
}

function failingCatalog(): TransitCatalog {
  return createTransitCatalog({
    async getActiveCatalogIdentity() {
      throw new Error("private database detail");
    },
    async loadSnapshot() {
      return null;
    },
    async getCoverage() {
      return { available: false };
    },
  });
}

describe("GET /api/public/places", () => {
  it("returns three ordered, stable groups and the exact selection message", async () => {
    const transitCatalog = catalog();
    const get = createPlacesGet({
      getCatalog: () => transitCatalog,
      readPlannerFlag: () => "true",
    });
    const response = await get(
      new Request(
        "https://unbroken.test/api/public/places?q=Market&latitude=37.78&longitude=-122.41",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    await expect(response.json()).resolves.toEqual({
      groups: [
        { id: "nearby_stops", label: "Nearby stops", places: [choices[0]] },
        { id: "stations", label: "Stations", places: [choices[1]] },
        { id: "places", label: "Places", places: [choices[2]] },
      ],
      message: "Choose a place from the list.",
    });
  });

  it("includes empty groups and never derives a place reference from the query", async () => {
    const transitCatalog = catalog();
    const get = createPlacesGet({
      getCatalog: () => transitCatalog,
      readPlannerFlag: () => "true",
    });
    const response = await get(
      new Request("https://unbroken.test/api/public/places?q=Nope"),
    );

    await expect(response.json()).resolves.toEqual({
      groups: [
        { id: "nearby_stops", label: "Nearby stops", places: [] },
        { id: "stations", label: "Stations", places: [] },
        { id: "places", label: "Places", places: [] },
      ],
      message: "Choose a place from the list.",
    });
  });

  it.each([
    "https://unbroken.test/api/public/places",
    "https://unbroken.test/api/public/places?q=",
    `https://unbroken.test/api/public/places?q=${"x".repeat(121)}`,
    "https://unbroken.test/api/public/places?q=%3Cscript%3E",
    "https://unbroken.test/api/public/places?q=Market&latitude=37.78",
    "https://unbroken.test/api/public/places?q=Market&latitude=no&longitude=-122.4",
    "https://unbroken.test/api/public/places?q=Market&latitude=91&longitude=-122.4",
    "https://unbroken.test/api/public/places?q=Market&q=Other",
  ])("fails malformed searches safely: %s", async (url) => {
    const transitCatalog = catalog();
    const get = createPlacesGet({
      getCatalog: () => transitCatalog,
      readPlannerFlag: () => "true",
    });
    const response = await get(new Request(url));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      groups: [
        { id: "nearby_stops", label: "Nearby stops", places: [] },
        { id: "stations", label: "Stations", places: [] },
        { id: "places", label: "Places", places: [] },
      ],
      code: "PLACE_SEARCH_INVALID",
      message: "Choose a place from the list.",
    });
  });

  it.each([undefined, "1", "TRUE", "false"])(
    "returns one plain unavailable response unless the flag is exact true: %s",
    async (flag) => {
      const transitCatalog = catalog();
      const get = createPlacesGet({
        getCatalog: () => transitCatalog,
        readPlannerFlag: () => flag,
      });
      const response = await get(
        new Request("https://unbroken.test/api/public/places?q=Market"),
      );

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        available: false,
        code: "PLACE_SEARCH_UNAVAILABLE",
        message: "Place search is unavailable right now.",
      });
    },
  );

  it("hides catalog failures behind the same plain unavailable response", async () => {
    const transitCatalog = failingCatalog();
    const get = createPlacesGet({
      getCatalog: () => transitCatalog,
      readPlannerFlag: () => "true",
    });
    const response = await get(
      new Request("https://unbroken.test/api/public/places?q=Market"),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      available: false,
      code: "PLACE_SEARCH_UNAVAILABLE",
      message: "Place search is unavailable right now.",
    });
  });
});
