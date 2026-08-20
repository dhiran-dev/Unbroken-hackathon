import { describe, expect, it } from "vitest";

import {
  CARTO_DARK_STYLE_URL,
  CARTO_LIGHT_STYLE_URL,
  CITYWIDE_STOP_HIT_LAYER,
  CITYWIDE_STOP_LABEL_LAYER,
  CITYWIDE_STOP_POINT_LAYER,
  CITYWIDE_STOP_SOURCE,
  cartoStyleUrl,
  isSafeCartoStyleUrl,
} from "../../src/components/map/stop-map-config";

describe("citywide stop map configuration", () => {
  it("uses the fixed CARTO light and dark styles by default", () => {
    expect(cartoStyleUrl("light", {})).toBe(CARTO_LIGHT_STYLE_URL);
    expect(cartoStyleUrl("dark", {})).toBe(CARTO_DARK_STYLE_URL);
  });

  it.each([
    "http://basemaps.cartocdn.com/gl/custom/style.json",
    "https://tiles.example.test/style.json",
    "https://basemaps.cartocdn.com/gl/custom/style.json?token=secret",
    "https://user:password@basemaps.cartocdn.com/gl/custom/style.json",
    "https://basemaps.cartocdn.com/gl/custom/style.json#private",
  ])("rejects an unsafe public style override: %s", (value) => {
    expect(isSafeCartoStyleUrl(value)).toBe(false);
    expect(
      cartoStyleUrl("light", { NEXT_PUBLIC_CARTO_LIGHT_STYLE_URL: value }),
    ).toBe(CARTO_LIGHT_STYLE_URL);
  });

  it("accepts only a credential-free HTTPS CARTO override", () => {
    const override = "https://basemaps.cartocdn.com/gl/custom/style.json";
    expect(isSafeCartoStyleUrl(override)).toBe(true);
    expect(
      cartoStyleUrl("dark", { NEXT_PUBLIC_CARTO_DARK_STYLE_URL: override }),
    ).toBe(override);
  });

  it("keeps stop data unclustered and exposes separate point, hit, and label layers", () => {
    expect(CITYWIDE_STOP_SOURCE).toMatchObject({
      type: "geojson",
      cluster: false,
    });
    expect(CITYWIDE_STOP_POINT_LAYER).toMatchObject({ type: "circle" });
    expect(CITYWIDE_STOP_HIT_LAYER).toMatchObject({
      type: "circle",
      paint: { "circle-opacity": 0 },
    });
    expect(CITYWIDE_STOP_LABEL_LAYER).toMatchObject({
      type: "symbol",
      minzoom: 12,
      layout: { "text-field": ["get", "name"] },
    });
    expect(CITYWIDE_STOP_HIT_LAYER.paint["circle-radius"]).toBeGreaterThan(
      CITYWIDE_STOP_POINT_LAYER.paint["circle-radius"],
    );
  });
});
