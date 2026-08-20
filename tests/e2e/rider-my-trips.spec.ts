import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const savedFirst = {
  id: "00000000-0000-4000-8000-000000000001",
  slot: "first",
  originPlaceId: "stop:market-street",
  destinationPlaceId: "landmark:ferry-building",
  days: ["monday", "friday"],
  departureTime: "08:30",
  timezone: "America/Los_Angeles",
  reminderMinutes: 30,
  paused: false,
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

const origin = {
  id: "stop:market-street",
  type: "stop",
  name: "Market Street stop",
  description: "Muni stop",
  latitude: 37.78,
  longitude: -122.41,
  stopIds: ["market-street"],
  routeNames: ["5 Fulton"],
};

const destination = {
  id: "landmark:ferry-building",
  type: "landmark",
  name: "Ferry Building",
  description: "Destination point",
  latitude: 37.7955,
  longitude: -122.3937,
  stopIds: [],
  routeNames: [],
};

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(violations).toEqual([]);
}

async function installTripFixtures(page: Page) {
  await page.route("**/api/me/commutes", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { commutes: [savedFirst] },
    });
  });
  await page.route("**/api/me/commutes/*", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        json: { deleted: true, slot: "first" },
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { commute: savedFirst },
    });
  });
  await page.route("**/api/public/places?*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: {
        groups: [
          { id: "nearby_stops", label: "Nearby stops", places: [origin] },
          { id: "stations", label: "Stations", places: [] },
          { id: "places", label: "Places", places: [destination] },
        ],
      },
    });
  });
}

test("anonymous riders cannot open My trips", async ({ page }) => {
  await page.goto("/rider/trips");
  await expect(page).toHaveURL(/\/rider\/sign-in$/);
  await expect(
    page.getByRole("heading", { name: "Rider sign in" }),
  ).toBeVisible();
  await expect(page.getByText("My trips", { exact: true })).toHaveCount(0);
});

test("operator sessions cannot open the rider account page", async ({
  page,
}) => {
  const email = process.env.E2E_AUTH_EMAIL;
  const password = process.env.E2E_AUTH_PASSWORD;
  test.skip(
    !email || !password,
    "Temporary operator credentials were not provided.",
  );

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);

  await page.goto("/rider/trips");
  await expect(page).toHaveURL(/\/rider\/sign-in$/);
  await expect(page.getByText("My trips", { exact: true })).toHaveCount(0);
});

test.describe("authenticated My trips UI", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      process.env.E2E_RIDER_TRIPS_UI !== "1",
      "Run with an authenticated rider browser context for My trips UI acceptance.",
    );
    await installTripFixtures(page);
    await page.goto("/rider/trips");
    await expect(
      page.getByRole("heading", { name: "My trips", exact: true }),
    ).toBeVisible();
  });

  test("renders exactly two slot cards and supports safe edit/delete controls", async ({
    page,
  }) => {
    await expect(
      page.getByRole("heading", { name: "First trip" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Return trip" }),
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("stop:market-street");
    await expect(page.locator("body")).not.toContainText(
      "landmark:ferry-building",
    );

    await page.getByRole("button", { name: "Delete First trip" }).click();
    await expect(page.getByRole("alertdialog")).toBeVisible();
    await expect(page.getByRole("alertdialog")).toContainText(
      "This removes future reminders for this trip.",
    );
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Delete First trip" }),
    ).toBeFocused();

    await expectNoSeriousAccessibilityViolations(page);
  });

  test("stays usable at 360px in dark reduced-motion mode", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile project only.");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await expect(
      page.getByRole("heading", { name: "My trips", exact: true }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });
});
