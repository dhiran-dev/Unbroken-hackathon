import { describe, expect, it, vi } from "vitest";

import {
  createJourneyRateGate,
  createJourneysPost,
  type JourneyRateGate,
} from "../../src/app/api/public/journeys/route";
import { JourneyRequestInvalidError } from "../../src/domain/journey/journey";
import type { JourneyPlanner } from "../../src/domain/journey/journey";

const plannerRequest = {
  origin: { type: "catalog", placeId: "stop:origin" },
  destination: { type: "catalog", placeId: "landmark:ferry-building" },
  departureAt: "2026-08-20T12:00:00.000Z",
};

const plan = {
  status: "confirmed",
  title: "Step-free details confirmed",
  summary: "Take the 5 Fulton toward the waterfront.",
  departureAt: plannerRequest.departureAt,
  arrivalAt: "2026-08-20T12:32:00.000Z",
  durationMinutes: 32,
  legs: [
    {
      type: "ride",
      from: "Market Street",
      to: "Ferry Building",
      startAt: plannerRequest.departureAt,
      endAt: "2026-08-20T12:32:00.000Z",
      durationMinutes: 32,
      route: {
        id: "5",
        name: "5 Fulton",
        color: "#123456",
        destination: "Ferry Building",
      },
      instruction: "Ride the 5 Fulton toward the waterfront.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.41, 37.78],
          [-122.3937, 37.7955],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
  ],
  warnings: [],
  changes: [],
  sources: [
    {
      source: "schedule",
      checkedAt: "2026-08-20T11:55:00.000Z",
      sourceUpdatedAt: null,
      freshness: "current",
      sourceUrl: "https://www.sfmta.com/",
    },
  ],
  map: {
    bounds: {
      north: 37.8,
      south: 37.77,
      east: -122.39,
      west: -122.42,
    },
    origin: { type: "Point", coordinates: [-122.41, 37.78] },
    destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
};

const invalidResponse = {
  available: false,
  code: "JOURNEY_REQUEST_INVALID",
  message: "Choose valid From and To places.",
};

const unavailableResponse = {
  available: false,
  code: "JOURNEY_PLANNER_UNAVAILABLE",
  message: "Journey planning is unavailable right now.",
};

function body(value: unknown = plannerRequest) {
  return JSON.stringify(value);
}

function post(
  value: string | Uint8Array | ReadableStream<Uint8Array>,
  headers: Record<string, string> = { "Content-Type": "application/json" },
) {
  return new Request("https://unbroken.test/api/public/journeys", {
    method: "POST",
    headers,
    body: value as BodyInit,
    ...(value instanceof ReadableStream ? { duplex: "half" as const } : {}),
  });
}

function route(
  planner: { plan: (request: unknown) => Promise<unknown> } = {
    plan: async () => plan,
  },
  flag?: string,
  admitRequest?: JourneyRateGate,
) {
  const actualFlag = arguments.length > 1 ? flag : "true";
  return createJourneysPost({
    getPlanner: () => planner as unknown as JourneyPlanner,
    readPlannerFlag: () => actualFlag,
    admitRequest,
  });
}

describe("POST /api/public/journeys", () => {
  it("passes a valid request to the planner and returns its exact public plan", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    const response = await route(planner)(post(body()));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(planner.plan).toHaveBeenCalledWith(plannerRequest);
    await expect(response.json()).resolves.toEqual(plan);
  });

  it.each([undefined, "1", "TRUE", " true ", "false"])(
    "returns one unavailable response unless the feature flag is exact true: %s",
    async (flag) => {
      const planner = { plan: vi.fn(async () => plan) };
      const response = await route(planner, flag)(post(body()));

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
      await expect(response.json()).resolves.toEqual(unavailableResponse);
      expect(planner.plan).not.toHaveBeenCalled();
    },
  );

  it("accepts application/json parameters but rejects other media types", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    const accepted = await route(planner)(
      post(body(), { "Content-Type": "Application/JSON; charset=utf-8" }),
    );
    expect(accepted.status).toBe(200);

    const rejected = await route(planner)(
      post(body(), { "Content-Type": "text/plain" }),
    );
    expect(rejected.status).toBe(400);
    await expect(rejected.json()).resolves.toEqual(invalidResponse);
  });

  it("rejects a declared body larger than 64 KiB before reading it", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    const response = await route(planner)(
      post(body(), {
        "Content-Type": "application/json",
        "Content-Length": String(64 * 1024 + 1),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(invalidResponse);
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it("rejects a streamed body as soon as it crosses 64 KiB", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
        controller.enqueue(new Uint8Array(64 * 1024));
        controller.enqueue(new TextEncoder().encode("}"));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = await route(planner)(post(stream));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(invalidResponse);
    expect(planner.plan).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });

  it("rejects malformed UTF-8 and malformed JSON without exposing input", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    const malformedUtf8 = await route(planner)(
      post(new Uint8Array([0x7b, 0x22, 0x6f, 0x72, 0x69, 0xc3, 0x28]), {
        "Content-Type": "application/json",
      }),
    );
    expect(malformedUtf8.status).toBe(400);
    await expect(malformedUtf8.json()).resolves.toEqual(invalidResponse);

    const malformedJson = await route(planner)(
      post('{"origin":', { "Content-Type": "application/json" }),
    );
    expect(malformedJson.status).toBe(400);
    await expect(malformedJson.json()).resolves.toEqual(invalidResponse);
  });

  it.each([
    ["top-level array", []],
    ["top-level null", null],
    [
      "missing origin",
      {
        destination: plannerRequest.destination,
        departureAt: plannerRequest.departureAt,
      },
    ],
    [
      "missing destination",
      {
        origin: plannerRequest.origin,
        departureAt: plannerRequest.departureAt,
      },
    ],
    ["extra top-level key", { ...plannerRequest, extra: true }],
    [
      "catalog extra key",
      {
        ...plannerRequest,
        origin: { ...plannerRequest.origin, name: "not accepted" },
      },
    ],
    [
      "catalog missing placeId",
      { ...plannerRequest, origin: { type: "catalog" } },
    ],
    [
      "catalog non-string placeId",
      { ...plannerRequest, origin: { type: "catalog", placeId: 42 } },
    ],
    [
      "current location extra key",
      {
        ...plannerRequest,
        origin: {
          type: "current_location",
          latitude: 37.78,
          longitude: -122.41,
          accuracyMeters: 10,
          label: "not accepted",
        },
      },
    ],
    [
      "current location malformed number",
      {
        ...plannerRequest,
        origin: {
          type: "current_location",
          latitude: "37.78",
          longitude: -122.41,
          accuracyMeters: 10,
        },
      },
    ],
    [
      "missing departure",
      {
        origin: plannerRequest.origin,
        destination: plannerRequest.destination,
      },
    ],
  ] as const)("rejects %s", async (_name, value) => {
    const planner = { plan: vi.fn(async () => plan) };
    const response = await route(planner)(post(body(value)));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(invalidResponse);
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it.each([
    '{"origin":{"type":"catalog","placeId":"stop:origin"},"origin":{"type":"catalog","placeId":"stop:origin"},"destination":{"type":"catalog","placeId":"landmark:ferry-building"},"departureAt":"2026-08-20T12:00:00.000Z"}',
    '{"origin":{"type":"current_location","latitude":37.78,"longitude":-122.41,"accuracyMeters":10,"accuracyMeters":11},"destination":{"type":"catalog","placeId":"landmark:ferry-building"},"departureAt":"2026-08-20T12:00:00.000Z"}',
  ])("rejects detectably duplicated JSON keys", async (value) => {
    const planner = { plan: vi.fn(async () => plan) };
    const response = await route(planner)(post(value));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(invalidResponse);
    expect(planner.plan).not.toHaveBeenCalled();
  });

  it("maps a typed request-invalid planner failure to the fixed 400 response", async () => {
    const planner = {
      plan: vi.fn(async () => {
        throw new JourneyRequestInvalidError();
      }),
    };
    const response = await route(planner)(post(body()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(invalidResponse);
  });

  it("does not treat a spoofed error name or code as request-invalid", async () => {
    const planner = {
      plan: vi.fn(async () => {
        throw Object.assign(new Error("spoofed dependency failure"), {
          name: "JourneyRequestInvalidError",
          code: "JOURNEY_REQUEST_INVALID",
        });
      }),
    };
    const response = await route(planner)(post(body()));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual(unavailableResponse);
  });
  it("maps unexpected dependency failures to the fixed 503 response", async () => {
    const planner = {
      plan: vi.fn(async () => {
        throw new Error(
          "token=private-token otp.internal:8080 entity=secret-stop-id",
        );
      }),
    };
    const response = await route(planner)(post(body()));

    expect(response.status).toBe(503);
    const responseText = await response.text();
    expect(JSON.parse(responseText)).toEqual(unavailableResponse);
    expect(responseText).not.toContain("private-token");
    expect(responseText).not.toContain("otp.internal");
    expect(responseText).not.toContain("secret-stop-id");
  });

  it("keeps the response projection free of internal fingerprint and entity fields", async () => {
    const publicPlan = {
      ...plan,
      warnings: ["A current service update may affect this journey."],
      changes: ["A stop for this journey has moved."],
    };
    const response = await route({ plan: async () => publicPlan })(
      post(body()),
    );
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(responseText).not.toMatch(
      /fingerprint|candidateId|entityId|routeId|stopId/i,
    );
    await expect(Promise.resolve(JSON.parse(responseText))).resolves.toEqual(
      publicPlan,
    );
  });
  it("accepts zero accuracy inside the route bounds", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    const value = {
      ...plannerRequest,
      origin: {
        type: "current_location",
        latitude: 37.78,
        longitude: -122.41,
        accuracyMeters: 0,
      },
    };
    const response = await route(planner)(post(body(value)));
    expect(response.status).toBe(200);
    expect(planner.plan).toHaveBeenCalledWith(value);
  });
  it.each([
    [
      "outside SF",
      {
        ...plannerRequest,
        origin: {
          type: "current_location",
          latitude: 0,
          longitude: 0,
          accuracyMeters: 10,
        },
      },
    ],
    [
      "accuracy over 1000m",
      {
        ...plannerRequest,
        origin: {
          type: "current_location",
          latitude: 37.78,
          longitude: -122.41,
          accuracyMeters: 1_001,
        },
      },
    ],
  ] as const)("rejects %s before planner resolution", async (_name, value) => {
    const planner = { plan: vi.fn(async () => plan) };
    const response = await route(planner)(post(body(value)));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual(invalidResponse);
    expect(planner.plan).not.toHaveBeenCalled();
  });
  it("allows 20 requests, returns exact 429 on the 21st, and resets after 60 seconds", async () => {
    let now = 0;
    const admitRequest = createJourneyRateGate({ clock: () => now });
    const planner = { plan: vi.fn(async () => plan) };
    const handler = route(planner, "true", admitRequest);
    for (let index = 0; index < 20; index += 1) {
      const response = await handler(
        post(body(), {
          "Content-Type": "application/json",
          "X-Forwarded-For": "198.51.100.1",
        }),
      );
      expect(response.status).toBe(200);
    }
    const limited = await handler(
      post(body(), {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.1",
      }),
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toMatch(/^[1-9][0-9]*$/u);
    expect(limited.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(planner.plan).toHaveBeenCalledTimes(20);
    now = 60_001;
    const reset = await handler(
      post(body(), {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.1",
      }),
    );
    expect(reset.status).toBe(200);
  });
  it("isolates distinct valid forwarded client identities", async () => {
    const admitRequest = createJourneyRateGate({ clock: () => 0 });
    const planner = { plan: vi.fn(async () => plan) };
    const handler = route(planner, "true", admitRequest);
    const headersFor = (address: string) => ({
      "Content-Type": "application/json",
      "X-Forwarded-For": address,
    });
    for (const address of ["198.51.100.2", "203.0.113.2"]) {
      for (let index = 0; index < 20; index += 1) {
        const response = await handler(post(body(), headersFor(address)));
        expect(response.status).toBe(200);
      }
    }
    expect(planner.plan).toHaveBeenCalledTimes(40);
  });
  it("uses one bounded global identity for malformed forwarded addresses", async () => {
    const admitRequest = createJourneyRateGate({ clock: () => 0 });
    const planner = { plan: vi.fn(async () => plan) };
    const handler = route(planner, "true", admitRequest);
    const malformedAddress = "not-an-ip";
    const overlongAddress = "x".repeat(65);
    const headersFor = (address: string) => ({
      "Content-Type": "application/json",
      "X-Forwarded-For": address,
    });
    for (let index = 0; index < 10; index += 1) {
      const response = await handler(
        post(body(), headersFor(malformedAddress)),
      );
      expect(response.status).toBe(200);
    }
    for (let index = 0; index < 10; index += 1) {
      const response = await handler(post(body(), headersFor(overlongAddress)));
      expect(response.status).toBe(200);
    }
    const limited = await handler(post(body(), headersFor(malformedAddress)));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toBe("no-store, max-age=0");
    const responseText = await limited.text();
    expect(responseText).not.toContain(malformedAddress);
    expect(responseText).not.toContain(overlongAddress);
    expect(responseText).not.toContain("stop:origin");
    expect(planner.plan).toHaveBeenCalledTimes(20);
  });
  it("fails closed when the injected admission gate throws", async () => {
    const planner = { plan: vi.fn(async () => plan) };
    const admitRequest: JourneyRateGate = async () => {
      throw new Error("token=private-token https://otp.internal/route");
    };
    const response = await route(planner, "true", admitRequest)(post(body()));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("retry-after")).toMatch(
      /^(?:[1-9]|[1-5][0-9]|60)$/u,
    );
    const responseText = await response.text();
    expect(responseText).not.toContain("private-token");
    expect(responseText).not.toContain("otp.internal");
    expect(JSON.parse(responseText)).toEqual({
      available: false,
      code: "JOURNEY_RATE_LIMITED",
      message: "Please wait a moment and try again.",
    });
    expect(planner.plan).not.toHaveBeenCalled();
  });
  it("fails closed when the identity entry cap is full", () => {
    const gate = createJourneyRateGate({ clock: () => 0, maxEntries: 1 });
    const first = new Request("https://unbroken.test", {
      headers: { "X-Forwarded-For": "198.51.100.3" },
    });
    const second = new Request("https://unbroken.test", {
      headers: { "X-Forwarded-For": "203.0.113.3" },
    });
    expect(gate(first)).toEqual({ allowed: true });
    expect(gate(second)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
  });
});
