import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  addCompareSlug,
  replaceCompareSlugs,
} from "@/lib/local-state/compare";
import { MockLocalStorage, installBrowserStorage, uninstallBrowserStorage } from "../../lib/local-state/mock-storage";
import { isCurrentCompareRequest, reconcileCompareSelection } from "@/components/pulserank/compare/compare-reconciliation";

describe("compare selection reconciliation", () => {
  beforeEach(() => {
    installBrowserStorage();
  });

  it("keeps an empty browser tray empty", () => {
    expect(reconcileCompareSelection({
      add: addCompareSlug,
      addSlug: null,
      replace: replaceCompareSlugs,
      shared: undefined,
      stored: [],
    })).toEqual({ notice: null, requested: [] });
  });

  it("sanitizes and deduplicates a shared URL before rendering", () => {
    const result = reconcileCompareSelection({
      add: addCompareSlug,
      addSlug: null,
      replace: replaceCompareSlugs,
      shared: ["alpha", "alpha", "", " beta "],
      stored: [],
    });

    expect(result).toEqual({ notice: null, requested: ["alpha", "beta"] });
  });

  it("keeps shared products viewable when persistence and add both fail", () => {
    const throwing = new MockLocalStorage();
    throwing.setItem = () => { throw new Error("QuotaExceededError"); };
    installBrowserStorage(throwing);

    const result = reconcileCompareSelection({
      add: addCompareSlug,
      addSlug: "gamma",
      replace: replaceCompareSlugs,
      shared: ["alpha", "alpha", "beta"],
      stored: [],
    });

    expect(result.requested).toEqual(["alpha", "beta"]);
    expect(result.notice).toContain("view-only");
  });

  it("retains stale requested slugs so Clear all remains available", () => {
    const result = reconcileCompareSelection({
      add: addCompareSlug,
      addSlug: null,
      replace: replaceCompareSlugs,
      shared: ["removed-product"],
      stored: [],
    });

    expect(result.requested).toEqual(["removed-product"]);
  });

  it("rejects a stale response after Clear all advances the request generation", () => {
    const requestStarted = 3;
    const requestAfterClear = 4;

    expect(isCurrentCompareRequest(true, requestStarted, requestAfterClear)).toBe(false);
    expect(isCurrentCompareRequest(true, requestAfterClear, requestAfterClear)).toBe(true);
  });

  it("reports the four-product cap without dropping the persisted selection", () => {
    for (const slug of ["a", "b", "c", "d"]) addCompareSlug(slug);

    const result = reconcileCompareSelection({
      add: addCompareSlug,
      addSlug: "e",
      replace: replaceCompareSlugs,
      shared: undefined,
      stored: ["a", "b", "c", "d"],
    });

    expect(result.requested).toEqual(["a", "b", "c", "d"]);
    expect(result.notice).toContain("up to 4");
  });

  afterEach(uninstallBrowserStorage);
});
