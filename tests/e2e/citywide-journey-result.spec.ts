import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const WALKING_CAVEAT =
  "This path avoids mapped stairs. Some sidewalk details may be missing.";
const CURRENT_WARNING = "A current service update may affect this journey.";
const CURRENT_CHANGE = "Boarding uses a temporary stop.";
const OFFICIAL_ELEVATOR_URL =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod";
const OFFICIAL_CHANGES_URL =
  "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility";
const OFFICIAL_SCHEDULE_URL = "https://511.org/open-data/transit";

const origin = {
  id: "station:twenty-fourth-street-mission",
  type: "station",
  name: "24th Street Mission Station — Long Hallway Entrance",
  description: "Muni Metro station",
  latitude: 37.7524,
  longitude: -122.4184,
  stopIds: ["station-24th-mission"],
  routeNames: ["J Church"],
};

const destination = {
  id: "landmark:fishermans-wharf-pier-39",
  type: "landmark",
  name: "Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance",
  description: "Approved San Francisco place",
  latitude: 37.808,
  longitude: -122.4177,
  stopIds: [],
  routeNames: [],
};

const placeGroups = [
  { id: "nearby_stops", label: "Nearby stops", places: [] },
  { id: "stations", label: "Stations", places: [origin] },
  { id: "places", label: "Places", places: [destination] },
];

