import { beforeEach, describe, expect, it } from "vitest";

import {
  sanitizeSavedProductRef,
  sanitizeStoredSavedProduct,
  toStoredSavedProduct,
} from "@/lib/local-state/saved-products";
import type { SavedProductRef } from "@/lib/local-state/saved-products";
import { makeSavedProductRef } from "./fixtures";
import { uninstallBrowserStorage } from "./mock-storage";

// NOTE: fake-indexeddb is intentionally NOT a dependency of this repo (and
// installing dependencies is out of scope for A11), so the real IndexedDB
// round-trip cannot run under vitest's node environment. These tests cover
// the pure record logic and the SSR no-op contract; the browser-path gap is
// recorded in docs/handoffs/A11-local-state.md.

describe("saved-products", () => {
  describe("SSR safety (no window, no indexedDB)", () => {
    beforeEach(() => {
      uninstallBrowserStorage();
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    });

    it("resolves reads to empty results", async () => {
      const { getSavedProduct, isProductSaved, listSavedProducts } =
        await import("@/lib/local-state/saved-products");
      await expect(listSavedProducts()).resolves.toEqual([]);
      await expect(getSavedProduct("celsius-original")).resolves.toBeNull();
      await expect(isProductSaved("celsius-original")).resolves.toBe(false);
    });

    it("resolves writes to no-ops instead of throwing", async () => {
      const { clearSavedProducts, removeSavedProduct, saveSavedProduct } =
        await import("@/lib/local-state/saved-products");
      await expect(saveSavedProduct(makeSavedProductRef())).resolves.toBeNull();
      await expect(removeSavedProduct("celsius-original")).resolves.toBe(false);
      await expect(clearSavedProducts()).resolves.toBeUndefined();
    });
  });

  describe("sanitizeSavedProductRef (pure)", () => {
    it("accepts a complete valid ref", () => {
      expect(sanitizeSavedProductRef(makeSavedProductRef())).toEqual(
        makeSavedProductRef(),
      );
    });

    it("rejects missing or mistyped fields", () => {
      const base = makeSavedProductRef();
      const broken: unknown[] = [
        null,
        "string",
        42,
        { ...base, slug: "" },
        { ...base, slug: 7 },
        { ...base, name: undefined },
        { ...base, observedAt: "" },
        { ...base, caffeine: { mg: "200", qualifier: "per-can", sourceLevel: "label" } },
        { ...base, caffeine: { mg: -5, qualifier: "per-can", sourceLevel: "label" } },
        { ...base, caffeine: { mg: 200, qualifier: "", sourceLevel: "label" } },
        { ...base, serving: { value: "12", unit: "fl oz", form: "can" } },
        { ...base, serving: { value: 12, unit: "", form: "can" } },
        { ...base, caffeine: null },
      ];
      for (const value of broken) {
        expect(sanitizeSavedProductRef(value)).toBeNull();
      }
    });
  });

  describe("toStoredSavedProduct (pure)", () => {
    it("stamps savedAt and deep-copies nested objects", () => {
      const ref: SavedProductRef = makeSavedProductRef();
      const stored = toStoredSavedProduct(ref, 1755000000000);
      expect(stored.savedAt).toBe(1755000000000);
      expect(stored.caffeine).not.toBe(ref.caffeine);
      expect(stored.serving).not.toBe(ref.serving);
      stored.caffeine.mg = 999;
      expect(ref.caffeine.mg).toBe(200);
    });

    it("defaults savedAt to now", () => {
      const before = Date.now();
      const stored = toStoredSavedProduct(makeSavedProductRef());
      expect(stored.savedAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe("sanitizeStoredSavedProduct (pure)", () => {
    it("keeps a valid savedAt and defaults an invalid one", () => {
      const stored = { ...makeSavedProductRef(), savedAt: 1234 };
      expect(sanitizeStoredSavedProduct(stored)?.savedAt).toBe(1234);
      const noTimestamp = sanitizeStoredSavedProduct(makeSavedProductRef());
      expect(typeof noTimestamp?.savedAt).toBe("number");
      expect(sanitizeStoredSavedProduct({ ...stored, slug: "" })).toBeNull();
    });
  });
});
