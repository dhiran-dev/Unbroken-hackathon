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

function placesForQuery(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return {
    groups: places.groups.map((group) => ({
      ...group,
      places: group.places.filter((place) => {
        if (!normalizedQuery) return true;
        return `${place.name} ${place.description}`
          .toLowerCase()
          .includes(normalizedQuery);
      }),
    })),
  };
}

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
  warnings: [],
  changes: [],
  sources: [
    {
      source: "schedule",
      checkedAt: "2026-08-20T11:55:00.000Z",
      sourceUpdatedAt: null,
      freshness: "current",
      sourceUrl: "https://511.org/open-data/transit",
    },
  ],
  map: {
    bounds: { north: 37.8, south: 37.77, east: -122.39, west: -122.42 },
    origin: { type: "Point", coordinates: [-122.41, 37.78] },
    destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
};

test.describe("citywide place selection", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CITYWIDE_PLANNER_ENABLED !== "true",
      "CITYWIDE_PLANNER_ENABLED=true is required for the citywide surface.",
    );
    await page.route("**/api/public/places?*", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      await route.fulfill({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: placesForQuery(query),
      });
    });
    await page.route("**/api/public/journeys", async (route) => {
      await route.fulfill({ status: 200, json: plan });
    });
    await page.goto("/");
  });

  test("selects both places with keyboard-only controls and sends the exact request", async ({
    page,
  }) => {
    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });
    await from.fill("market");
    await expect(page.getByText("1 place available.", { exact: true })).toBeVisible();
    await from.press("ArrowDown");
    await from.press("Enter");
    await to.fill("ferry");
    await expect(page.getByText("1 place available.", { exact: true })).toBeVisible();
    await to.press("ArrowDown");
    await to.press("Enter");

    await expect(from).toHaveValue("Market Street");
    await expect(to).toHaveValue("Ferry Building");
    const button = page.getByRole("button", { name: "Find a step-free route" });
    await expect(button).toBeEnabled();
    const requestPromise = page.waitForRequest("**/api/public/journeys");
    await button.click();
    const request = await requestPromise;
    expect(request.postDataJSON()).toEqual({
      origin: { type: "catalog", placeId: "stop:market-street" },
      destination: { type: "catalog", placeId: "landmark:ferry-building" },
      departureAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T[^\s]+\.\d{3}Z$/u),
    });
  });

  test("clears a selection when typed text is edited and exposes the fixed error", async ({
    page,
  }) => {
    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });
    await from.fill("market");
    await expect(page.getByText("1 place available.", { exact: true })).toBeVisible();
    await from.press("ArrowDown");
    await from.press("Enter");
    await to.fill("ferry");
    await expect(page.getByText("1 place available.", { exact: true })).toBeVisible();
    await to.press("ArrowDown");
    await to.press("Enter");
    await from.fill("Market Street edited");

    await expect(
      page.getByRole("button", { name: "Find a step-free route" }),
    ).toBeDisabled();
    await expect(page.locator("#citywide-form-error")).toHaveText(
      "Choose a place from the list.",
    );
  });

  test("swaps selected From and To values", async ({ page }) => {
    const from = page.getByRole("combobox", { name: "From" });
    const to = page.getByRole("combobox", { name: "To" });
    await from.fill("market");
    await expect(page.getByText("1 place available.", { exact: true })).toBeVisible();
    await from.press("ArrowDown");
    await from.press("Enter");
    await to.fill("ferry");
    await expect(page.getByText("1 place available.", { exact: true })).toBeVisible();
    await to.press("ArrowDown");
    await to.press("Enter");
    await page.getByRole("button", { name: "Swap From and To" }).click();
    await expect(from).toHaveValue("Ferry Building");
    await expect(to).toHaveValue("Market Street");
  });

  test("uses allowed GPS once and keeps raw coordinates out of the page", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(
            success: (position: unknown) => void,
          ) {
            success({
              coords: { latitude: 37.78, longitude: -122.41, accuracy: 20 },
            });
          },
        },
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.getByRole("combobox", { name: "From" })).toHaveValue(
      "Current location",
    );
    expect(await page.locator("body").textContent()).not.toContain("37.78");
    expect(await page.locator("body").textContent()).not.toContain("-122.41");
  });

  test("shows exact denied GPS copy and does not retry the one-time attempt", async ({
    page,
  }) => {
    await page.addInitScript((mode: string) => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(
            success: (position: unknown) => void,
            failure: (error: unknown) => void,
          ) {
            const windowWithCalls = window as Window & { __geoCalls?: number };
            windowWithCalls.__geoCalls =
              (windowWithCalls.__geoCalls ?? 0) + 1;
            if (mode === "denied") {
              failure({ code: 1 });
              return;
            }
            success({
              coords:
                mode === "outside"
                  ? { latitude: 38, longitude: -122.41, accuracy: 20 }
                  : { latitude: 37.78, longitude: -122.41, accuracy: 1_001 },
            });
          },
        },
      });
    }, "denied");
    await page.reload();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.locator("#citywide-location-message")).toHaveText(
      "Location access is unavailable. Choose a place instead.",
    );
    await expect(page.getByRole("button", { name: "Use my location" })).toBeDisabled();
    const geoCalls = await page.evaluate(() => {
      const windowWithCalls = window as Window & { __geoCalls?: number };
      return windowWithCalls.__geoCalls;
    });
    expect(geoCalls).toBe(1);
  });

  test("shows the exact inaccurate GPS copy", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(success: (position: unknown) => void) {
            success({
              coords: { latitude: 37.78, longitude: -122.41, accuracy: 1_001 },
            });
          },
        },
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.locator("#citywide-location-message")).toHaveText(
      "Your location is not accurate enough. Choose a place instead.",
    );
  });

  test("shows the exact outside GPS copy", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "geolocation", {
        configurable: true,
        value: {
          getCurrentPosition(success: (position: unknown) => void) {
            success({
              coords: { latitude: 38, longitude: -122.41, accuracy: 20 },
            });
          },
        },
      });
    });
    await page.reload();
    await page.getByRole("button", { name: "Use my location" }).click();
    await expect(page.locator("#citywide-location-message")).toHaveText(
      "Your location is outside the Muni service area. Choose a place instead.",
    );
  });
});
