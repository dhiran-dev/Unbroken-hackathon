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
import { MockLocalStorage, installBrowserStorage, uninstallBrowserStorage } from "./mock-storage";

describe("compare tray", () => {
  describe("on the server (SSR)", () => {
    beforeEach(uninstallBrowserStorage);

    it("reads empty and no-ops mutations", () => {
      expect(getCompareSlugs()).toEqual([]);
      expect(addCompareSlug("cold-brew")).toEqual({ slugs: [], ok: false, added: false });
      expect(toggleCompareSlug("cold-brew")).toEqual({ slugs: [], ok: false, added: false });
      expect(removeCompareSlug("cold-brew")).toEqual({ slugs: [], ok: false, added: false });
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
      expect(addCompareSlug("cold-brew")).toEqual({ slugs: ["cold-brew"], ok: true, added: true });
      expect(addCompareSlug("cold-brew")).toEqual({ slugs: ["cold-brew"], ok: true, added: false });
      expect(getCompareSlugs()).toEqual(["cold-brew"]);
      expect(addCompareSlug("espresso")).toEqual({
        slugs: ["cold-brew", "espresso"],
        ok: true,
        added: true,
      });
      expect(storage.getItem(COMPARE_STORAGE_KEY)).toBe(
        JSON.stringify(["cold-brew", "espresso"]),
      );
    });

    it("enforces the hard cap of 4 without evicting", () => {
      for (const slug of ["a", "b", "c", "d"]) addCompareSlug(slug);
      const result = addCompareSlug("e");
      expect(result.ok).toBe(true);
      expect(result.added).toBe(false);
      expect(getCompareSlugs()).toEqual(["a", "b", "c", "d"]);
      expect(MAX_COMPARE_ITEMS).toBe(4);
    });

    it("removes and toggles", () => {
      for (const slug of ["a", "b"]) addCompareSlug(slug);
      expect(removeCompareSlug("a")).toEqual({ slugs: ["b"], ok: true, added: false });
      expect(removeCompareSlug("missing")).toEqual({ slugs: ["b"], ok: true, added: false });

      expect(toggleCompareSlug("c")).toEqual({ slugs: ["b", "c"], ok: true, added: true });
      expect(toggleCompareSlug("c")).toEqual({ slugs: ["b"], ok: true, added: false });
      expect(toggleCompareSlug("")).toEqual({ slugs: ["b"], ok: true, added: false });
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
      expect(replaceCompareSlugs(["p", "p", "q", "r", "s", "t"])).toEqual({
        ok: true,
        slugs: ["p", "q", "r", "s"],
      });
      expect(getCompareSlugs()).toEqual(["p", "q", "r", "s"]);
    });

    it("distinguishes a failed empty write from a successful empty selection", () => {
      const throwing = new MockLocalStorage();
      throwing.setItem = () => { throw new Error("QuotaExceededError"); };
      installBrowserStorage(throwing);
      expect(replaceCompareSlugs([])).toEqual({ ok: false, slugs: [] });
    });

    it("distinguishes storage failure from a full or duplicate no-op", () => {
      for (const slug of ["a", "b", "c", "d"]) addCompareSlug(slug);
      expect(addCompareSlug("e")).toEqual({
        slugs: ["a", "b", "c", "d"],
        ok: true,
        added: false,
      });

      const writable = new MockLocalStorage();
      installBrowserStorage(writable);
      expect(addCompareSlug("existing")).toEqual({ slugs: ["existing"], ok: true, added: true });
      writable.setItem = () => { throw new Error("QuotaExceededError"); };
      expect(addCompareSlug("new-product")).toEqual({ slugs: ["existing"], ok: false, added: false });
      expect(removeCompareSlug("existing")).toEqual({ slugs: ["existing"], ok: false, added: false });
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
