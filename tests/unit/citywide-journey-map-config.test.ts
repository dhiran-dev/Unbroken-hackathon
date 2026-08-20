import { describe, expect, it } from "vitest";

import {
  CITYWIDE_JOURNEY_MARKER_LABEL_LAYER,
  CITYWIDE_JOURNEY_MARKER_POINT_LAYER,
  CITYWIDE_JOURNEY_MARKER_SOURCE,
  CITYWIDE_JOURNEY_ROUTE_LAYER,
  CITYWIDE_JOURNEY_ROUTE_SOURCE,
  CITYWIDE_LIVE_VEHICLE_LABEL_LAYER,
  CITYWIDE_LIVE_VEHICLE_POINT_LAYER,
  CITYWIDE_LIVE_VEHICLE_SOURCE,
} from "@/components/map/journey-map-config";
import { JOURNEY_MAP_LEGEND } from "@/components/map/journey-map-overlay";

describe("citywide journey map configuration", () => {
  it("keeps every overlay source unclustered and gives markers non-color shapes", () => {
    expect(CITYWIDE_JOURNEY_ROUTE_SOURCE).toMatchObject({
      type: "geojson",
      cluster: false,
    });
    expect(CITYWIDE_JOURNEY_MARKER_SOURCE).toMatchObject({
      type: "geojson",
      cluster: false,
    });
    expect(CITYWIDE_LIVE_VEHICLE_SOURCE).toMatchObject({
      type: "geojson",
      cluster: false,
    });
    expect(CITYWIDE_JOURNEY_ROUTE_LAYER.paint["line-color"]).toBe("#1b4ed8");
    expect(CITYWIDE_JOURNEY_MARKER_POINT_LAYER.paint["circle-color"]).toBe(
      "#ffffff",
    );
    expect(CITYWIDE_JOURNEY_MARKER_LABEL_LAYER.layout["text-field"]).toEqual(
      expect.arrayContaining(["origin", "destination", "transfer"]),
    );
    expect(CITYWIDE_LIVE_VEHICLE_POINT_LAYER.type).toBe("symbol");
    expect(CITYWIDE_LIVE_VEHICLE_POINT_LAYER.layout).toMatchObject({
      "text-field": "▲",
      "text-rotate": ["coalesce", ["get", "bearing"], 0],
    });
    expect(CITYWIDE_LIVE_VEHICLE_POINT_LAYER.paint).toMatchObject({
      "text-color": "#f59e0b",
    });
    expect(CITYWIDE_LIVE_VEHICLE_LABEL_LAYER.layout["text-field"]).toEqual([
      "get",
      "routeId",
    ]);
    expect(JOURNEY_MAP_LEGEND).toContainEqual(
      expect.objectContaining({
        shape: "accessible-stop",
        label: "Confirmed stop details",
      }),
    );
  });
});
