import { expect, test } from "@playwright/test";

test("public rider surfaces render truthfully", async ({ page, request }) => {
  const accessibilityResponse = await request.get("/api/public/accessibility");
  const accessibilityBody = (await accessibilityResponse.json()) as {
    available: boolean;
    trust?: { state: "current" | "older" };
  };
  const hasCurrentSnapshot =
    accessibilityResponse.ok() &&
    accessibilityBody.available &&
    accessibilityBody.trust?.state === "current";

  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "A step-free trip should stay step-free.",
    }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  const origin = page.getByLabel("Starting station", { exact: true });
  const destination = page.getByLabel("Destination station", { exact: true });
  await expect(origin).toBeVisible();
  await expect(destination).toBeVisible();
  await origin.selectOption("powell");
  await destination.selectOption("forest-hill");

  const planButton = page.getByRole("button", { name: "Show my step-free plan" });
  if (hasCurrentSnapshot && (await planButton.isEnabled())) {
    await planButton.click();
    await expect(page.locator("#route h2")).toHaveText(
      /A step-free station path is available|No confirmed step-free trip right now|We can’t confirm this trip/,
    );
  } else {
    await expect(planButton).toBeDisabled();
    await expect(
      page.getByText(/Current elevator information is unavailable|Route planning is paused/),
    ).toBeVisible();
  }

  if (!accessibilityResponse.ok()) {
    await expect(page.getByText("Current elevator information is unavailable.", { exact: true })).toBeVisible();
  } else if (accessibilityBody.trust?.state === "older") {
    await expect(page.getByText("Route planning is paused until a fresh update arrives.", { exact: true })).toBeVisible();
  }
  await page
    .getByRole("link", { name: "Elevator status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Elevator status" }),
  ).toBeVisible();

  if (!accessibilityResponse.ok()) {
    await expect(
      page.getByRole("heading", { name: "Status unavailable" }),
    ).toBeVisible();
  } else {
    await expect(page.locator("details")).toHaveCount(11);
    await expect(page.getByRole("heading", { name: "Embarcadero" })).toBeVisible();
    await expect(
      page
        .locator("details")
        .filter({ hasText: "Embarcadero" })
        .locator("summary svg"),
    ).toHaveCount(1);
    if (accessibilityBody.trust?.state === "older") {
      await expect(
        page.getByText("The latest update could not be confirmed."),
      ).toBeVisible();
    }
    await page
      .getByLabel("Find a station or elevator", { exact: true })
      .fill("Embarcadero");
    await page.getByRole("button", { name: "Show", exact: true }).click();
    await expect(page).toHaveURL(/q=Embarcadero/);
    await expect(page.locator("details")).toHaveCount(1);
    await expect(
      page.getByRole("link", { name: "Plan a step-free trip" }),
    ).toBeVisible();
  }

  const refreshButton = page.getByRole("button", {
    name: "Refresh elevator status",
  });
  await expect(refreshButton.first()).toBeVisible();
  const pageWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
});

test("the public planner supports keyboard-only dropdown use", async ({ page }) => {
  await page.goto("/");
  const origin = page.getByLabel("Starting station", { exact: true });
  const destination = page.getByLabel("Destination station", { exact: true });

  await origin.focus();
  await origin.press("p");
  await expect(origin).toHaveValue("powell");
  await expect(destination.locator('option[value="powell"]')).toBeDisabled();

  await destination.focus();
  await destination.press("f");
  await expect(destination).toHaveValue("forest-hill");

  const swap = page.getByRole("button", { name: "Swap starting station and destination" });
  await swap.focus();
  await swap.press("Enter");
  await expect(origin).toHaveValue("forest-hill");
  await expect(destination).toHaveValue("powell");
  await expect(page.getByRole("button", { name: "Show my step-free plan" })).toBeVisible();
});
test("operator routes require authentication", async ({ page }) => {
  await page.goto("/admin");

  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Operator sign in" }),
  ).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
});

