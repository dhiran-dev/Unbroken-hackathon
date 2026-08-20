import { expect, test } from "@playwright/test";

const publicStatusFixture = {
  available: true,
  elevators: {
    state: "current",
    checkedAt: "2026-08-20T11:59:00.000Z",
    sourceUpdatedAt: "2026-08-20T11:58:00.000Z",
    sourceUrl:
      "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
    summary: "1 station.",
    count: 1,
    stations: [
      {
        slug: "powell",
        name: "Powell",
        corridorOrder: 1,
        state: "accessible",
        elevators: [
          {
            name: "Powell elevator",
            state: "working",
            lastChangedAt: null,
            role: "Street access",
            alternativeName: null,
          },
        ],
      },
    ],
    counts: { accessible: 1, limited: 0, unavailable: 0, unknown: 0 },
  },
  advisories: {
    state: "current",
    checkedAt: "2026-08-20T11:59:00.000Z",
    sourceUpdatedAt: null,
    sourceUrl:
      "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
    summary: "1 accessibility advisory.",
    count: 1,
    items: [
      {
        title: "Accessibility entrance update",
        affectedRoutes: ["J"],
        affectedStops: ["Church Street"],
        publicUrl:
          "https://www.sfmta.com/travel-updates/accessibility-change-1",
      },
    ],
  },
  relocations: {
    state: "current",
    checkedAt: "2026-08-20T11:59:00.000Z",
    sourceUpdatedAt: "2026-08-20T11:58:00.000Z",
    sourceUrl:
      "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
    summary: "1 moved stop.",
    count: 1,
    items: [
      {
        stopName: "Market Street & 5th",
        routeNames: ["5"],
        temporaryStop: "Market Street & 6th",
        scheduleText: "Aug 20–Aug 30",
        startsAt: "2026-08-20T00:00:00.000Z",
        endsAt: "2026-08-30T23:59:59.000Z",
        latitude: 37.783,
        longitude: -122.408,
        publicUrl:
          "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
        boardingInstruction: "Board at the temporary stop.",
      },
    ],
  },
  guides: {
    state: "current",
    checkedAt: "2026-08-20T11:59:00.000Z",
    sourceUpdatedAt: null,
    sourceUrl:
      "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
    summary: "1 accessibility guide.",
    count: 1,
    items: [
      {
        stationName: "Powell",
        routeNames: ["J"],
        guidance: "Use the elevator entrance.",
        accessibilityState: "unknown",
        reviewed: true,
      },
    ],
  },
  alerts: {
    state: "current",
    checkedAt: "2026-08-20T11:59:00.000Z",
    sourceUpdatedAt: "2026-08-20T11:58:00.000Z",
    sourceUrl: "https://511.org/open-data/transit",
    summary: "1 service alert.",
    count: 1,
    items: [
      {
        header: "J Church service change",
        effect: "DETOUR",
        routeIds: ["J"],
        stopIds: ["12345"],
      },
    ],
  },
};

test.describe("citywide status", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CITYWIDE_PLANNER_ENABLED !== "true",
      "CITYWIDE_PLANNER_ENABLED=true is required for the citywide surface.",
    );
    await page.route("**/api/public/status*", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: publicStatusFixture,
      });
    });
  });
  test("supports search and semantic source/state filters", async ({
    page,
  }) => {
    await page.goto("/status");
    await expect(
      page.getByRole("heading", { level: 1, name: "Citywide service status" }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Search status updates", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Filter by source", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", {
        name: "Filter by information age",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Checked by UNBROKEN", { exact: false }).first(),
    ).toBeVisible();

    const search = page.getByLabel("Search status updates", { exact: true });
    await search.focus();
    await search.fill("Powell");
    await page
      .getByRole("combobox", { name: "Filter by source", exact: true })
      .selectOption("elevators");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .press("Enter");
    await expect(page).toHaveURL(/q=Powell/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Elevators and stations" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: "Accessibility advisories" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "Moved stops" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "Accessible-stop guidance" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", { level: 2, name: "Current service alerts" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: /^Official source/u }).first(),
    ).toHaveAttribute("rel", /noopener/);
  });

  test("keeps the status surface usable at 360 pixels and preserves keyboard controls", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/status");
    const search = page.getByLabel("Search status updates", { exact: true });
    await search.focus();
    await expect(search).toBeFocused();
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .focus();
    await expect(
      page.getByRole("button", { name: "Apply filters", exact: true }),
    ).toBeFocused();
    const width = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(width.content).toBeLessThanOrEqual(width.viewport);
  });

  test("returns a no-store allowlisted status response", async ({
    request,
  }) => {
    const response = await request.get("/api/public/status");
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.text();
    expect(body).not.toMatch(
      /collectorId|fingerprint|applicant|entityId|tripId|agencyId|description|token/i,
    );
    if (response.status() === 503) {
      expect(JSON.parse(body)).toEqual({
        available: false,
        code: "PUBLIC_STATUS_UNAVAILABLE",
        message: "Current status information is unavailable right now.",
      });
    } else {
      expect(response.ok()).toBe(true);
      expect(JSON.parse(body)).toMatchObject({ available: true });
    }
  });
});
