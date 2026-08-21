import { beforeEach, describe, expect, it } from "vitest";

import {
  RECENTLY_VIEWED_CAP,
  mergeRecentlyViewed,
  sanitizeRecentlyViewedRecord,
} from "@/lib/local-state/recently-viewed";
import type { RecentlyViewedRecord } from "@/lib/local-state/recently-viewed";
import type { SavedProductCaffeine } from "@/lib/local-state/saved-products";
import { makeSavedProductRef } from "./fixtures";
import { uninstallBrowserStorage } from "./mock-storage";

function stored(index: number): RecentlyViewedRecord {
  return {
    slug: `product-${index}`,
    viewedAt: index,
    ref: makeSavedProductRef({ slug: `product-${index}`, name: `Product ${index}` }),
  };
}

describe("recently-viewed", () => {
  describe("SSR safety (no window, no indexedDB)", () => {
    beforeEach(() => {
      uninstallBrowserStorage();
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    });

    it("resolves reads to empty results", async () => {
      const mod = await import("@/lib/local-state/recently-viewed");
      await expect(mod.listRecentlyViewed()).resolves.toEqual([]);
      await expect(mod.listRecentlyViewed(5)).resolves.toEqual([]);
    });

    it("resolves writes to no-ops but still validates input", async () => {
      const mod = await import("@/lib/local-state/recently-viewed");
      const ref = makeSavedProductRef();
      await expect(mod.touchRecentlyViewed(ref.slug, ref)).resolves.toBeNull();
      await expect(mod.removeRecentlyViewed(ref.slug)).resolves.toBe(false);
      await expect(mod.clearRecentlyViewed()).resolves.toBeUndefined();
      // An invalid key slug throws even though storage is unavailable.
      await expect(mod.touchRecentlyViewed("", ref)).rejects.toThrow(TypeError);
      // A ref missing required fields throws regardless of the key.
      await expect(
        mod.touchRecentlyViewed(ref.slug, { ...ref, caffeine: null as unknown as SavedProductCaffeine }),
      ).rejects.toThrow(TypeError);
      expect(typeof RECENTLY_VIEWED_CAP).toBe("number");
    });
  });

  describe("mergeRecentlyViewed (pure)", () => {
    it("dedupes by slug and recency-orders newest first", () => {
      const records = [stored(1), stored(2), stored(3)];
      const merged = mergeRecentlyViewed(records, "product-2", makeSavedProductRef({
        slug: "product-2",
        name: "Refreshed Product 2",
      }), 100);
      expect(merged.map((item) => item.slug)).toEqual(["product-2", "product-3", "product-1"]);
      expect(merged[0]?.viewedAt).toBe(100);
      // Exactly one record survives for the touched slug.
      expect(merged.filter((item) => item.slug === "product-2")).toHaveLength(1);
      expect(merged[0]?.ref.name).toBe("Refreshed Product 2");
    });

    it("caps the list at 50 entries, evicting the oldest", () => {
      const records = Array.from({ length: RECENTLY_VIEWED_CAP }, (_, i) =>
        stored(i + 10),
      );
      expect(records).toHaveLength(RECENTLY_VIEWED_CAP);
      const oldestViewedAt = Math.min(...records.map((item) => item.viewedAt));
      const merged = mergeRecentlyViewed(
        records,
        "new-arrival",
        makeSavedProductRef({ slug: "new-arrival" }),
        9999,
      );
      expect(merged).toHaveLength(RECENTLY_VIEWED_CAP);
      expect(merged[0]?.slug).toBe("new-arrival");
      expect(merged.some((item) => item.viewedAt === oldestViewedAt)).toBe(false);
    });

    it("does not mutate the input array", () => {
      const records = [stored(1), stored(2)];
      const snapshot = [...records];
      mergeRecentlyViewed(records, "product-3", makeSavedProductRef({ slug: "product-3" }), 50);
      expect(records.map((item) => item.slug)).toEqual(snapshot.map((item) => item.slug));
    });
  });

  describe("sanitizeRecentlyViewedRecord (pure)", () => {
    it("accepts a valid record and rejects broken ones", () => {
      expect(sanitizeRecentlyViewedRecord(stored(7))).toEqual(stored(7));
      expect(sanitizeRecentlyViewedRecord(null)).toBeNull();
      expect(sanitizeRecentlyViewedRecord({ slug: "x" })).toBeNull();
      // A stale outer key is normalized: the stored key mirrors the ref's slug
      // so the two can never diverge.
      expect(
        sanitizeRecentlyViewedRecord({
          ...stored(7),
          ref: { ...makeSavedProductRef(), slug: "other" },
        })?.slug,
      ).toBe("other");
    });

    it("defaults a missing viewedAt and mirrors the ref slug as key", () => {
      const sanitized = sanitizeRecentlyViewedRecord({
        ref: makeSavedProductRef({ slug: "key-from-ref" }),
      });
      expect(sanitized?.slug).toBe("key-from-ref");
      expect(typeof sanitized?.viewedAt).toBe("number");
    });
  });
});
