import { expect, test } from "@playwright/test";

const PUBLIC_ROUTES = [
  "/",
  "/explore",
  "/leaderboards",
  "/compare",
  "/my-pulse",
  "/changes",
  "/live-data",
  "/judge",
] as const;

test.describe("PulseRank public release smoke", () => {
  test.setTimeout(90_000);

  test("serves every public surface without a runtime error", async ({ page }) => {
    for (const route of PUBLIC_ROUTES) {
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response?.status(), route).toBe(200);
      await expect(page.locator("body")).not.toContainText("Application error");
    }
  });

  test("exposes the trusted catalog and a current leaderboard", async ({ request }) => {
    const products = await request.get("/api/public/products?limit=100");
    expect(products.status()).toBe(200);
    const productBody = (await products.json()) as {
      schemaVersion?: string;
      items?: Array<{ name?: string; sourceUrl?: string | null }>;
    };
    expect(productBody.schemaVersion).toBe("1.0");
    expect(productBody.items?.length).toBeGreaterThan(0);
    expect(productBody.items?.every((item) => item.name && item.sourceUrl)).toBe(true);

    const leaderboard = await request.get(
      "/api/public/leaderboards?board=highest-total-caffeine&limit=3",
    );
    expect(leaderboard.status()).toBe(200);
    const leaderboardBody = (await leaderboard.json()) as {
      trustedProductCount?: number;
      entries?: unknown[];
    };
    expect(leaderboardBody.trustedProductCount).toBeGreaterThan(0);
    expect(leaderboardBody.entries?.length).toBeGreaterThan(0);
  });

  test("keeps the retired admin namespace unavailable", async ({ request }) => {
    const response = await request.get("/admin");
    expect(response.status()).toBe(404);
  });
});
