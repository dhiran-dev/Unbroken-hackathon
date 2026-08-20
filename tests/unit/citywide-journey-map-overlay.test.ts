import { describe, expect, it, vi } from "vitest";

import {
  fitMapToJourney,
  moveMapToSelectedCoordinate,
  normalizeLiveVehicleGeoJson,
  liveVehicleRequestUrl,
  journeyOverlayForPlan,
  updateLiveVehicleSource,
} from "@/components/map/journey-map-overlay";

const plan = {
  status: "confirmed" as const,
  title: "Step-free route",
  summary: "Take the N toward Caltrain.",
  departureAt: "2026-08-20T10:00:00Z",
  arrivalAt: "2026-08-20T10:20:00Z",
  durationMinutes: 20,
  legs: [
    {
      type: "ride" as const,
      from: "Origin stop",
      to: "Transfer stop",
      startAt: "2026-08-20T10:00:00Z",
      endAt: "2026-08-20T10:10:00Z",
      durationMinutes: 10,
      route: {
        id: "N",
        name: "N Judah",
        color: "#123456",
        destination: "Caltrain",
      },
      instruction: "Board the N toward Caltrain.",
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [-122.42, 37.75] as [number, number],
          [-122.41, 37.76] as [number, number],
        ],
      },
      accessibility: { state: "confirmed" as const, reasons: [] },
    },
    {
      type: "transfer" as const,
      from: "Transfer stop",
      to: "Destination stop",
      startAt: "2026-08-20T10:10:00Z",
      endAt: "2026-08-20T10:20:00Z",
      durationMinutes: 10,
      instruction: "Transfer to the accessible platform.",
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [-122.41, 37.76] as [number, number],
          [-122.4, 37.77] as [number, number],
        ],
      },
      accessibility: { state: "unknown" as const, reasons: ["Check lift"] },
    },
    {
      type: "walk" as const,
      from: "Destination stop",
      to: "Named entrance",
      startAt: "2026-08-20T10:20:00Z",
      endAt: "2026-08-20T10:20:00Z",
      durationMinutes: 0,
      route: {
        id: "walk,not-a-filter",
        name: "Walking connection",
        color: "#123456",
        destination: "Named entrance",
      },
      instruction: "Walk to the named entrance.",
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [-122.4, 37.77] as [number, number],
          [-122.399, 37.771] as [number, number],
        ],
      },
      accessibility: { state: "confirmed" as const, reasons: [] },
    },
  ],
  warnings: ["A current service update may affect this journey."],
  changes: ["Boarding uses a temporary stop."],
  sources: [],
  map: {
    bounds: { west: -122.43, south: 37.74, east: -122.39, north: 37.78 },
    origin: {
      type: "Point" as const,
      coordinates: [-122.42, 37.75] as [number, number],
    },
    destination: {
      type: "Point" as const,
      coordinates: [-122.399, 37.771] as [number, number],
    },
    affectedStops: {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [-122.405, 37.765] as [number, number],
          },
          properties: {
            id: "STOP-1",
            name: "Transfer stop",
            accessibility: "blocked" as const,
          },
        },
      ],
    },
  },
};

