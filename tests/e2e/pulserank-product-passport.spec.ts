import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const EXACT_PRODUCT = "/products/mega-monster-energy-drink";

test.describe("PulseRank Product Passport", () => {
  test.setTimeout(90_000);

  test("renders the approved Product Page composition from the trusted DTO", async ({ page }) => {
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { level: 1, name: "Mega Monster Energy Drink" })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Exact value/ })).toHaveCount(1);
    await expect(page.getByRole("img", { name: /240 mg caffeine and (Unavailable|81 g) sugar/ })).toBeVisible();
    await expect(page.getByText("709 ml", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("33.9 mg", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("No recommended target implied", { exact: true })).toBeVisible();
    await expect(page.locator("img[alt='Mega Monster Energy Drink product packaging']")).toHaveAttribute(
      "src",
      /\/api\/public\/product-images\/mega-monster-energy-drink/,
    );
    await expect(page.getByRole("link", { name: /Caffeine Informer/ })).toHaveAttribute("href", /caffeineinformer\.com/);
    await expect(page.getByText("Not included in public view", { exact: true })).toHaveCount(2);
    await expect(page.locator("[data-bento-item]")).toHaveCount(2);
    await expect(page.locator("[data-evidence-column]")).toHaveCount(4);
    await expect(page.locator("[data-evidence-column]").first()).toHaveAttribute(
      "data-evidence-column",
      "product-metadata",
    );
    await expect(page.getByText("Product metadata", { exact: true })).toBeVisible();
    await expect(page.getByText("Source category list", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Total caffeine eligible", { exact: true })).toBeVisible();
    await expect(page.getByText("Yes", { exact: true }).first()).toBeVisible();
  });

  test("gives the product specimen the full artwork bay", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Desktop chassis geometry assertion");
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });

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
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("complementary", { name: "Product actions" })).toHaveAttribute(
      "data-interactive",
      "true",
      { timeout: 15_000 },
    );
    const save = page.getByRole("button", { name: /^(Save|Saved)$/ });
    const initiallySaved = await save.getAttribute("aria-pressed") === "true";
    await save.focus();
    await expect(save).toBeFocused();
    await expect(save).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: initiallySaved ? "Save" : "Saved" })).toHaveAttribute(
      "aria-pressed",
      initiallySaved ? "false" : "true",
    );
    await expect(page.getByRole("status")).toContainText(initiallySaved ? "Removed from this browser" : "Saved in this browser");

    const compare = page.getByRole("button", { name: /^Compare/ });
    await compare.click();
    await expect(page.getByRole("button", { name: /^In Compare/ })).toHaveAttribute("aria-pressed", "true");

    const addToMyDay = page.getByRole("button", { name: "Add to My Day" });
    await expect(addToMyDay).toHaveCount(1);
    await addToMyDay.click();
    await expect(page.getByRole("status")).toContainText("Added to My Day in this browser");
    await expect(page.getByRole("link", { name: /Caffeine Informer/ })).toHaveCount(1);
  });

  test("preserves explicit zero, conflicting, and not-published caffeine states from real trusted records", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single database-state traversal");

    await page.goto("/products/7-up", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Explicit zero/ })).toHaveCount(1);
    await expect(page.getByRole("img", { name: /0 mg caffeine/ })).toBeVisible();

    await page.goto("/products/kaffn8", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Conflicting values/ })).toHaveCount(1);
    await expect(page.getByRole("img", { name: /Conflicting caffeine/ })).toBeVisible();
    await expect(page.locator("[data-evidence-column='ranking-eligibility'] [data-eligible='false']")).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Save" })).toBeDisabled();
    await expect(page.getByText(/Save unavailable: Save requires a published numeric caffeine point/)).toBeVisible();

    await page.goto("/products/atomic-x", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 2, name: /Total caffeine · Not published/ })).toHaveCount(1);
    await expect(page.getByRole("img", { name: /Not published caffeine/ })).toBeVisible();
  });

  test("contains page overflow and keeps every local action at least 44 pixels", async ({ page }) => {
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });
    const overflow = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBe(overflow.clientWidth);

    const targets = await page.getByRole("complementary", { name: "Product actions" }).locator("button, a").evaluateAll(
      (elements) => elements.map((element) => {
        const box = element.getBoundingClientRect();
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
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });
    const motion = await page.evaluate(() => {
      const smoothCursor = document.querySelector("[class*='smoothCursor']");
      return {
        cursorPresent: smoothCursor !== null,
        canvases: document.querySelectorAll("canvas").length,
      };
    });
    expect(motion.cursorPresent).toBe(false);
    expect(motion.canvases).toBeGreaterThanOrEqual(2);
  });

  test("reports storage unavailability without claiming a successful save", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic storage-failure path");
    await page.addInitScript(() => {
      Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: undefined });
    });
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });
    const save = page.getByRole("button", { name: "Save" });
    await save.click();
    await expect(save).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("status")).toContainText("browser storage is unavailable");
  });

  test("has no serious or critical automated accessibility findings", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile", "Single deterministic accessibility scan");
    await page.goto(EXACT_PRODUCT, { waitUntil: "domcontentloaded" });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter(
      (violation) => violation.impact === "serious" || violation.impact === "critical",
    )).toEqual([]);
  });
});
