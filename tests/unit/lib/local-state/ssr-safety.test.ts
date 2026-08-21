import { describe, expect, it, vi } from "vitest";

/**
 * Proves every local-state module can be imported in a server runtime with
 * no `window`, `localStorage`, or `indexedDB` — i.e. importing during SSR is
 * side-effect free and never throws.
 */
describe("local-state SSR import safety", () => {
  it("imports all modules fresh without browser globals present", async () => {
    expect(typeof window).toBe("undefined");

    vi.resetModules();
    const modules = await Promise.all([
      import("@/lib/local-state/keys"),
      import("@/lib/local-state/storage"),
      import("@/lib/local-state/db"),
      import("@/lib/local-state/preferences"),
      import("@/lib/local-state/compare"),
      import("@/lib/local-state/saved-products"),
      import("@/lib/local-state/my-day"),
      import("@/lib/local-state/recently-viewed"),
      import("@/lib/local-state/export-import"),
    ]);

    for (const mod of modules) {
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }

    // And the shared database name/version are what every consumer must use.
    const db = await import("@/lib/local-state/db");
    expect(db.PULSERANK_DB_NAME).toBe("pulserank");
    expect(db.PULSERANK_DB_VERSION).toBe(1);
    expect(db.SAVED_PRODUCTS_STORE).toBe("saved-products");
    expect(db.MY_DAY_STORE).toBe("my-day");
    expect(db.RECENTLY_VIEWED_STORE).toBe("recently-viewed");
  });
});