function placesForQuery(query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return {
    groups: placeGroups.map((group) => ({
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

const mapStops = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      id: "STOP-RESULT-001",
      properties: {
        id: "STOP-RESULT-001",
        name: "24th Street Mission boarding stop",
        code: "24001",
        locationType: 0,
        parentStationId: null,
      },
      geometry: {
        type: "Point",
        coordinates: [-122.4184, 37.7524],
      },
    },
  ],
};

const basePlan = {
  status: "confirmed",
  title: "Step-free details confirmed",
  summary:
    "A confirmed step-free route connects 24th Street Mission Station — Long Hallway Entrance to Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance in 32 minutes.",
  departureAt: "2026-08-20T19:00:00.000Z",
  arrivalAt: "2026-08-20T19:32:00.000Z",
  durationMinutes: 32,
  legs: [
    {
      type: "walk",
      from: "24th Street Mission Station — Long Hallway Entrance",
      to: "24th Street Mission Station — Accessible Elevator Entrance",
      startAt: "2026-08-20T19:00:00.000Z",
      endAt: "2026-08-20T19:03:00.000Z",
      durationMinutes: 3,
      instruction: "Follow signs to the accessible elevator entrance.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.4184, 37.7524],
          [-122.4182, 37.7525],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
    {
      type: "wait",
      from: "24th Street Mission Station — Accessible Elevator Entrance",
      to: "24th Street Mission Station — Accessible Elevator Entrance",
      startAt: "2026-08-20T19:03:00.000Z",
      endAt: "2026-08-20T19:05:00.000Z",
      durationMinutes: 2,
      instruction: "Wait for the J Church at the accessible platform.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.4182, 37.7525],
          [-122.4181, 37.7525],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
    {
      type: "ride",
      from: "24th Street Mission Station — Accessible Elevator Entrance",
      to: "Embarcadero Station — Ferry Building Connection",
      startAt: "2026-08-20T19:05:00.000Z",
      endAt: "2026-08-20T19:20:00.000Z",
      durationMinutes: 15,
      route: {
        id: "J",
        name: "J Church",
        color: "#1f6feb",
        destination: "Balboa Park",
      },
      instruction: "Ride the J Church toward Balboa Park.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.4181, 37.7525],
          [-122.4, 37.775],
          [-122.395, 37.795],
        ],
      },
      accessibility: { state: "unknown", reasons: ["Some platform details need checking."] },
    },
    {
      type: "transfer",
      from: "Embarcadero Station — Ferry Building Connection",
      to: "Embarcadero Station — Ferry Building Connection, Platform 2",
      startAt: "2026-08-20T19:20:00.000Z",
      endAt: "2026-08-20T19:25:00.000Z",
      durationMinutes: 5,
      instruction: "Transfer at the signed accessible connection.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.395, 37.795],
          [-122.3948, 37.7952],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
    {
      type: "walk",
      from: "Embarcadero Station — Ferry Building Connection, Platform 2",
      to: "Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance",
      startAt: "2026-08-20T19:25:00.000Z",
      endAt: "2026-08-20T19:32:00.000Z",
      durationMinutes: 7,
      instruction: "Use the level waterfront path to the accessible entrance.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.3948, 37.7952],
          [-122.4177, 37.808],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
  ],
  warnings: [CURRENT_WARNING, CURRENT_WARNING],
  changes: [CURRENT_CHANGE, CURRENT_CHANGE],
  sources: [
    {
      source: "schedule",
      checkedAt: "2026-08-20T19:05:00.000Z",
      sourceUpdatedAt: "2026-08-20T19:00:00.000Z",
      freshness: "current",
      sourceUrl: OFFICIAL_SCHEDULE_URL,
    },
    {
      source: "service_changes",
      checkedAt: "2026-08-19T19:05:00.000Z",
      sourceUpdatedAt: "2026-08-19T18:45:00.000Z",
      freshness: "older",
      sourceUrl: OFFICIAL_CHANGES_URL,
    },
    {
      source: "elevators",
      checkedAt: null,
      sourceUpdatedAt: null,
      freshness: "unavailable",
      sourceUrl: OFFICIAL_ELEVATOR_URL,
    },
  ],
  map: {
    bounds: {
      west: -122.43,
      south: 37.74,
      east: -122.38,
      north: 37.82,
    },
    origin: { type: "Point", coordinates: [-122.4184, 37.7524] },
    destination: { type: "Point", coordinates: [-122.4177, 37.808] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
};

const statusPlans = {
  confirmed: basePlan,
  check_details: {
    ...basePlan,
    status: "check_details",
    title: "Some details need checking",
    summary:
      "A route connects 24th Street Mission Station — Long Hallway Entrance to Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance, but some details need checking.",
  },
  unavailable: {
    ...basePlan,
    status: "unavailable",
    title: "No step-free route confirmed",
    summary: "A step-free route could not be confirmed for this journey.",
    arrivalAt: "2026-08-20T19:00:00.000Z",
    durationMinutes: 0,
    legs: [],
    warnings: [],
    changes: [],
  },
  updates_unavailable: {
    ...basePlan,
    status: "updates_unavailable",
    title: "Current updates are unavailable",
    summary:
      "A route is available from 24th Street Mission Station — Long Hallway Entrance to Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance, but current updates are unavailable.",
  },
} as const;

const resultHeadingNames = {
  confirmed: "Step-free details confirmed",
  check_details: "Some details need checking",
  unavailable: "No step-free route confirmed",
  updates_unavailable: "Current updates are unavailable",
} as const;

type JourneyStatus = keyof typeof statusPlans;

async function selectPlace(
  page: Page,
  field: "From" | "To",
  query: string,
  visibleName: string,
) {
  const input = page.getByRole("combobox", { name: field, exact: true });
  await input.fill(query);
  const option = page.getByRole("option", { name: new RegExp(visibleName) });
  await expect(option).toBeVisible({ timeout: 10_000 });
  await input.press("ArrowDown");
  await input.press("Enter");
  await expect(input).toHaveValue(visibleName);
}

async function submitJourney(page: Page, keyboardOnly = false) {
  await selectPlace(
    page,
    "From",
    "24th",
    "24th Street Mission Station — Long Hallway Entrance",
  );
  await selectPlace(
    page,
    "To",
    "wharf",
    "Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance",
  );
  const submit = page.getByRole("button", {
    name: "Find a step-free route",
    exact: true,
  });
  await expect(submit).toBeEnabled();
  if (keyboardOnly) {
    await submit.focus();
    await submit.press("Enter");
  } else {
    await submit.click();
  }
  const result = page.getByRole("region", { name: "Journey result" });
  await expect(result).toBeVisible({ timeout: 10_000 });
  return result;
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(
    violations,
    violations
      .map(
        ({ id, impact, help, nodes }) =>
          `${impact} ${id}: ${help} (${nodes.length} node(s))`,
      )
      .join("\n"),
  ).toEqual([]);
}

test.describe("citywide journey result", () => {
  let activePlan: unknown = statusPlans.confirmed;
  let mapUnavailable = false;

  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.CITYWIDE_PLANNER_ENABLED !== "true",
      "CITYWIDE_PLANNER_ENABLED=true is required for the citywide surface.",
    );
    activePlan = statusPlans.confirmed;
    mapUnavailable = false;

    await page.route("**/api/public/places?*", async (route) => {
      const query = new URL(route.request().url()).searchParams.get("q") ?? "";
      await route.fulfill({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: placesForQuery(query),
      });
    });
    await page.route("**/api/public/journeys", async (route) => {
      await route.fulfill({
        status: 200,
        headers: { "Cache-Control": "no-store" },
        json: activePlan,
      });
    });
    await page.route("**/api/public/map/stops.geojson**", async (route) => {
      if (mapUnavailable) {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          json: {
            available: false,
            code: "STOP_MAP_UNAVAILABLE",
            message: "Map is unavailable. Use the trip steps instead.",
          },
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/geo+json",
        body: JSON.stringify(mapStops),
      });
    });
    await page.route("**/api/public/live?*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/geo+json",
        body: JSON.stringify({ type: "FeatureCollection", features: [] }),
      });
    });
    await page.goto("/");
  });

  for (const status of Object.keys(statusPlans) as JourneyStatus[]) {
    test(`renders the exact public ${status} state`, async ({ page }) => {
      activePlan = statusPlans[status];
      const result = await submitJourney(page);
      await expect(
        result.getByRole("heading", {
          name: resultHeadingNames[status],
          exact: true,
        }),
      ).toBeVisible();
      await expect(result).toContainText(statusPlans[status].summary);
    });
  }

  test("renders estimated arrival, summary, and journey duration", async ({
    page,
  }) => {
    const result = await submitJourney(page);
    await expect(result).toContainText(basePlan.summary);
    await expect(result.getByText(/Estimated arrival/i)).toBeVisible();
    await expect(result).toContainText("12:32");
    await expect(result).toContainText("32 minutes");
  });

  test("shows distinct checked and source update provenance for every freshness state", async ({
    page,
  }) => {
    const result = await submitJourney(page);
    await expect(
      result.getByText("Checked by UNBROKEN at", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      result.getByText("SFMTA updated at", { exact: false }).first(),
    ).toBeVisible();
    await expect(result.getByText("Current", { exact: true })).toBeVisible();
    await expect(result.getByText("Older information", { exact: true })).toBeVisible();
    await expect(result.getByText("Unavailable", { exact: true })).toBeVisible();
    await expect(result).toContainText("Aug 20, 2026, 12:05 PM PDT");
    await expect(result).toContainText("Aug 20, 2026, 12:00 PM PDT");
    await expect(result).toContainText("Aug 19, 2026, 12:05 PM PDT");
    await expect(result).not.toContainText(/last updated/i);

    const officialLinks = result.getByRole("link", {
      name: /^Official source\b/u,
    });
    await expect(officialLinks).toHaveCount(3);
    const expectedHrefs = new Set([
      OFFICIAL_SCHEDULE_URL,
      OFFICIAL_CHANGES_URL,
      OFFICIAL_ELEVATOR_URL,
    ]);
    for (const link of await officialLinks.all()) {
      await expect(link).toHaveAttribute("target", "_blank");
      const rel = await link.getAttribute("rel");
      expect(rel).toMatch(/\bnoopener\b/u);
      expect(rel).toMatch(/\bnoreferrer\b/u);
      const href = await link.getAttribute("href");
      expect(href).not.toBeNull();
      expect(expectedHrefs.has(href ?? "")).toBe(true);
    }
  });

  test("renders ordered steps with route details, times, and the exact walking caveat", async ({
    page,
  }) => {
    const result = await submitJourney(page);
    const steps = result
      .getByRole("list", { name: "Journey steps", exact: true })
      .getByRole("listitem");
    await expect(steps).toHaveCount(5);

    const expectedStepText = [
      [
        "24th Street Mission Station — Long Hallway Entrance",
        "24th Street Mission Station — Accessible Elevator Entrance",
        "Follow signs to the accessible elevator entrance.",
      ],
      [
        "24th Street Mission Station — Accessible Elevator Entrance",
        "Wait for the J Church at the accessible platform.",
      ],
      [
        "Embarcadero Station — Ferry Building Connection",
        "J Church",
        "Ride the J Church toward Balboa Park.",
      ],
      [
        "Embarcadero Station — Ferry Building Connection, Platform 2",
        "Transfer at the signed accessible connection.",
      ],
      [
        "Fisherman’s Wharf Pier 39 — Accessible Waterfront Entrance",
        "Use the level waterfront path to the accessible entrance.",
      ],
    ];
    for (const [index, phrases] of expectedStepText.entries()) {
      const step = steps.nth(index);
      for (const phrase of phrases) await expect(step).toContainText(phrase);
      await expect(step).toContainText(/\b\d{1,2}:\d{2}\b/u);
    }

    const walkingSteps = steps.filter({ hasText: "Walk" });
    await expect(walkingSteps).toHaveCount(2);
    for (const step of await walkingSteps.all()) {
      await expect(step).toContainText(WALKING_CAVEAT);
    }
  });

  test("renders duplicate warnings and changes without React key errors", async ({
    page,
  }) => {
    const reactKeyErrors: string[] = [];
    page.on("console", (message) => {
      if (
        message.type() === "error" &&
        /unique ["']key["']|each child in a list|same key/iu.test(message.text())
      ) {
        reactKeyErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      if (/unique ["']key["']|each child in a list|same key/iu.test(error.message)) {
        reactKeyErrors.push(error.message);
      }
    });

    const result = await submitJourney(page);
    await expect(
      result.getByText(CURRENT_WARNING, { exact: false }),
    ).toHaveCount(2);
    await expect(
      result.getByText(CURRENT_CHANGE, { exact: false }),
    ).toHaveCount(2);
    expect(reactKeyErrors).toEqual([]);
  });

  test("moves focus to the result and announces it after keyboard-only selection and submit", async ({
    page,
  }) => {
    const result = await submitJourney(page, true);
    const heading = result.getByRole("heading", {
      name: "Step-free details confirmed",
      exact: true,
    });
    await expect(heading).toBeVisible();
    const focusedResultOrHeading = await page.evaluate((title) => {
      const active = document.activeElement;
      if (!active) return false;
      return (
        active.getAttribute("aria-label") === "Journey result" ||
        (/^H[1-6]$/u.test(active.tagName) &&
          active.textContent?.includes(title) === true)
      );
    }, "Step-free details confirmed");
    expect(focusedResultOrHeading).toBe(true);

    const liveRegion = result.locator('[role="status"][aria-live="polite"]').first();
    await expect(liveRegion).toBeVisible();
    const headingPrecedesLiveRegion = await result.evaluate((root) => {
      const resultHeading = root.querySelector("h1, h2, h3");
      const live = root.querySelector('[role="status"][aria-live="polite"]');
      return Boolean(
        resultHeading &&
          live &&
          (resultHeading.compareDocumentPosition(live) &
            Node.DOCUMENT_POSITION_FOLLOWING),
      );
    });
    expect(headingPrecedesLiveRegion).toBe(true);
  });

  test("keeps the mobile result within 360 pixels in dark mode with reduced motion", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/u);
    expect(
      await page.evaluate(() =>
        window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);

    const result = await submitJourney(page);
    await expect(result).toBeVisible();
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(widths.content).toBeLessThanOrEqual(widths.viewport);
  });

  test("keeps journey steps and provenance when the map request fails", async ({
    page,
  }) => {
    mapUnavailable = true;
    await page.reload();
    await expect(
      page.getByText("Map is unavailable. Use the trip steps instead.", {
        exact: true,
      }),
    ).toBeVisible();

    const result = await submitJourney(page);
    await expect(
      result.getByRole("list", { name: "Journey steps", exact: true }),
    ).toBeVisible();
    await expect(result).toContainText(
      "24th Street Mission Station — Long Hallway Entrance",
    );
    await expect(
      result.getByText("Checked by UNBROKEN at", { exact: false }).first(),
    ).toBeVisible();
    await expect(
      result.getByRole("link", { name: /^Official source\b/u }).first(),
    ).toBeVisible();
  });

  test("keeps visible journey copy free of internal jargon, secrets, and unsafe rider claims", async ({
    page,
  }) => {
    const result = await submitJourney(page);
    const visibleResult = (await result.innerText()).trim();
    expect(visibleResult).not.toMatch(
      /\b(?:GTFS|OTP|GraphQL|protobuf|fingerprint|schema|collector|worker|queue|job|wheelchair-safe)\b|raw\s+ids?/iu,
    );
    expect(visibleResult).not.toContain(origin.id);
    expect(visibleResult).not.toContain(destination.id);
    expect(visibleResult).not.toMatch(
      /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/iu,
    );
  });

  test("has no serious or critical accessibility violations on the result", async ({
    page,
  }) => {
    await submitJourney(page);
    await expectNoSeriousAccessibilityViolations(page);
  });
});

test.describe("citywide journey result rollback", () => {
  test("keeps the compatibility planner and exposes no citywide result when the flag is off", async ({
    page,
  }) => {
    test.skip(
      process.env.CITYWIDE_PLANNER_ENABLED === "true",
      "The rollback assertion covers the compatibility surface when the citywide flag is off.",
    );
    await page.goto("/");
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "A step-free trip should stay step-free.",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: /Step-free details confirmed|Some details need checking|No step-free route confirmed|Current updates are unavailable/u,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "Journey result" }),
    ).toHaveCount(0);
  });
});
