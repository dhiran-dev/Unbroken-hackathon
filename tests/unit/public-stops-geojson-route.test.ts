import { describe, expect, it } from "vitest";

import {
  createStopsGeoJsonGet,
  type StopsGeoJsonRouteDependencies,
} from "../../src/app/api/public/map/stops.geojson/route";
import type {
  ActiveStopMap,
  ActiveStopMapResult,
} from "../../src/domain/transit/stop-map";

const feedHash = "b".repeat(64);

function mapWith(
  features: ActiveStopMapResult["features"],
  hash = feedHash,
): ActiveStopMap {
  return {
    async get() {
      return { snapshotId: "private-snapshot", feedHash: hash, features };
    },
  };
}

const features = [
  {
    type: "Feature" as const,
    id: "STOP-1",
    properties: {
      id: "STOP-1",
      name: "Market & 5th",
      code: "10001",
      locationType: 0,
      parentStationId: null,
    },
    geometry: {
      type: "Point" as const,
      coordinates: [-122.4, 37.78] as [number, number],
    },
  },
];

function route(
  map: ActiveStopMap,
  flag?: string,
): (request: Request) => Promise<Response> {
  const actualFlag = arguments.length > 1 ? flag : "true";
  const dependencies: StopsGeoJsonRouteDependencies = {
    getMap: () => map,
    readPlannerFlag: () => actualFlag,
  };
  return createStopsGeoJsonGet(dependencies);
}

function request(search = `?v=${feedHash}`, headers?: HeadersInit) {
  return new Request(
    `https://unbroken.test/api/public/map/stops.geojson${search}`,
    {
      headers,
    },
  );
}

describe("GET /api/public/map/stops.geojson", () => {
  it("returns deterministic GeoJSON with exact immutable cache and ETag headers", async () => {
    const get = route(mapWith(features));
    const response = await get(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/geo+json");
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(response.headers.get("etag")).toBe(`"${feedHash}"`);
    expect(response.headers.get("vary")).toBe("Accept-Encoding");
    expect(response.headers.get("content-encoding")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      type: "FeatureCollection",
      features,
    });
  });

  it("returns 304 only for an exact strong If-None-Match value", async () => {
    const get = route(mapWith(features));

    const exact = await get(
      request(undefined, { "If-None-Match": `"${feedHash}"` }),
    );
    expect(exact.status).toBe(304);
    expect(await exact.text()).toBe("");

    const weak = await get(
      request(undefined, { "If-None-Match": `W/"${feedHash}"` }),
    );
    expect(weak.status).toBe(200);
  });

  it.each([
    "",
    "?v=",
    "?v=ABCDEF",
    `?v=${"a".repeat(63)}`,
    `?v=${"a".repeat(65)}`,
    `?v=${feedHash}&v=${feedHash}`,
  ])("rejects an invalid version query: %s", async (search) => {
    const response = await route(mapWith(features))(request(search));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      available: false,
      code: "STOP_MAP_VERSION_INVALID",
      message: "Map version is invalid.",
    });
  });

  it("does not serve a different active feed version", async () => {
    const response = await route(mapWith(features, "c".repeat(64)))(request());

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      available: false,
      code: "STOP_MAP_VERSION_UNAVAILABLE",
      message: "This map version is no longer available.",
    });
  });

  it("hides no-active and database failures behind one safe unavailable response", async () => {
    const unavailable: ActiveStopMap = {
      async get() {
        return null;
      },
    };
    const response = await route(unavailable)(request());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      available: false,
      code: "STOP_MAP_UNAVAILABLE",
      message: "Map is unavailable. Use the trip steps instead.",
    });
  });

  it.each([undefined, "false", "TRUE", " true "])(
    "honors the exact citywide planner flag: %s",
    async (flag) => {
      const response = await route(mapWith(features), flag)(request());
      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        available: false,
        code: "STOP_MAP_UNAVAILABLE",
        message: "Map is unavailable. Use the trip steps instead.",
      });
    },
  );
});