test("an operator can sign in and end the session", async ({ page }) => {
  const email = process.env.E2E_AUTH_EMAIL;
  const password = process.env.E2E_AUTH_PASSWORD;

  test.skip(!email || !password, "Temporary E2E credentials were not provided.");

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();

  await page.goto("/admin/operations");
  await expect(
    page.getByRole("heading", { level: 1, name: "Operations" }),
  ).toBeVisible();
  await page.goto("/admin/history");
  await expect(
    page.getByRole("heading", { level: 1, name: "History" }),
  ).toBeVisible();
  await page.goto("/admin/incidents");
  await expect(
    page.getByRole("heading", { level: 1, name: "Incidents" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("an owner can queue an audited collection", async ({ page }) => {
  const email = process.env.E2E_AUTH_EMAIL;
  const password = process.env.E2E_AUTH_PASSWORD;
  test.skip(
    !email || !password || process.env.E2E_RUN_NOW !== "1",
    "Credentialed run-now mutation was not enabled.",
  );

  await page.goto("/login");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/, { timeout: 15_000 });

  await page.goto("/admin/operations");
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(
    page.getByText(
      "Collection queued. The worker will validate it before publication.",
    ),
  ).toBeVisible();
});

test("incident actions reject anonymous callers", async ({ request }) => {
  const response = await request.post(
    "/api/admin/incidents/11111111-1111-4111-8111-111111111111/acknowledge",
    {
      headers: { "Idempotency-Key": crypto.randomUUID() },
      data: {},
    },
  );
  expect(response.status()).toBe(401);
});

test("liveness reports the web process", async ({ request }) => {
  const response = await request.get("/api/health/live");
  expect(response.ok()).toBe(true);
  expect(response.headers()).toMatchObject({
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), geolocation=(), microphone=()",
    "x-frame-options": "DENY",
  });
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "unbroken-web",
  });
});

test("public accessibility API fails closed and omits internal identities", async ({ request }) => {
  const response = await request.get("/api/public/accessibility");
  expect(response.headers()["cache-control"]).toContain("no-store");
  const text = await response.text();
  expect(text).not.toContain("sourceKey");
  expect(text).not.toContain("collectorId");
  expect(text).not.toContain("acceptedAt");
  expect(text).not.toContain("collectedAt");
  expect(text).not.toContain("newerUpdateHeld");

  const body = JSON.parse(text) as {
    available: boolean;
    message?: string;
    trust?: Record<string, unknown>;
    stations?: Array<{ elevators: Array<{ role: string }> }>;
  };
  if (response.status() === 503) {
    expect(body).toMatchObject({
      available: false,
      message: "Elevator information is unavailable right now.",
    });
    expect(body.trust).toBeUndefined();
    return;
  }

  expect(response.ok()).toBe(true);
  expect(body.available).toBe(true);
  expect(Object.keys(body.trust ?? {}).sort()).toEqual([
    "ageSeconds",
    "sourceValidAt",
    "state",
  ]);
  expect(body.stations).toHaveLength(11);
  expect(body.stations?.every((station) => station.elevators.length > 0)).toBe(
    true,
  );
  expect(
    body.stations?.every((station) =>
      station.elevators.every((elevator) => Boolean(elevator.role)),
    ),
  ).toBe(true);
});

test("public route API gives rider-friendly validation errors", async ({ request }) => {
  const missing = await request.post("/api/public/routes", { data: {} });
  expect(missing.status()).toBe(400);
  expect(missing.headers()["cache-control"]).toContain("no-store");
  await expect(missing.json()).resolves.toEqual({
    message: "Choose a supported starting station.",
  });

  const sameStation = await request.post("/api/public/routes", {
    data: { origin: "powell", destination: "powell" },
  });
  expect(sameStation.status()).toBe(400);
  expect(sameStation.headers()["cache-control"]).toContain("no-store");
  await expect(sameStation.json()).resolves.toEqual({
    message: "Choose two different stations.",
  });
});

test("citywide coverage uses database counts and separates source times", async ({
  page,
}) => {
  await page.goto("/coverage");
  await expect(
    page.getByRole("heading", { level: 1, name: "Data coverage" }),
  ).toBeVisible();

  await expect(
    page.getByRole("heading", { name: "Checked by UNBROKEN at" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "SFMTA updated at" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: /Current checked schedule|Using the last checked schedule/,
    }),
  ).toBeVisible();
  const countRows = page
    .getByRole("table")
    .getByRole("row")
    .filter({
      has: page.getByRole("rowheader"),
    });
  await expect(countRows).toHaveCount(6);
  for (const cell of await countRows.getByRole("cell").all()) {
    const value = (await cell.textContent())?.replaceAll(",", "").trim() ?? "";
    expect(Number(value)).toBeGreaterThan(0);
  }
  await expect(
    page.getByRole("link", { name: /Open official transit data/ }),
  ).toHaveAttribute("href", "https://511.org/open-data/transit");

  const pageWidth = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
});
