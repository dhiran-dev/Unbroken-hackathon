import { describe, expect, it } from "vitest";

import {
  normalizeStopMapGeoJson,
  type PublicStopFeatureCollection,
} from "../../src/components/map/stop-map-geojson";

const feature = {
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
};

function collection(overrides: Partial<PublicStopFeatureCollection> = {}) {
  return {
    type: "FeatureCollection" as const,
    features: [feature],
    ...overrides,
  };
}

describe("normalizeStopMapGeoJson", () => {
  it("clones the exact public allowlist", () => {
    const value = collection({
      private: "must not survive",
      features: [
        {
          ...feature,
          private: "must not survive",
          properties: { ...feature.properties, private: "must not survive" },
          geometry: { ...feature.geometry, private: "must not survive" },
        },
      ],
    } as never);

    expect(normalizeStopMapGeoJson(value)).toBeNull();
  });

  it("returns a public feature collection with the exact shape", () => {
    expect(normalizeStopMapGeoJson(collection())).toEqual(collection());
  });

  it.each([
    ["missing content type shape", { ...collection(), type: "Feature" }],
    ["duplicate IDs", collection({ features: [feature, feature] })],
    [
      "mismatched property ID",
      collection({
        features: [
          { ...feature, properties: { ...feature.properties, id: "STOP-2" } },
        ],
      }),
    ],
    [
      "unsafe text",
      collection({
        features: [
          { ...feature, properties: { ...feature.properties, name: "<bad>" } },
        ],
      }),
    ],
    [
      "invalid nullable",
      collection({
        features: [
          {
            ...feature,
            properties: { ...feature.properties, code: 0 as never },
          },
        ],
      }),
    ],
    [
      "invalid location type",
      collection({
        features: [
          {
            ...feature,
            properties: { ...feature.properties, locationType: 9 },
          },
        ],
      }),
    ],
    [
      "outside San Francisco",
      collection({
        features: [
          {
            ...feature,
            geometry: { ...feature.geometry, coordinates: [-122.4, 40] },
          },
        ],
      }),
    ],
    [
      "non-finite coordinate",
      collection({
        features: [
          {
            ...feature,
            geometry: {
              ...feature.geometry,
              coordinates: [-122.4, Number.NaN],
            },
          },
        ],
      }),
    ],
  ] as const)("fails closed for %s", (_reason, value) => {
    expect(normalizeStopMapGeoJson(value)).toBeNull();
  });
});
