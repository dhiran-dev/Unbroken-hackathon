import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const GOOGLE_ENABLED_COPY =
  "Continue with Google to sign in or create a rider account.";
const GOOGLE_EXISTING_RIDER_COPY =
  "Continue with Google if you already have an account. New rider signup is currently unavailable.";
const GOOGLE_UNAVAILABLE_COPY = "Google sign-in is currently unavailable.";

const fakeGoogleProvider =
  process.env.E2E_FAKE_GOOGLE_PROVIDER === "1" &&
  process.env.GOOGLE_CLIENT_ID === "fake-google-client-id" &&
  process.env.GOOGLE_CLIENT_SECRET === "fake-google-client-secret";

async function openRiderSignIn(page: Page) {
  await page.goto("/rider/sign-in");
  await expect(
    page.getByRole("heading", { name: "Rider sign in" }),
  ).toBeVisible();
}

async function installGoogleStartFixture(page: Page) {
  await page.route("**/api/auth/sign-in/social**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      json: { redirect: false, url: "/" },
    });
  });
}

async function expectGoogleStartRequest(
  page: Page,
  interaction: "click" | "keyboard",
) {
  const externalGoogleRequests: string[] = [];
  const onRequest = (request: { url(): string }) => {
    if (request.url().includes("accounts.google.com")) {
      externalGoogleRequests.push(request.url());
    }
  };
  page.on("request", onRequest);

  try {
    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    const requestPromise = page.waitForRequest("**/api/auth/sign-in/social**");

    if (interaction === "keyboard") {
      await googleButton.focus();
      await expect(googleButton).toBeFocused();
      await googleButton.press("Enter");
    } else {
      await googleButton.click();
    }

    const request = await requestPromise;
    const body = request.postDataJSON() as Record<string, unknown>;
    expect(body).toEqual({ provider: "google", callbackURL: "/" });
    expect(request.postData() ?? "").not.toMatch(
      /scopes?|secret|token|state/iu,
    );
    expect(externalGoogleRequests).toEqual([]);
  } finally {
    page.off("request", onRequest);
  }
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

test.describe("public rider Google sign-in", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !fakeGoogleProvider,
      "Run with the documented fake Google provider credentials.",
    );
    await openRiderSignIn(page);
  });

  test("shows the exact enabled copy and an accessible enabled action", async ({
    page,
  }) => {
    test.skip(
      process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED !== "true",
      "This assertion requires PUBLIC_GOOGLE_SIGNUP_ENABLED=true.",
    );

    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText(GOOGLE_ENABLED_COPY);
  });

  test("click starts only the Google provider request", async ({ page }) => {
    test.skip(
      process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED !== "true",
      "This assertion requires PUBLIC_GOOGLE_SIGNUP_ENABLED=true.",
    );

    await installGoogleStartFixture(page);
    await expectGoogleStartRequest(page, "click");
  });

  test("keeps the Google action enabled for existing riders when signup is off", async ({
    page,
  }) => {
    test.skip(
      process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED === "true",
      "This assertion requires PUBLIC_GOOGLE_SIGNUP_ENABLED=false.",
    );

    const googleButton = page.getByRole("button", {
      name: "Continue with Google",
      exact: true,
    });
    await expect(googleButton).toBeVisible();
    await expect(googleButton).toBeEnabled();
    await expect(page.getByRole("status")).toHaveText(
      GOOGLE_EXISTING_RIDER_COPY,
    );
  });

  test("keyboard activation starts only the Google provider request when signup is off", async ({
    page,
  }) => {
    test.skip(
      process.env.PUBLIC_GOOGLE_SIGNUP_ENABLED === "true",
      "This assertion requires PUBLIC_GOOGLE_SIGNUP_ENABLED=false.",
    );

    await installGoogleStartFixture(page);
    await expectGoogleStartRequest(page, "keyboard");
  });
});

test.describe("rider sign-in responsive accessibility", () => {
  test("has no serious or critical violations at 360px in dark reduced-motion mode", async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "mobile" || !fakeGoogleProvider,
      "Run this check in the mobile project with the documented fake provider credentials.",
    );
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await openRiderSignIn(page);

    await expect(
      page.getByRole("button", {
        name: "Continue with Google",
        exact: true,
      }),
    ).toBeVisible();
    await expectNoSeriousAccessibilityViolations(page);
    await expect
      .poll(() =>
        page.evaluate(() => ({
          dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)")
            .matches,
          noHorizontalOverflow:
            document.documentElement.scrollWidth <= window.innerWidth,
        })),
      )
      .toEqual({ dark: true, reducedMotion: true, noHorizontalOverflow: true });
  });
});

test("operator login retains labeled email/password fields and exact Sign in action", async ({
  page,
}) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Operator sign in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /Google/iu })).toHaveCount(0);
  await expect(
    page.getByText("Continue with Google", { exact: true }),
  ).toHaveCount(0);
});

test("disables Google action when the provider is intentionally absent", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_GOOGLE_PROVIDER_MISSING !== "1" ||
      Boolean(process.env.GOOGLE_CLIENT_ID) ||
      Boolean(process.env.GOOGLE_CLIENT_SECRET),
    "Set E2E_GOOGLE_PROVIDER_MISSING=1 with no Google credentials to exercise this branch.",
  );
  await openRiderSignIn(page);

  const googleButton = page.getByRole("button", {
    name: "Continue with Google",
    exact: true,
  });
  await expect(googleButton).toBeVisible();
  await expect(googleButton).toBeDisabled();
  await expect(page.getByRole("status")).toHaveText(GOOGLE_UNAVAILABLE_COPY);
});
