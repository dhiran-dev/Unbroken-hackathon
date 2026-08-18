import { expect, test } from "@playwright/test";

test("public rider surfaces render truthfully", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "A step-free trip should stay step-free.",
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Starting point")).toBeVisible();
  await expect(page.getByLabel("Destination")).toBeVisible();

  await page
    .getByRole("link", { name: "Elevator status", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { level: 1, name: "Elevator status" }),
  ).toBeVisible();
  await expect(page.getByText("Status unavailable")).toBeVisible();
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

  await expect(page).toHaveURL(/\/admin$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Overview" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
});

test("liveness reports the web process", async ({ request }) => {
  const response = await request.get("/api/health/live");
  expect(response.ok()).toBe(true);
  await expect(response.json()).resolves.toMatchObject({
    status: "ok",
    service: "unbroken-web",
  });
});
