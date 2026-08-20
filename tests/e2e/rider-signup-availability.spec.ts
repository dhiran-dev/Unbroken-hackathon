import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const FULL_COPY =
  "UNBROKEN is full for now. If you already joined, you can still continue with Google.";
const EXISTING_RIDER_COPY =
  "Continue with Google if you already have an account. New rider signup is currently unavailable.";
const GOOGLE_UNAVAILABLE_COPY = "Google sign-in is currently unavailable.";

const fakeGoogleProvider =
  process.env.E2E_FAKE_GOOGLE_PROVIDER === "1" &&
  process.env.GOOGLE_CLIENT_ID === "fake-google-client-id" &&
  process.env.GOOGLE_CLIENT_SECRET === "fake-google-client-secret";

async function installAvailabilityFixture(page: Page, body: unknown) {
  await page.route("**/api/public/signup-availability**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: body,
      headers: { "Cache-Control": "no-store" },
    });
  });
}

async function readAvailabilityFixture(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/public/signup-availability");
    return response.json();
  });
}

async function openRiderSignIn(page: Page, query = "") {
  await page.goto(`/rider/sign-in${query}`);
  await expect(
    page.getByRole("heading", { name: "Rider sign in" }),
  ).toBeVisible();
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

test.describe("public rider admission availability", () => {
  test.beforeEach(async () => {
    test.skip(
      !fakeGoogleProvider,
      "Run with the documented fake Google provider credentials.",
    );
  });

  test("shows the exact full copy while retaining the configured Google action", async ({
    page,
  }) => {
    await installAvailabilityFixture(page, {
      available: false,
      message: FULL_COPY,
    });
    await openRiderSignIn(
      page,
      "?error=rider_admission_full&error_description=internal-circuit-secret",
    );

    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await expect(googleButton).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText(FULL_COPY);
    await expect(page.locator("body")).not.toContainText(
      "internal-circuit-secret",
    );
    await expectNoSeriousAccessibilityViolations(page);

    const body = await readAvailabilityFixture(page);
    expect(body).toEqual({ available: false, message: FULL_COPY });
    expect(JSON.stringify(body)).not.toMatch(
      /GTFS|OTP|GraphQL|protobuf|fingerprint|schema|collector|worker|queue|job|raw|wheelchair-safe/iu,
    );
  });
});

test.describe("safe paused and unavailable states", () => {
  test.beforeEach(async () => {
    test.skip(
      !fakeGoogleProvider,
      "Run with the documented fake Google provider credentials.",
    );
  });

  test("projects paused admission to one safe existing-rider message", async ({
    page,
  }) => {
    await installAvailabilityFixture(page, {
      available: false,
      message: EXISTING_RIDER_COPY,
    });
    await openRiderSignIn(page);
    const body = await readAvailabilityFixture(page);
    expect(body).toEqual({ available: false, message: EXISTING_RIDER_COPY });
    expect(JSON.stringify(body)).not.toMatch(
      /\b(count|capacity|circuit|reason|email|active|reserved)\b/iu,
    );
  });
});
test.describe("unavailable admission state", () => {
  test.beforeEach(async () => {
    test.skip(
      !fakeGoogleProvider,
      "Run with the documented fake Google provider credentials.",
    );
  });

  test("does not expose why admission is unavailable", async ({ page }) => {
    await installAvailabilityFixture(page, {
      available: false,
      message: EXISTING_RIDER_COPY,
    });
    await openRiderSignIn(page);
    const body = await readAvailabilityFixture(page);
    expect(body).toEqual({ available: false, message: EXISTING_RIDER_COPY });
    expect(JSON.stringify(body)).not.toMatch(
      /\b(count|capacity|circuit|reason|email|active|reserved)\b/iu,
    );
  });
});

test.describe("rider callback safety", () => {
  test.beforeEach(async () => {
    test.skip(
      !fakeGoogleProvider,
      "Run with the documented fake Google provider credentials.",
    );
  });

  test("ignores arbitrary callback descriptions", async ({ page }) => {
    await openRiderSignIn(
      page,
      "?error=unexpected_failure&error_description=database-password-or-circuit-detail",
    );
    await expect(page.getByRole("status")).toHaveText(GOOGLE_UNAVAILABLE_COPY);
    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await expect(googleButton).toBeEnabled();
    const visibleText = await page.locator("body").innerText();
    expect(visibleText).not.toContain("database-password-or-circuit-detail");
  });
});
