import { expect, test } from "@playwright/test";

// Regression: ISSUE-001 — leaderboard query changes left the previous board rows mounted
// Found by /qa on 2026-08-24
// Report: .gstack/qa-reports/qa-report-localhost-2026-08-24.md
test.describe("PulseRank leaderboard filters", () => {
  test.setTimeout(120_000);

  test("keeps board rows, category, serving, and completeness in sync", async ({ page }) => {
    await page.goto("/leaderboards?board=highest-total-caffeine&complete=1", {
      waitUntil: "networkidle",
    });

    await expect(page.getByRole("columnheader", { name: /Total caffeine/ })).toBeVisible();

    await page.getByRole("link", { name: /Highest concentration/ }).click();
    await expect(page).toHaveURL(/board=highest-exact-concentration/);
    await expect(page.getByRole("link", { name: /Highest concentration/ }))
      .toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("columnheader", { name: /Concentration/ })).toBeVisible();
    await expect(page.locator("tbody tr").first()).toContainText("DynaPep");

    await page.getByLabel("Filter by category").selectOption("soda");
    await expect(page).toHaveURL(/category=soda/);
    await expect(page.getByLabel("Filter by category")).toHaveValue("soda");
    const categories = page.locator("tbody tr td:nth-child(3)");
    await expect(categories.first()).toHaveText("Soda");
    expect(await categories.allTextContents()).toEqual(
      Array(await categories.count()).fill("Soda"),
    );

    await page.getByLabel("Filter by serving type").selectOption("drink");
    await expect(page).toHaveURL(/serving=drink/);
    await expect(page.getByLabel("Filter by serving type")).toHaveValue("drink");

    await page.getByRole("button", { name: "Complete data only" }).click();
    await expect(page).toHaveURL(/complete=0/);
    await expect(page.getByRole("button", { name: "Complete data only" }))
      .toHaveAttribute("aria-pressed", "false");

    await page.getByRole("link", { name: /Caffeine-free/ }).click();
    await expect(page).toHaveURL(
      /board=caffeine-free&category=soda&serving=drink&complete=0/,
    );
    await expect(page.getByRole("link", { name: /Caffeine-free/ }))
      .toHaveAttribute("aria-current", "page");
    const metrics = page.locator("tbody tr td:nth-child(4)");
    await expect(metrics.first()).toHaveText("0 mg");
    expect(await metrics.allTextContents()).toEqual(
      Array(await metrics.count()).fill("0 mg"),
    );
  });
});
