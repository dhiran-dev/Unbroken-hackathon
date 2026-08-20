import { describe, expect, it } from "vitest";

import {
  createLiveVehiclesGet,
  type LiveVehiclesRouteDependencies,
} from "../../src/app/api/public/live/route";
import type { PublicLiveVehiclesResult } from "../../src/domain/transit/live-vehicles";

const at = new Date("2026-08-20T12:04:00.000Z");
const result: PublicLiveVehiclesResult = {
  state: "current",
  features: [],
};

function setup(overrides: Partial<LiveVehiclesRouteDependencies> = {}) {
  let reads = 0;
  const dependencies: LiveVehiclesRouteDependencies = {
    readPlannerFlag: () => "true",
    getLiveVehicles: async () => {
      reads += 1;
      return result;
    },
    clock: () => at,
    ...overrides,
  };
  return {
    get reads() {
      return reads;
    },
    get: createLiveVehiclesGet(dependencies),
  };
}

async function body(response: Response) {
  return response.json();
}

describe("GET /api/public/live", () => {
  it("returns a valid empty result with a no-store response", async () => {
    const response = await setup().get(
      new Request(
        "https://unbroken.test/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    expect(response.headers.get("Content-Type")).toBe("application/geo+json");
    await expect(body(response)).resolves.toEqual({
      type: "FeatureCollection",
      features: [],
    });
  });

  it("rejects missing, duplicate, extra, and malformed query values", async () => {
    const cases = [
      "/api/public/live",
      "/api/public/live?bbox=-122.5,37.7,-122.35,37.82",
      "/api/public/live?routeIds=ROUTE-1",
      "/api/public/live?bbox=-122.5,37.7,-122.35,37.82&bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1",
      "/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1&routeIds=ROUTE-2",
      "/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1&extra=x",
      "/api/public/live?bbox=-122.5,37.7,-122.35&routeIds=ROUTE-1",
      "/api/public/live?bbox=-122.42,37.7,-122.42,37.82&routeIds=ROUTE-1",
      "/api/public/live?bbox=-122.5,37.78,-122.35,37.78&routeIds=ROUTE-1",
      `/api/public/live?bbox=${"1".repeat(1_025)}&routeIds=ROUTE-1`,
      "/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1,ROUTE-1",
      "/api/public/live?bbox=-123,37.7,-122.35,37.82&routeIds=ROUTE-1",
    ];

    for (const path of cases) {
      const local = setup();
      const response = await local.get(
        new Request(`https://unbroken.test${path}`),
      );
      expect(response.status, path).toBe(400);
      expect(response.headers.get("Cache-Control"), path).toBe(
        "no-store, max-age=0",
      );
      await expect(body(response), path).resolves.toEqual({
        available: false,
        code: "LIVE_VEHICLES_REQUEST_INVALID",
        message: "This live vehicle request is invalid.",
      });
      expect(local.reads, path).toBe(0);
    }
  });

  it.each(["A,B", "A%2CB"])(
    "treats %s as the same bounded route list",
    async (routeIds) => {
      let calls = 0;
      let received: readonly string[] = [];
      const local = setup({
        getLiveVehicles: async (request) => {
          calls += 1;
          received = request.routeIds;
          return result;
        },
      });

      const response = await local.get(
        new Request(
          `https://unbroken.test/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=${routeIds}`,
        ),
      );

      expect(response.status).toBe(200);
      expect(calls).toBe(1);
      expect(received).toEqual(["A", "B"]);
    },
  );

  it("returns only the populated public vehicle allowlist", async () => {
    const local = setup({
      getLiveVehicles: async () => ({
        state: "current",
        features: [
          {
            type: "Feature",
            properties: {
              routeId: "ROUTE-1",
              bearing: 90,
              observedAt: "2026-08-20T12:04:00.000Z",
            },
            geometry: {
              type: "Point",
              coordinates: [-122.42, 37.78],
            },
          },
        ],
      }),
    });
    const response = await local.get(
      new Request(
        "https://unbroken.test/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1",
      ),
    );
    const serialized = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/geo+json");
    expect(JSON.parse(serialized)).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {
            routeId: "ROUTE-1",
            bearing: 90,
            observedAt: "2026-08-20T12:04:00.000Z",
          },
          geometry: {
            type: "Point",
            coordinates: [-122.42, 37.78],
          },
        },
      ],
    });
    for (const forbidden of [
      "entityId",
      "vehicleId",
      "label",
      "tripId",
      "stopId",
      "snapshotId",
      "token",
      "sourceUrl",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("fails closed when the flag is not exactly true", async () => {
    const local = setup({ readPlannerFlag: () => "TRUE" });
    const response = await local.get(
      new Request(
        "https://unbroken.test/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1",
      ),
    );

    expect(response.status).toBe(503);
    await expect(body(response)).resolves.toEqual({
      available: false,
      code: "LIVE_VEHICLES_UNAVAILABLE",
      message: "Current vehicle locations are unavailable right now.",
    });
    expect(local.reads).toBe(0);
  });

  it("distinguishes unavailable trusted data from a valid empty filter result", async () => {
    const local = setup({
      getLiveVehicles: async () => ({ state: "unavailable" }),
    });
    const response = await local.get(
      new Request(
        "https://unbroken.test/api/public/live?bbox=-122.5,37.7,-122.35,37.82&routeIds=ROUTE-1",
      ),
    );

    expect(response.status).toBe(503);
    await expect(body(response)).resolves.toEqual({
      available: false,
      code: "LIVE_VEHICLES_UNAVAILABLE",
      message: "Current vehicle locations are unavailable right now.",
    });
  });
});
