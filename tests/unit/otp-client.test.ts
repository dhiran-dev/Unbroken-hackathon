import { afterEach, describe, expect, it, vi } from "vitest";

import { RouteEngineUnavailableError } from "../../src/domain/journey/route-engine";

import { createOtpRouteEngine } from "../../src/server/journey/otp-client";
import { busPlan, routeRequest } from "../support/route-engine";

const expectedQuery = `query PlanCandidates(
  $origin: PlanLabeledLocationInput!
  $destination: PlanLabeledLocationInput!
  $departure: OffsetDateTime!
) {
  planConnection(
    origin: $origin
    destination: $destination
    dateTime: { earliestDeparture: $departure }
    first: 5
    modes: {
      transitOnly: true
      transit: {
        access: [WALK]
        egress: [WALK]
        transfer: [WALK]
        transit: [
          { mode: BUS }
          { mode: TRAM }
          { mode: SUBWAY }
          { mode: CABLE_CAR }
        ]
      }
    }
    preferences: {
      transit: { timetable: { excludeRealTimeUpdates: true } }
    }
  ) {
    edges {
      node {
        start
        end
        legs {
          mode
          startTime
          endTime
          distance
          from { name lat lon stop { gtfsId } }
          to { name lat lon stop { gtfsId } }
          legGeometry { points }
          route { gtfsId shortName longName color }
          trip { gtfsId }
          headsign
          intermediateStops { gtfsId }
        }
      }
    }
    routingErrors { code inputField }
  }
}`;

describe("OTP RouteEngine adapter", () => {
  afterEach(() => vi.useRealTimers());

  it("posts the fixed neutral static query with variables to the private OTP seam", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const engine = createOtpRouteEngine({
      baseUrl: "http://otp:8080",
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
      fetcher: async (input, init) => {
        calls.push({ url: String(input), init });
        return new Response(JSON.stringify(busPlan()), {
          status: 200,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      },
    });

    const candidates = await engine.planCandidates(routeRequest);

    expect(candidates).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "http://otp:8080/otp/gtfs/v1",
    );
    expect(calls[0]!.init).toMatchObject({
      method: "POST",
      cache: "no-store",
      redirect: "error",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    });
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      query: expectedQuery,
      variables: {
        origin: {
          location: {
            coordinate: { latitude: 37.75225, longitude: -122.41845 },
          },
        },
        destination: {
          location: {
            coordinate: { latitude: 37.781, longitude: -122.413 },
          },
        },
        departure: "2026-08-20T12:00:00.000Z",
      },
    });
  });

  it.each([
    {
      name: "non-200 response",
      response: new Response("private upstream body", {
        status: 503,
        headers: { "Content-Type": "application/json" },
      }),
    },
    {
      name: "wrong content type",
      response: new Response("{}", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    },
    {
      name: "oversized response",
      response: new Response("x".repeat(2 * 1024 * 1024 + 1), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    },
  ])("returns one safe typed error for a $name", async ({ response }) => {
    const engine = createOtpRouteEngine({
      baseUrl: "http://otp:8080",
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
      fetcher: async () => response,
    });

    await expect(engine.planCandidates(routeRequest)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
  });

  it("rejects a public OTP origin before sending rider coordinates", () => {
    expect(() =>
      createOtpRouteEngine({ baseUrl: "https://example.com" }),
    ).toThrow(new RouteEngineUnavailableError());
  });

  it("cancels a rejected response body", async () => {
    let cancelled = false;
    const body = new ReadableStream({
      cancel() {
        cancelled = true;
      },
    });
    const engine = createOtpRouteEngine({
      baseUrl: "http://otp:8080",
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
      fetcher: async () =>
        new Response(body, {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await expect(engine.planCandidates(routeRequest)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
    expect(cancelled).toBe(true);
  });

  it("does not expose a fetch error token or the internal URL", async () => {
    const engine = createOtpRouteEngine({
      baseUrl: "http://otp:8080",
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
      fetcher: async () => {
        throw new Error(
          "token=super-secret http://otp:8080/otp/gtfs/v1",
        );
      },
    });

    let failure: unknown;
    try {
      await engine.planCandidates(routeRequest);
    } catch (error) {
      failure = error;
    }

    expect(failure).toEqual(new RouteEngineUnavailableError());
    expect(String(failure)).not.toContain("super-secret");
    expect(String(failure)).not.toContain("otp");
  });

  it("times out an unresponsive provider after exactly ten seconds", async () => {
    vi.useFakeTimers();
    const engine = createOtpRouteEngine({
      baseUrl: "http://otp:8080",
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
      fetcher: async (_input, init) =>
        await new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => {
            reject(new DOMException("private timeout detail", "AbortError"));
          });
        }),
    });

    const result = expect(engine.planCandidates(routeRequest)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
    await vi.advanceTimersByTimeAsync(9_999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await result;
  });
});
