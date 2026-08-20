import { describe, expect, it } from "vitest";

import { RouteEngineUnavailableError } from "../../src/domain/journey/route-engine";
import { createRouteEngine } from "../../src/server/journey/route-engine";
import {
  busPlan,
  MemoryOtpPlanPort,
  routeRequest,
  transitPlan,
  type OtpFixture,
} from "../support/route-engine";

describe("RouteEngine", () => {
  it("normalizes a bus journey with access, wait, ride, and egress legs", async () => {
    const engine = createRouteEngine(new MemoryOtpPlanPort(busPlan()), {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    const candidates = await engine.planCandidates(routeRequest);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "631f6e832e4c77e001693592555d38894d9a7df554f808490df285b249ef1ee6",
      departureAt: new Date("2026-08-20T12:00:00.000Z"),
      arrivalAt: new Date("2026-08-20T12:22:00.000Z"),
      durationSeconds: 1_320,
      walkingDistanceMeters: 370,
      transferCount: 0,
      legs: [
        { type: "walk", durationSeconds: 240 },
        { type: "wait", durationSeconds: 180 },
        {
          type: "ride",
          durationSeconds: 780,
          routeId: "49",
          tripId: "TRIP-49-A",
          mode: "bus",
          routeName: "49",
          routeColor: "#005B95",
          headsign: "North Point",
          intermediateStopIds: ["STOP-16TH", "STOP-VAN-NESS"],
        },
        { type: "walk", durationSeconds: 120 },
      ],
    });
  });

  it("returns no candidates when OTP finds no itinerary", async () => {
    const engine = createRouteEngine(
      new MemoryOtpPlanPort({
        data: {
          planConnection: { routingErrors: [], edges: [] },
        },
      }),
      { clock: () => new Date("2026-08-20T11:55:00.000Z") },
    );

    await expect(engine.planCandidates(routeRequest)).resolves.toEqual([]);
  });

  it.each([
    {
      name: "Metro with zero transfers",
      modes: ["TRAM"] as const,
      transferCount: 0,
      legTypes: ["walk", "wait", "ride", "walk"],
      rideModes: ["tram"],
    },
    {
      name: "mixed bus and subway with one transfer",
      modes: ["BUS", "SUBWAY"] as const,
      transferCount: 1,
      legTypes: [
        "walk",
        "wait",
        "ride",
        "transfer",
        "wait",
        "ride",
        "walk",
      ],
      rideModes: ["bus", "subway"],
    },
    {
      name: "three rides with multiple transfers",
      modes: ["BUS", "TRAM", "CABLE_CAR"] as const,
      transferCount: 2,
      legTypes: [
        "walk",
        "wait",
        "ride",
        "transfer",
        "wait",
        "ride",
        "transfer",
        "wait",
        "ride",
        "walk",
      ],
      rideModes: ["bus", "tram", "cable_car"],
    },
  ])("normalizes $name", async ({ modes, transferCount, legTypes, rideModes }) => {
    const engine = createRouteEngine(
      new MemoryOtpPlanPort(transitPlan([...modes])),
      { clock: () => new Date("2026-08-20T11:55:00.000Z") },
    );

    const [candidate] = await engine.planCandidates(routeRequest);

    expect(candidate?.transferCount).toBe(transferCount);
    expect(candidate?.legs.map((leg) => leg.type)).toEqual(legTypes);
    expect(
      candidate?.legs
        .filter((leg) => leg.type === "ride")
        .map((leg) => leg.mode),
    ).toEqual(rideModes);
    expect(
      candidate?.legs.some((leg) => "accessibility" in leg),
    ).toBe(false);
  });

  it("deduplicates semantic candidates and orders the result deterministically", async () => {
    const bus = transitPlan(["BUS"]).data.planConnection.edges[0]!.node;
    const mixed = transitPlan(["BUS", "SUBWAY"]).data.planConnection.edges[0]!
      .node;
    const response: OtpFixture = {
      data: {
        planConnection: {
          routingErrors: [],
          edges: [
            { node: structuredClone(mixed) },
            { node: structuredClone(bus) },
            { node: structuredClone(bus) },
          ],
        },
      },
    };
    const engine = createRouteEngine(new MemoryOtpPlanPort(response), {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    const candidates = await engine.planCandidates(routeRequest);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.transferCount)).toEqual([
      0, 1,
    ]);
    expect(candidates[0]!.arrivalAt).toEqual(
      new Date("2026-08-20T12:11:00.000Z"),
    );
    expect(new Set(candidates.map((candidate) => candidate.id)).size).toBe(2);
  });

  it("rejects more than five provider itineraries", async () => {
    const node = transitPlan(["BUS"]).data.planConnection.edges[0]!.node;
    const response: OtpFixture = {
      data: {
        planConnection: {
          routingErrors: [],
          edges: Array.from({ length: 6 }, (_, index) => {
            const candidate = structuredClone(node);
            const ride = candidate.legs[1]!;
            const route = ride.route as Record<string, unknown>;
            route.gtfsId = "SF:ROUTE-" + index;
            return { node: candidate };
          }),
        },
      },
    };
    const engine = createRouteEngine(new MemoryOtpPlanPort(response), {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    await expect(engine.planCandidates(routeRequest)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
  });

  it.each([
    {
      name: "top-level GraphQL errors",
      mutate: (response: OtpFixture & Record<string, unknown>) => {
        response.errors = [{ message: "private provider detail" }];
      },
    },
    {
      name: "routing errors",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.routingErrors = [
          { code: "LOCATION_NOT_FOUND" },
        ];
      },
    },
    {
      name: "malformed geometry",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[0]!.legGeometry = {
          points: "_",
        };
      },
    },
    {
      name: "unsafe leg time",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[1]!.startTime =
          Number.MAX_SAFE_INTEGER + 1;
      },
    },
    {
      name: "invalid offset itinerary time",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.start =
          "2026-08-20 05:00:00";
      },
    },
    {
      name: "invalid place",
      mutate: (response: OtpFixture) => {
        const from = response.data.planConnection.edges[0]!.node.legs[0]!
          .from as Record<string, unknown>;
        from.name = "";
        from.lat = 90;
      },
    },
    {
      name: "invalid route ID",
      mutate: (response: OtpFixture) => {
        const route = response.data.planConnection.edges[0]!.node.legs[1]!
          .route as Record<string, unknown>;
        route.gtfsId = "SF:";
      },
    },
    {
      name: "invalid trip ID",
      mutate: (response: OtpFixture) => {
        const trip = response.data.planConnection.edges[0]!.node.legs[1]!
          .trip as Record<string, unknown>;
        trip.gtfsId = "TRIP-WITHOUT-FEED";
      },
    },
    {
      name: "unbounded route text",
      mutate: (response: OtpFixture) => {
        const route = response.data.planConnection.edges[0]!.node.legs[1]!
          .route as Record<string, unknown>;
        route.shortName = "x".repeat(121);
      },
    },
    {
      name: "more than 32 legs",
      mutate: (response: OtpFixture) => {
        const leg = response.data.planConnection.edges[0]!.node.legs[0]!;
        response.data.planConnection.edges[0]!.node.legs = Array.from(
          { length: 33 },
          () => structuredClone(leg),
        );
      },
    },
  ])("rejects the whole response for $name", async ({ mutate }) => {
    const response = transitPlan(["BUS"]) as OtpFixture &
      Record<string, unknown>;
    const validNode = structuredClone(
      response.data.planConnection.edges[0]!.node,
    );
    response.data.planConnection.edges.unshift({ node: validNode });
    mutate(response);
    const engine = createRouteEngine(new MemoryOtpPlanPort(response), {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    await expect(engine.planCandidates(routeRequest)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
  });

  it("uses a deterministic neutral color when a route has no valid color", async () => {
    const engine = createRouteEngine(
      new MemoryOtpPlanPort(transitPlan(["BUS"])),
      { clock: () => new Date("2026-08-20T11:55:00.000Z") },
    );

    const [candidate] = await engine.planCandidates(routeRequest);
    const ride = candidate?.legs.find((leg) => leg.type === "ride");

    expect(ride).toMatchObject({ routeColor: "#5B6472" });
  });

  it("keeps a valid ride when OTP has no trip headsign", async () => {
    const response = transitPlan(["BUS"]);
    response.data.planConnection.edges[0]!.node.legs[1]!.headsign = null;
    const engine = createRouteEngine(new MemoryOtpPlanPort(response), {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    const [candidate] = await engine.planCandidates(routeRequest);
    const ride = candidate?.legs.find((leg) => leg.type === "ride");

    expect(ride).toMatchObject({ type: "ride", headsign: null });
  });

  it.each([
    {
      name: "empty label",
      mutate: (request: typeof routeRequest) => {
        request.origin.label = "";
      },
    },
    {
      name: "coordinate outside San Francisco",
      mutate: (request: typeof routeRequest) => {
        request.destination.latitude = 40;
      },
    },
    {
      name: "invalid stop ID",
      mutate: (request: typeof routeRequest) => {
        request.origin.stopIds = ["SF:STOP"];
      },
    },
    {
      name: "non-finite departure",
      mutate: (request: typeof routeRequest) => {
        request.departureAt = new Date(Number.NaN);
      },
    },
    {
      name: "departure outside the current planning horizon",
      mutate: (request: typeof routeRequest) => {
        request.departureAt = new Date("2027-08-22T12:00:00.000Z");
      },
    },
    {
      name: "same origin and destination point",
      mutate: (request: typeof routeRequest) => {
        request.destination.latitude = request.origin.latitude;
        request.destination.longitude = request.origin.longitude;
      },
    },
  ])("rejects an invalid request with a safe typed error: $name", async ({ mutate }) => {
    const request = structuredClone(routeRequest);
    mutate(request);
    const port = new MemoryOtpPlanPort(busPlan());
    const engine = createRouteEngine(port, {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    await expect(engine.planCandidates(request)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
    expect(port.requests).toEqual([]);
  });

  it.each([
    {
      name: "walk-only itinerary",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[1]!.mode = "WALK";
      },
    },
    {
      name: "overlapping leg times",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[1]!.startTime =
          Date.parse("2026-08-20T12:01:00.000Z");
      },
    },
    {
      name: "disconnected adjacent legs",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[1]!.from = {
          name: "Teleported boarding point",
          lat: 37.82,
          lon: -122.37,
          stop: { gtfsId: "SF:OTHER" },
        };
      },
    },
    {
      name: "geometry disconnected from its places",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[0]!.legGeometry = {
          points: "oyleFjtdjVwcAkHw|AoK",
        };
      },
    },
    {
      name: "more than 32 intermediate stops",
      mutate: (response: OtpFixture) => {
        response.data.planConnection.edges[0]!.node.legs[1]!
          .intermediateStops = Array.from({ length: 33 }, (_, index) => ({
          gtfsId: "SF:MID-" + index,
        }));
      },
    },
  ])("rejects $name instead of partially publishing", async ({ mutate }) => {
    const response = transitPlan(["BUS"]);
    mutate(response);
    const engine = createRouteEngine(new MemoryOtpPlanPort(response), {
      clock: () => new Date("2026-08-20T11:55:00.000Z"),
    });

    await expect(engine.planCandidates(routeRequest)).rejects.toEqual(
      new RouteEngineUnavailableError(),
    );
  });
});
