import { expect, test } from "@playwright/test";

const places = {
  groups: [
    {
      id: "nearby_stops",
      label: "Nearby stops",
      places: [
        {
          id: "stop:market-street",
          type: "stop",
          name: "Market Street",
          description: "Muni stop",
          latitude: 37.78,
          longitude: -122.41,
          stopIds: ["market-street"],
          routeNames: ["5 Fulton"],
        },
      ],
    },
    {
      id: "stations",
      label: "Stations",
      places: [],
    },
    {
      id: "places",
      label: "Places",
      places: [
        {
          id: "landmark:ferry-building",
          type: "landmark",
          name: "Ferry Building",
          description: "Destination point",
          latitude: 37.7955,
          longitude: -122.3937,
          stopIds: [],
          routeNames: [],
        },
      ],
    },
  ],
};

const plan = {
  status: "confirmed",
  title: "Step-free details confirmed",
  summary: "Take the 5 Fulton toward the waterfront.",
  departureAt: "2026-08-20T12:00:00.000Z",
  arrivalAt: "2026-08-20T12:32:00.000Z",
  durationMinutes: 32,
  legs: [
    {
      type: "ride",
      from: "Market Street",
      to: "Ferry Building",
      startAt: "2026-08-20T12:00:00.000Z",
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
  warnings: ["A current service update may affect this journey."],
  changes: ["Boarding uses a temporary stop."],
  sources: [],
  map: {
    bounds: { north: 37.8, south: 37.77, east: -122.39, west: -122.42 },
    origin: { type: "Point", coordinates: [-122.41, 37.78] },
    destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
    affectedStops: {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: { type: "Point", coordinates: [-122.4, 37.79] },
          properties: {
            id: "STOP-MOVE-1",
            name: "Temporary boarding stop",
            accessibility: "blocked",
          },
        },
      ],
    },
  },
};

const noRidePlan = {
  ...plan,
  legs: [
    {
      ...plan.legs[0],
      type: "walk",
      route: undefined,
    },
  ],
};

test.describe("citywide journey map overlay", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CITYWIDE_PLANNER_ENABLED !== "true",
      "CITYWIDE_PLANNER_ENABLED=true is required for the citywide surface.",
    );
    await page.route("**/api/public/places?*", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      const normalized = query.trim().toLowerCase();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          groups: places.groups.map((group) => ({
            ...group,
            places: group.places.filter((place) =>
              `${place.name} ${place.description}`
                .toLowerCase()
                .includes(normalized),
            ),
          })),
        }),
      });
    });
    await page.route("**/api/public/journeys", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(plan),
      });
    });
    await page.route("**/api/public/map/stops.geojson**", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/geo+json" },
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              id: "STOP-1",
              properties: {
                id: "STOP-1",
                name: "Market Street",
                code: "10001",
                locationType: 0,
                parentStationId: null,
              },
              geometry: { type: "Point", coordinates: [-122.41, 37.78] },
            },
          ],
        }),
      });
    });
    await page.route("**/api/public/live?*", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/geo+json" },
        body: JSON.stringify({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: { type: "Point", coordinates: [-122.4, 37.79] },
              properties: {
                routeId: "5",
                bearing: 90,
                observedAt: "2026-08-20T12:05:00.000Z",
              },
            },
          ],
        }),
      });
    });
    await page.goto("/");
  });

  test("shows route shapes, current warning text, and live vehicles without replacing the text journey", async ({
    page,
  }) => {
    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });
    await from.fill("market");
    await expect(
      page.getByRole("option", { name: /Market Street/ }),
    ).toBeVisible({ timeout: 10_000 });
    await from.press("ArrowDown");
    await from.press("Enter");
    await to.fill("ferry");
    await expect(
      page.getByRole("option", { name: /Ferry Building/ }),
    ).toBeVisible({ timeout: 10_000 });
    await to.press("ArrowDown");
    await to.press("Enter");
    await page.getByRole("button", { name: "Find a step-free route" }).click();

    const map = page.getByRole("region", {
      name: "Citywide active Muni stop map",
    });
    await expect(map.locator('[data-journey-overlay="true"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      map.getByRole("heading", { name: "Journey map details" }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      map.getByText(
        "Current warning: A current service update may affect this journey.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      map.getByText("Current vehicle", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(map.locator('[data-live-status="current"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map.locator('[data-journey-route-count="1"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map.locator('[data-journey-marker-count="3"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map.locator('[data-live-vehicle-count="1"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map).toHaveAttribute("data-stop-count", "1");
    await expect(
      map.getByText(
        "Step 1: Ride from Market Street to Ferry Building on 5 Fulton",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      map.getByText("Current change: Boarding uses a temporary stop.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      map.getByText("Text alternative", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page).toHaveURL("/");
  });
  test("does not request live vehicles for a walk-only journey", async ({
    page,
  }) => {
    await page.unroute("**/api/public/journeys");
    await page.route("**/api/public/journeys", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(noRidePlan),
      });
    });
    let liveRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/public/live") {
        liveRequests += 1;
      }
    });

    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });
    await from.fill("market");
    await expect(
      page.getByRole("option", { name: /Market Street/ }),
    ).toBeVisible({ timeout: 10_000 });
    await from.press("ArrowDown");
    await from.press("Enter");
    await to.fill("ferry");
    await expect(
      page.getByRole("option", { name: /Ferry Building/ }),
    ).toBeVisible({ timeout: 10_000 });
    await to.press("ArrowDown");
    await to.press("Enter");
    await page.getByRole("button", { name: "Find a step-free route" }).click();

    const map = page.getByRole("region", {
      name: "Citywide active Muni stop map",
    });
    await expect(
      map.locator('[data-live-status="not_applicable"]'),
    ).toBeVisible({ timeout: 10_000 });
    await expect(map.locator('[data-live-vehicle-count="0"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      map.getByText("Current vehicle updates are unavailable.", {
        exact: false,
      }),
    ).toHaveCount(0);
    expect(liveRequests).toBe(0);
  });

  test("clears vehicle state after an invalid live refresh while retaining the journey details", async ({
    page,
  }) => {
    await page.unroute("**/api/public/live?*");
    await page.route("**/api/public/live?*", async (route) => {
      await route.fulfill({
        status: 503,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "unavailable" }),
      });
    });

    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });
    await from.fill("market");
    await expect(
      page.getByRole("option", { name: /Market Street/ }),
    ).toBeVisible({ timeout: 10_000 });
    await from.press("ArrowDown");
    await from.press("Enter");
    await to.fill("ferry");
    await expect(
      page.getByRole("option", { name: /Ferry Building/ }),
    ).toBeVisible({ timeout: 10_000 });
    await to.press("ArrowDown");
    await to.press("Enter");
    await page.getByRole("button", { name: "Find a step-free route" }).click();

    const map = page.getByRole("region", {
      name: "Citywide active Muni stop map",
    });
    await expect(map.locator('[data-live-status="unavailable"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map.locator('[data-live-vehicle-count="0"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map.locator('[data-journey-route-count="1"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map.locator('[data-journey-marker-count="3"]')).toBeVisible({
      timeout: 10_000,
    });
    await expect(map).toHaveAttribute("data-stop-count", "1");
    await expect(
      map.getByText(
        "Step 1: Ride from Market Street to Ferry Building on 5 Fulton",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      map.getByText(
        "Current warning: A current service update may affect this journey.",
        { exact: true },
      ),
    ).toBeVisible({ timeout: 10_000 });
    await expect(
      map.getByText("Current change: Boarding uses a temporary stop.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 10_000 });
  });
});
