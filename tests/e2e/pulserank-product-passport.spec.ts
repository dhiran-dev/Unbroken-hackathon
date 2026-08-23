import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const EXACT_PRODUCT = "/products/mega-monster-energy-drink";

test.describe("PulseRank Product Passport", () => {
  test.setTimeout(90_000);

  test("renders the approved exact-value instrument from the trusted DTO", async ({ page }) => {
    await page.goto(EXACT_PRODUCT, { waitUntil: "networkidle" });

    await expect(page.getByRole("heading", { level: 1, name: "Mega Monster Energy Drink" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Exact value/ })).toBeVisible();
    await expect(page.getByText("240", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("per 709 ml serving", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Sugar measure" })).toBeVisible();
    await expect(page.getByText("81 g", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Bottle scale represents published grams; not a recommended limit.")).toBeVisible();
    await expect(page.getByRole("img", { name: "Sugar quantity in a glass measuring bottle" })).toBeVisible();
    await expect(page.locator("img[alt='Mega Monster Energy Drink product packaging']")).toHaveAttribute(
      "src",
      /\/api\/public\/product-images\/mega-monster-energy-drink/,
    );
    await expect(page.getByRole("button", { name: /Open source/i })).toHaveCount(0);
    await expect(page.locator("[data-evidence-column]")).toHaveCount(4);
    await expect(page.locator("[data-evidence-column]").first()).toHaveAttribute(
      "data-evidence-column",
      "product-metadata",
    );
    await expect(page.getByText("Product metadata", { exact: true })).toBeVisible();
    await expect(page.getByText("Source category list", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Eligible for total-caffeine ranking", { exact: false })).toBeVisible();
  });

  test("gives the product specimen the full artwork bay", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop chassis geometry assertion");
    await page.goto(EXACT_PRODUCT, { waitUntil: "networkidle" });

    const geometry = await page.evaluate(() => {
      const bay = document.querySelector<HTMLElement>("[data-product-bay]");
      const specimen = document.querySelector<HTMLElement>("[data-product-specimen]");
      if (!bay || !specimen) return null;
      const bayBox = bay.getBoundingClientRect();
      const specimenBox = specimen.getBoundingClientRect();
      return { bayWidth: bayBox.width, specimenWidth: specimenBox.width };
    });

    expect(geometry).not.toBeNull();
    expect(geometry!.specimenWidth).toBeGreaterThan(geometry!.bayWidth * .82);
  });

  test("supports browser-local actions with visible state and keyboard focus", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic action path");
    await page.goto(EXACT_PRODUCT, { waitUntil: "networkidle" });

    const save = page.getByRole("button", { name: /^Save/ });
    await save.focus();
    await expect(save).toBeFocused();
    await expect(save).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: /^Saved/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status")).toContainText("Saved in this browser");

    const compare = page.getByRole("button", { name: /^Compare/ });
    await compare.click();
    await expect(page.getByRole("button", { name: /^In Compare/ })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: /Add to My Day/ }).click();
    await expect(page.getByRole("status")).toContainText("Added to My Day");
  });

  test("preserves explicit zero, conflicting, and not-published caffeine states from real trusted records", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single database-state traversal");

    await page.goto("/products/7-up", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Explicit zero/ })).toBeVisible();
    await expect(page.getByText("0", { exact: true }).first()).toBeVisible();

    await page.goto("/products/kaffn8", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Conflicting values/ })).toBeVisible();
    await expect(page.getByText("Conflicting", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Not eligible for total-caffeine ranking", { exact: false })).toBeVisible();

    await page.goto("/products/atomic-x", { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Not published/ })).toBeVisible();
    await expect(page.getByText("Not published", { exact: true }).first()).toBeVisible();
  });

  test("contains page overflow and keeps every local action at least 44 pixels", async ({ page }) => {
    await page.goto(EXACT_PRODUCT, { waitUntil: "networkidle" });
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);

    const targets = await page.getByRole("complementary", { name: "Local product actions" }).getByRole("button").evaluateAll(
      (buttons) => buttons.map((button) => {
        const box = button.getBoundingClientRect();
        return { height: box.height, width: box.width };
      }),
    );
    for (const target of targets) {
      expect(target.height).toBeGreaterThanOrEqual(44);
      expect(target.width).toBeGreaterThanOrEqual(44);
    }
  });

  test("replaces authored movement with an intentional reduced-motion path", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic reduced-motion check");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(EXACT_PRODUCT, { waitUntil: "networkidle" });
    const motion = await page.evaluate(() => {
      const sugar = document.querySelector("[class*='sugarFill']");
      const datum = document.querySelector("[class*='datumLine']");
      return {
        datumAnimation: datum ? getComputedStyle(datum).animationName : "missing",
        sugarAnimation: sugar ? getComputedStyle(sugar).animationName : "none",
      };
    });
    expect(motion.datumAnimation).toBe("none");
    expect(motion.sugarAnimation).toBe("none");
  });

  test("has no serious or critical automated accessibility findings", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic accessibility scan");
    await page.goto(EXACT_PRODUCT, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    )).toEqual([]);
  });
});
