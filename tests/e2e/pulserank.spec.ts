import { expect, test } from "@playwright/test";

const PUBLIC_ROUTES = [
  "/",
  "/explore",
  "/leaderboards",
  "/compare",
  "/my-pulse",
  "/changes",
  "/live-data",
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

  test("does not expose the retired judge cockpit", async ({ request }) => {
    const response = await request.get("/judge");
    expect(response.status()).toBe(404);
  });

  test("exposes the trusted catalog and a current leaderboard", async ({ request }) => {
    const products = await request.get("/api/public/products?limit=100");
    expect(products.status()).toBe(200);
    const productBody = (await products.json()) as {
      schemaVersion?: string;
      totalCount?: number;
      activeFacets?: Record<string, unknown>;
      items?: Array<{
        name?: string;
        sourceUrl?: string | null;
        categoryProvenance?: string;
        serving?: { normalizedMl?: number | null };
      }>;
    };
    expect(productBody.schemaVersion).toBe("1.1");
    expect(productBody.totalCount).toBeGreaterThan(0);
    expect(productBody.activeFacets).toEqual({});
    expect(productBody.items?.length).toBeGreaterThan(0);
    expect(productBody.items?.every((item) => item.name && item.sourceUrl)).toBe(true);
    expect(
      productBody.items?.every(
        (item) =>
          typeof item.categoryProvenance === "string" &&
          item.serving &&
          "normalizedMl" in item.serving,
      ),
    ).toBe(true);

    const leaderboard = await request.get(
      "/api/public/leaderboards?board=highest-total-caffeine&limit=3",
    );
    expect(leaderboard.status()).toBe(200);
    const leaderboardBody = (await leaderboard.json()) as {
      schemaVersion?: string;
      trustedProductCount?: number;
      totalCount?: number;
      entries?: Array<{ previousRank?: number | null; rankDelta?: number | null }>;
    };
    expect(leaderboardBody.schemaVersion).toBe("1.1");
    expect(leaderboardBody.trustedProductCount).toBeGreaterThan(0);
    expect(leaderboardBody.totalCount).toBeGreaterThan(0);
    expect(leaderboardBody.entries?.length).toBeGreaterThan(0);
    expect(
      leaderboardBody.entries?.every(
        (entry) => "previousRank" in entry && "rankDelta" in entry,
      ),
    ).toBe(true);
  });

  test("keeps the retired admin namespace unavailable", async ({ request }) => {
    const response = await request.get("/admin");
    expect(response.status()).toBe(404);
  });
});
