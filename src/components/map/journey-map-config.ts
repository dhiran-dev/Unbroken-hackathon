export const CITYWIDE_JOURNEY_ROUTE_SOURCE_ID = "citywide-journey-routes";
export const CITYWIDE_JOURNEY_MARKER_SOURCE_ID = "citywide-journey-markers";
export const CITYWIDE_LIVE_VEHICLE_SOURCE_ID = "citywide-live-vehicles";

export const CITYWIDE_JOURNEY_ROUTE_LAYER_ID = "citywide-journey-route-lines";
export const CITYWIDE_JOURNEY_MARKER_POINT_LAYER_ID =
  "citywide-journey-marker-points";
export const CITYWIDE_JOURNEY_MARKER_LABEL_LAYER_ID =
  "citywide-journey-marker-labels";
export const CITYWIDE_LIVE_VEHICLE_POINT_LAYER_ID =
  "citywide-live-vehicle-points";
export const CITYWIDE_LIVE_VEHICLE_LABEL_LAYER_ID =
  "citywide-live-vehicle-labels";

export const CITYWIDE_JOURNEY_ROUTE_SOURCE = {
  type: "geojson",
  cluster: false,
} as const;

export const CITYWIDE_JOURNEY_MARKER_SOURCE = {
  type: "geojson",
  cluster: false,
} as const;

export const CITYWIDE_LIVE_VEHICLE_SOURCE = {
  type: "geojson",
  cluster: false,
} as const;

export const CITYWIDE_JOURNEY_ROUTE_LAYER = {
  id: CITYWIDE_JOURNEY_ROUTE_LAYER_ID,
  type: "line",
  source: CITYWIDE_JOURNEY_ROUTE_SOURCE_ID,
  layout: { "line-cap": "round", "line-join": "round" },
  paint: {
    "line-color": "#1b4ed8",
    "line-width": [
      "match",
      ["get", "legType"],
      "walk",
      4,
      "wait",
      3,
      "transfer",
      5,
      6,
    ],
    "line-opacity": 0.9,
    "line-dasharray": [
      "match",
      ["get", "legType"],
      "walk",
      [1, 2],
      "wait",
      [0.5, 2],
      "transfer",
      [2, 1],
      [1, 0],
    ],
  },
} as const;

export const CITYWIDE_JOURNEY_MARKER_POINT_LAYER = {
  id: CITYWIDE_JOURNEY_MARKER_POINT_LAYER_ID,
  type: "circle",
  source: CITYWIDE_JOURNEY_MARKER_SOURCE_ID,
  paint: {
    "circle-color": "#ffffff",
    "circle-radius": [
      "match",
      ["get", "shape"],
      "origin",
      10,
      "destination",
      10,
      "transfer",
      9,
      "warning",
      8,
      7,
    ],
    "circle-stroke-color": "#111827",
    "circle-stroke-width": 2,
  },
} as const;

export const CITYWIDE_JOURNEY_MARKER_LABEL_LAYER = {
  id: CITYWIDE_JOURNEY_MARKER_LABEL_LAYER_ID,
  type: "symbol",
  source: CITYWIDE_JOURNEY_MARKER_SOURCE_ID,
  layout: {
    "text-field": [
      "match",
      ["get", "shape"],
      "origin",
      "A",
      "destination",
      "D",
      "transfer",
      "↔",
      "endpoint",
      "•",
      "accessible-stop",
      "✓",
      "!",
    ],
    "text-size": 12,
    "text-allow-overlap": true,
    "text-ignore-placement": true,
    "text-offset": [0, 0.05],
  },
  paint: {
    "text-color": "#111827",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1,
  },
} as const;

export const CITYWIDE_LIVE_VEHICLE_POINT_LAYER = {
  id: CITYWIDE_LIVE_VEHICLE_POINT_LAYER_ID,
  type: "symbol",
  source: CITYWIDE_LIVE_VEHICLE_SOURCE_ID,
  layout: {
    "text-field": "▲",
    "text-size": 18,
    "text-rotate": ["coalesce", ["get", "bearing"], 0],
    "text-rotation-alignment": "map",
    "text-allow-overlap": true,
    "text-ignore-placement": true,
  },
  paint: {
    "text-color": "#f59e0b",
    "text-halo-color": "#111827",
    "text-halo-width": 1,
  },
} as const;

export const CITYWIDE_LIVE_VEHICLE_LABEL_LAYER = {
  id: CITYWIDE_LIVE_VEHICLE_LABEL_LAYER_ID,
  type: "symbol",
  source: CITYWIDE_LIVE_VEHICLE_SOURCE_ID,
  layout: {
    "text-field": ["get", "routeId"],
    "text-size": 11,
    "text-allow-overlap": true,
    "text-ignore-placement": true,
    "text-offset": [0, 1.25],
  },
  paint: {
    "text-color": "#111827",
    "text-halo-color": "#ffffff",
    "text-halo-width": 1,
  },
} as const;
