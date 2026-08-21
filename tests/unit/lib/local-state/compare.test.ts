import { beforeEach, describe, expect, it } from "vitest";

import { COMPARE_STORAGE_KEY } from "@/lib/local-state/keys";
import {
  MAX_COMPARE_ITEMS,
  addCompareSlug,
  clearCompare,
  getCompareSlugs,
  isInCompare,
  parseCompareSlugs,
  removeCompareSlug,
  replaceCompareSlugs,
  sanitizeCompareSlugs,
  toggleCompareSlug,
} from "@/lib/local-state/compare";
import { installBrowserStorage, uninstallBrowserStorage } from "./mock-storage";

describe("compare tray", () => {
  describe("on the server (SSR)", () => {
    beforeEach(uninstallBrowserStorage);

    it("reads empty and no-ops mutations", () => {
      expect(getCompareSlugs()).toEqual([]);
      expect(addCompareSlug("cold-brew")).toEqual({ slugs: [], added: false });
      expect(toggleCompareSlug("cold-brew")).toEqual({ slugs: [], added: false });
      expect(removeCompareSlug("cold-brew").added).toBe(false);
      expect(isInCompare("cold-brew")).toBe(false);
      expect(clearCompare()).toBe(false);
    });
  });

  describe("in the browser (mocked localStorage)", () => {
    let storage: ReturnType<typeof installBrowserStorage>;

    beforeEach(() => {
      storage = installBrowserStorage();
    });

    it("adds, dedupes, and reports state", () => {
      expect(addCompareSlug("cold-brew")).toEqual({ slugs: ["cold-brew"], added: true });
      expect(addCompareSlug("cold-brew").added).toBe(false);
      expect(getCompareSlugs()).toEqual(["cold-brew"]);
      expect(addCompareSlug("espresso")).toEqual({
        slugs: ["cold-brew", "espresso"],
        added: true,
      });
      expect(storage.getItem(COMPARE_STORAGE_KEY)).toBe(
        JSON.stringify(["cold-brew", "espresso"]),
      );
    });

    it("enforces the hard cap of 4 without evicting", () => {
      for (const slug of ["a", "b", "c", "d"]) addCompareSlug(slug);
      const result = addCompareSlug("e");
      expect(result.added).toBe(false);
      expect(getCompareSlugs()).toEqual(["a", "b", "c", "d"]);
      expect(MAX_COMPARE_ITEMS).toBe(4);
    });

    it("removes and toggles", () => {
      for (const slug of ["a", "b"]) addCompareSlug(slug);
      expect(removeCompareSlug("a")).toEqual({ slugs: ["b"], added: false });
      expect(removeCompareSlug("missing").slugs).toEqual(["b"]);

      expect(toggleCompareSlug("c")).toEqual({ slugs: ["b", "c"], added: true });
      expect(toggleCompareSlug("c")).toEqual({ slugs: ["b"], added: false });
      expect(toggleCompareSlug("").added).toBe(false);
    });

    it("checks membership", () => {
      addCompareSlug("matcha");
      expect(isInCompare("matcha")).toBe(true);
      expect(isInCompare("nope")).toBe(false);
      expect(isInCompare("")).toBe(false);
    });

    it("recovers from corrupt stored data", () => {
      storage.seedRaw(COMPARE_STORAGE_KEY, "[broken");
      expect(getCompareSlugs()).toEqual([]);
      expect(addCompareSlug("a").added).toBe(true);
    });

    it("caps and sanitizes on read", () => {
      storage.seedRaw(
        COMPARE_STORAGE_KEY,
        JSON.stringify(["x", 7, "x", "", "y", "z", "w", "v"]),
      );
      // Strings only, trimmed, deduped, first four kept.
      expect(getCompareSlugs()).toEqual(["x", "y", "z", "w"]);
    });

    it("replaces the whole selection sanitized", () => {
      expect(replaceCompareSlugs(["p", "p", "q", "r", "s", "t"])).toEqual([
        "p",
        "q",
        "r",
        "s",
      ]);
      expect(getCompareSlugs()).toEqual(["p", "q", "r", "s"]);
    });

    it("clears the selection", () => {
      addCompareSlug("only");
      expect(clearCompare()).toBe(true);
      expect(storage.getItem(COMPARE_STORAGE_KEY)).toBeNull();
      expect(getCompareSlugs()).toEqual([]);
    });
  });

  describe("parse/sanitize helpers (pure)", () => {
    it("parses raw strings defensively", () => {
      expect(parseCompareSlugs('["a","b"]')).toEqual(["a", "b"]);
      expect(parseCompareSlugs("null")).toEqual([]);
      expect(parseCompareSlugs('"just-a-string"')).toEqual([]);
      expect(sanitizeCompareSlugs("not-an-array")).toEqual([]);
    });
  });
});
