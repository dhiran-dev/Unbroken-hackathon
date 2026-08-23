import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

import { isExactPlotProduct } from "@/components/pulserank/explore/explore-model";
import type { PublicProductDto } from "@/server/products/dto";

test.describe("PulseRank Explore", () => {
  test.setTimeout(90_000);

  test("traverses the full trusted catalog and plots every eligible product", async ({ page, request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic API traversal");
    const slugs = new Set<string>();
    const products: PublicProductDto[] = [];
    let cursor: string | null = null;
    let totalCount: number | null = null;

    do {
      const parameters = new URLSearchParams({ limit: "100" });
      if (cursor) parameters.set("cursor", cursor);
      const response = await request.get(`/api/public/products?${parameters.toString()}`);
      expect(response.status()).toBe(200);
      const body = (await response.json()) as {
        items: PublicProductDto[];
        nextCursor: string | null;
        totalCount: number;
      };
      totalCount ??= body.totalCount;
      expect(body.totalCount).toBe(totalCount);
      for (const item of body.items) {
        expect(slugs.has(item.slug), `duplicate slug ${item.slug}`).toBe(false);
        slugs.add(item.slug);
        products.push(item);
      }
      cursor = body.nextCursor;
    } while (cursor);

    expect(slugs.size).toBe(totalCount);

    const expectedPlotCount = products.filter((product) =>
      isExactPlotProduct(product, "total"),
    ).length;
    const expectedConcentrationCount = products.filter((product) =>
      isExactPlotProduct(product, "concentration"),
    ).length;
    await page.goto("/explore", { waitUntil: "networkidle" });
    await expect(page.locator("[data-plot-catalog-status]"))
      .toHaveAttribute("data-plot-catalog-status", "complete");
    await expect(page.locator("[data-plot-point]")).toHaveCount(expectedPlotCount);
    await expect(page.locator("[data-plot-catalog-status]"))
      .toContainText(`${expectedPlotCount} exact points across all results`);

    await page.getByRole("button", { name: "Concentration" }).click();
    await expect(page.locator("[data-plot-point]")).toHaveCount(expectedConcentrationCount);
    await expect(page.locator("[data-plot-catalog-status]"))
      .toContainText(`${expectedConcentrationCount} exact points across all results`);
  });

  test("renders 24 trusted products, supports command search, and cursor-loads without duplicates", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop interaction path");
    await page.goto("/explore", { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 1, name: "Explore products" })).toBeVisible();
    const initialCards = page.locator("[data-product-result]");
    await expect(initialCards).toHaveCount(24);
    await expect(initialCards.locator("[data-product-image-mode='edge-matte']")).toHaveCount(24);
    await expect(initialCards.first()).not.toContainText("Exact");
    await expect(initialCards.first()).toContainText("Product type · Not classified");
    const inspectorImage = page.locator("[data-product-inspector] img");
    await expect(inspectorImage).toBeVisible();
    await expect(inspectorImage).toHaveAttribute(
      "src",
      /\/api\/public\/product-images\//,
    );

    const firstSlug = await initialCards.first().getAttribute("data-product-result");
    const renderedImage = await page.request.get(
      `/api/public/product-images/${firstSlug}`,
    );
    expect(renderedImage.status()).toBe(200);
    expect(renderedImage.headers()["content-type"]).toBe("image/webp");
    expect(renderedImage.headers()["cache-control"]).toContain("s-maxage=86400");

    await page.keyboard.press("/");
    await expect(page.locator("#explore-command-search")).toBeFocused();

    const firstBatch = await initialCards.evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-product-result")),
    );
    await page.getByRole("button", { name: "Load 24 more products" }).click();
    await expect(initialCards).toHaveCount(48);
    const secondBatch = await initialCards.evaluateAll((cards) =>
      cards.map((card) => card.getAttribute("data-product-result")),
    );
    expect(new Set(secondBatch).size).toBe(secondBatch.length);
    expect(secondBatch.slice(0, 24)).toEqual(firstBatch);

    await expect(page.getByLabel("Plot category legend")).toBeVisible();
    const selectedPoint = page.locator("[data-plot-selected='true']");
    const selectedPointSlug = await selectedPoint.getAttribute("data-plot-point");
    await selectedPoint.hover();
    await expect(page.locator(`[data-point-label="${selectedPointSlug}"]`)).toHaveCSS("opacity", "1");

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });

  test("opens the mobile inspector only after selection and keeps page overflow contained", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "Mobile interaction path");
    await page.goto("/explore", { waitUntil: "networkidle" });

    await expect(page.locator("[data-product-inspector]")).toBeHidden();
    const selectedPoint = page.locator("[data-plot-selected='true']");
    const selectedPointSlug = await selectedPoint.getAttribute("data-plot-point");
    if (!selectedPointSlug) throw new Error("Selected plot point has no slug");
    const pointBox = await selectedPoint.boundingBox();
    expect(pointBox?.width).toBeGreaterThanOrEqual(44);
    expect(pointBox?.height).toBeGreaterThanOrEqual(44);
    await selectedPoint.click();
    const inspector = page.getByRole("dialog");
    await expect(inspector).toBeVisible();
    await expect(inspector).toHaveAttribute("aria-modal", "true");
    await expect(page.getByRole("button", { name: "Close product inspector backdrop" })).toBeVisible();
    await expect(page.locator(".pr-header")).toHaveAttribute("inert", "");
    await expect(page.locator("main section").first()).toHaveAttribute("inert", "");
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
    await expect(page.getByRole("button", { name: "Close product inspector", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("link", { name: /View product passport/ })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close product inspector", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Close product inspector", exact: true }).click();
    await expect(page.locator("[data-product-inspector]")).toHaveCount(0);
    await expect(page.locator(`[data-plot-point="${selectedPointSlug}"]`)).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");

    const filterButton = page.getByRole("button", { name: /Filters/ });
    await filterButton.click();
    await expect(page.getByRole("complementary", { name: "Product filters" })).toBeVisible();

    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);
  });

  test("ships the approved direction contract in production markup", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic contract check");
    const response = await request.get("/explore");
    expect(response.status()).toBe(200);
    const markup = await response.text();
    expect(markup).toContain("THESIS: Explore is a caffeine observatory");
    expect(markup).toContain("OWN-WORLD:");
    expect(markup).toContain("STORY:");
    expect(markup).toContain("FIRST VIEWPORT:");
    expect(markup).toContain("FORM: Three-zone operate workspace; form 1; seed pulserank-explore-observatory-v1");
  });

  test("removes authored motion when reduced motion is requested", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic reduced-motion check");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/explore", { waitUntil: "networkidle" });
    const motion = await page.locator("[data-plot-point]").first().evaluate((point) => {
      const style = getComputedStyle(point);
      return {
        animationDuration: style.animationDuration,
        transitionDuration: style.transitionDuration,
      };
    });
    expect(Number.parseFloat(motion.animationDuration)).toBeLessThanOrEqual(0.00001);
    expect(Number.parseFloat(motion.transitionDuration)).toBeLessThanOrEqual(0.00001);
  });

  test("has no serious or critical automated accessibility findings", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic accessibility scan");
    await page.goto("/explore", { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).analyze();
    const materialFindings = results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    );
    expect(materialFindings).toEqual([]);
  });
});
