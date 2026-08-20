import { AxeBuilder } from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectNoSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.filter(
    ({ impact }) => impact === "serious" || impact === "critical",
  );
  expect(
    violations,
    violations
      .map(({ id, impact, help, nodes }) => `${impact} ${id}: ${help} (${nodes.length} node(s))`)
      .join("\n"),
  ).toEqual([]);
}

test("public planner has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name:
        process.env.CITYWIDE_PLANNER_ENABLED === "true"
          ? "Plan a step-free trip across San Francisco."
          : "A step-free trip should stay step-free.",
    }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});

test("public status page has no serious or critical accessibility violations", async ({ page }) => {
  await page.goto("/status");
  await expect(
    page.getByRole("heading", {
      level: 1,
      name:
        process.env.CITYWIDE_PLANNER_ENABLED === "true"
          ? "Citywide service status"
          : "Elevator status",
    }),
  ).toBeVisible();
  await expectNoSeriousAccessibilityViolations(page);
});
