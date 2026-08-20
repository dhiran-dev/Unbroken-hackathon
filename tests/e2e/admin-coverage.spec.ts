import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function signInOperator(page: Page) {
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
}

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(violations).toEqual([]);
}

test("anonymous visitors cannot open private coverage evidence", async ({
  page,
}) => {
  await page.goto("/admin/coverage");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Operator sign in" }),
  ).toBeVisible();
  await expect(
    page.getByText("Citywide coverage", { exact: true }),
  ).toHaveCount(0);
});

test("operator coverage evidence stays usable across filters, mobile, and dark mode", async ({
  page,
}) => {
  await signInOperator(page);
  await page.goto("/admin/coverage");

  await expect(
    page.getByRole("heading", { level: 1, name: "Citywide coverage" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "Checked by UNBROKEN at" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "SFMTA updated at" }),
  ).toBeVisible();
  await expect(page.locator("table").last().locator("tbody tr")).toHaveCount(7);
  await expect(page.getByText("collectorId", { exact: true })).toHaveCount(0);
  await expect(page.getByText("payloadHash", { exact: true })).toHaveCount(0);

  const externalHrefs = await page
    .locator('a[target="_blank"]')
    .evaluateAll((links) =>
      links
        .map((link) => link.getAttribute("href"))
        .filter((href): href is string => Boolean(href)),
    );
  expect(
    externalHrefs.every(
      (href) =>
        href.startsWith("https://511.org/") ||
        href.startsWith("https://www.sfmta.com/"),
    ),
  ).toBe(true);

  const filter = page.getByLabel("Filter coverage sources", { exact: true });
  await filter.selectOption("unavailable");
  await page.getByRole("button", { name: "Apply filter" }).click();
  await expect(page).toHaveURL(/statusFilter=unavailable/);
  await expect(filter).toHaveValue("unavailable");

  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.reload();
  await expect(
    page.getByRole("heading", { level: 1, name: "Citywide coverage" }),
  ).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
  await expectNoSeriousAccessibilityViolations(page);
});
