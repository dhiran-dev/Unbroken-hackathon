import { expect, test, type Page } from "@playwright/test";

const mapRegion = (page: Page) =>
  page.getByRole("region", { name: "Citywide active Muni stop map" });

async function routeSyntheticStopMap(page: Page) {
  await page.route("**/api/public/map/stops.geojson**", async (route) => {
    const version = new URL(route.request().url()).searchParams.get("v");
    if (!version) return route.continue();
    await route.fulfill({
      status: 200,
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": "application/geo+json",
        ETag: JSON.stringify(version),
      },
      body: JSON.stringify({
        type: "FeatureCollection",
        features: Array.from({ length: 3_238 }, (_, index) => {
          const id = "STOP-" + String(index).padStart(4, "0");
          return {
            type: "Feature",
            id,
            properties: {
              id,
              name: "Muni stop " + index,
              code: String(index).padStart(5, "0"),
              locationType: 0,
              parentStationId: null,
            },
            geometry: {
              type: "Point",
              coordinates: [
                -122.5 + (index % 200) / 10_000,
                37.7 + (index % 200) / 10_000,
              ],
            },
          };
        }),
      }),
    });
  });
}

test.describe("citywide stop map", () => {
  test.beforeEach(async () => {
    test.skip(
      process.env.CITYWIDE_PLANNER_ENABLED !== "true",
      "CITYWIDE_PLANNER_ENABLED=true is required for the citywide surface.",
    );
  });
  test("renders all active stops individually without clustering", async ({
    page,
  }) => {
    await routeSyntheticStopMap(page);
    await page.goto("/");
    const map = mapRegion(page);
    await expect(map).toBeVisible();
    await expect(map.locator("canvas")).toBeVisible();
    await expect(map).toHaveAttribute("data-stop-count", "3238");
    await expect(map).toHaveAttribute("data-stop-cluster", "false");
    await expect(
      map.getByText("Text alternative", { exact: true }),
    ).toBeVisible();
    await expect(map.locator('ol[aria-label="Active Muni stops"]')).toHaveCount(
      0,
    );
    const textAlternative = map
      .locator("summary")
      .filter({ hasText: "Text alternative" });
    await textAlternative.scrollIntoViewIfNeeded();
    await expect(textAlternative).toBeInViewport();
    await textAlternative.click();
    await expect(map.locator('ol[aria-label="Active Muni stops"]')).toHaveCount(
      1,
    );
    await expect(
      map.locator('ol[aria-label="Active Muni stops"] > li'),
    ).toHaveCount(3_238);
  });

  test("uses the dark CARTO style while retaining the same stop data", async ({
    page,
  }) => {
    await routeSyntheticStopMap(page);
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    const map = mapRegion(page);
    await expect(map).toHaveAttribute(
      "data-map-style",
      "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    );
    await expect(map).toHaveAttribute("data-stop-count", "3238");
    await expect(map.locator("canvas")).toBeVisible();
  });

  test("keeps the text alternative when the map request fails", async ({
    page,
  }) => {
    await page.route("**/api/public/map/stops.geojson**", async (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          available: false,
          code: "STOP_MAP_UNAVAILABLE",
          message: "Map is unavailable. Use the trip steps instead.",
        }),
      }),
    );
    await page.goto("/");
    await expect(
      page.getByText("Map is unavailable. Use the trip steps instead.", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Citywide active Muni stop map" })
        .getByText("Text alternative", { exact: true }),
    ).toBeVisible();
  });
});