describe("citywide journey map overlay", () => {
  it("projects route geometry and non-color marker shapes without changing static stops", () => {
    const overlay = journeyOverlayForPlan(plan);
    expect(overlay).not.toBeNull();
    if (!overlay) return;

    expect(overlay.routes.features).toHaveLength(3);
    expect(overlay.routes.features[0]?.properties).toMatchObject({
      kind: "journey-leg",
      legType: "ride",
      routeId: "N",
      from: "Origin stop",
      to: "Transfer stop",
    });
    expect(overlay.routeIds).toEqual(["N"]);
    expect(
      overlay.markers.features.map((feature) => feature.properties.kind),
    ).toEqual([
      "origin",
      "transfer",
      "transfer",
      "destination",
      "affected-stop",
    ]);
    expect(
      overlay.markers.features.find(
        (feature) => feature.properties.kind === "affected-stop",
      )?.properties,
    ).toMatchObject({
      accessibility: "blocked",
      shape: "warning",
    });
    expect(
      overlay.markers.features.map((feature) => feature.properties.label),
    ).toContain("Transfer: Transfer stop");
  });

  it("fails closed for an untrusted plan before map use", () => {
    expect(journeyOverlayForPlan({ ...plan, title: "<unsafe>" })).toBeNull();
  });

  it("fails closed for map bounds and coordinates outside the citywide service area", () => {
    expect(
      journeyOverlayForPlan({
        ...plan,
        map: {
          ...plan.map,
          bounds: { west: -80, south: 35, east: -79, north: 36 },
        },
      }),
    ).toBeNull();
    expect(
      journeyOverlayForPlan({
        ...plan,
        map: {
          ...plan.map,
          bounds: {
            west: -122.43,
            south: 37.74,
            east: -122.39,
            north: 37.78,
          },
          origin: { type: "Point", coordinates: [-121, 37.75] },
        },
      }),
    ).toBeNull();
    expect(
      journeyOverlayForPlan({
        ...plan,
        map: {
          ...plan.map,
          bounds: {
            west: -122.42,
            south: 37.75,
            east: -122.42,
            north: 37.75,
          },
        },
      }),
    ).toBeNull();
    expect(
      journeyOverlayForPlan({
        ...plan,
        map: {
          ...plan.map,
          bounds: {
            west: -122.43,
            south: 37.74,
            east: -122.415,
            north: 37.78,
          },
        },
      }),
    ).toBeNull();
  });

  it("rejects a plan whose legs do not connect the complete journey", () => {
    const firstLeg = plan.legs[0];
    if (!firstLeg) throw new Error("fixture leg missing");
    expect(
      journeyOverlayForPlan({
        ...plan,
        legs: [
          {
            ...firstLeg,
            geometry: {
              type: "LineString",
              coordinates: [
                [-122.43, 37.75],
                ...firstLeg.geometry.coordinates.slice(1),
              ],
            },
          },
          ...plan.legs.slice(1),
        ],
      }),
    ).toBeNull();
  });

  it("validates bounded public vehicles and excludes raw provider identifiers", () => {
    const value = normalizeLiveVehicleGeoJson({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-122.4, 37.77] },
          properties: {
            routeId: "N",
            bearing: null,
            observedAt: "2026-08-20T10:00:00Z",
          },
        },
      ],
    });

    expect(value).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          id: "vehicle-0",
          geometry: { type: "Point", coordinates: [-122.4, 37.77] },
          properties: {
            routeId: "N",
            bearing: null,
            observedAt: "2026-08-20T10:00:00Z",
          },
        },
      ],
    });
    expect(
      normalizeLiveVehicleGeoJson({
        type: "FeatureCollection",
        features: Array.from({ length: 257 }, () => ({
          type: "Feature",
          id: "v",
          geometry: { type: "Point", coordinates: [-122.4, 37.77] },
          properties: {
            routeId: "N",
            bearing: 0,
            observedAt: "2026-08-20T10:00:00Z",
          },
        })),
      }),
    ).toBeNull();
    expect(
      normalizeLiveVehicleGeoJson({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-122.4, 37.77] },
            properties: {
              routeId: "N,5",
              bearing: 90,
              observedAt: "2026-08-20T10:00:00Z",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  it("fits the complete journey in 600ms and jumps immediately for reduced motion", () => {
    const map = { fitBounds: vi.fn(), jumpTo: vi.fn(), flyTo: vi.fn() };

    fitMapToJourney(map, plan.map.bounds, false);
    expect(map.fitBounds).toHaveBeenCalledWith(
      [-122.43, 37.74, -122.39, 37.78],
      expect.objectContaining({ duration: 600 }),
    );

    fitMapToJourney(map, plan.map.bounds, true);
    expect(map.fitBounds).toHaveBeenLastCalledWith(
      [-122.43, 37.74, -122.39, 37.78],
      expect.objectContaining({ duration: 0 }),
    );
  });

  it("flies to a selected coordinate unless reduced motion is requested", () => {
    const map = { fitBounds: vi.fn(), jumpTo: vi.fn(), flyTo: vi.fn() };

    moveMapToSelectedCoordinate(map, [-122.4, 37.77], false);
    expect(map.flyTo).toHaveBeenCalledWith(
      expect.objectContaining({ center: [-122.4, 37.77], duration: 600 }),
    );
    moveMapToSelectedCoordinate(map, [-122.42, 37.75], true);
    expect(map.jumpTo).toHaveBeenCalledWith({ center: [-122.42, 37.75] });
  });

  it("builds a bounded route-filtered live URL only for selected transit routes", () => {
    expect(
      liveVehicleRequestUrl(
        { west: -122.7, south: 37.6, east: -122.2, north: 37.9 },
        ["N", "N", "<private>"],
      ),
    ).toBe(
      "/api/public/live?bbox=-122.580000%2C37.680000%2C-122.310000%2C37.860000&routeIds=N",
    );
    expect(
      liveVehicleRequestUrl(
        { west: -122.7, south: 37.6, east: -122.2, north: 37.9 },
        [],
      ),
    ).toBeNull();
    expect(
      liveVehicleRequestUrl(
        { west: -122.4, south: 37.75, east: -122.4, north: 37.76 },
        ["N"],
      ),
    ).toBeNull();
    expect(
      liveVehicleRequestUrl(
        { west: -122.7, south: 37.6, east: -122.2, north: 37.9 },
        ["N,5"],
      ),
    ).toBeNull();
  });
  it("updates an existing vehicle source through setData without rebuilding map layers", () => {
    const source = { setData: vi.fn() };
    const map = {
      getSource: vi.fn(() => source),
      addSource: vi.fn(),
      addLayer: vi.fn(),
    };
    const vehicles = { type: "FeatureCollection" as const, features: [] };

    expect(updateLiveVehicleSource(map, vehicles)).toBe(true);
    expect(source.setData).toHaveBeenCalledWith(vehicles);
    expect(map.addSource).not.toHaveBeenCalled();
    expect(map.addLayer).not.toHaveBeenCalled();
  });

  it("does not animate a zero-area or out-of-city camera bounds", () => {
    const map = { fitBounds: vi.fn() };

    expect(
      fitMapToJourney(
        map,
        { west: -122.4, south: 37.75, east: -122.4, north: 37.76 },
        false,
      ),
    ).toBe(false);
    expect(
      fitMapToJourney(
        map,
        { west: -80, south: 35, east: -79, north: 36 },
        false,
      ),
    ).toBe(false);
    expect(map.fitBounds).not.toHaveBeenCalled();
  });
});
