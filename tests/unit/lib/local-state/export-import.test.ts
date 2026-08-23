import { beforeEach, describe, expect, it } from "vitest";

import { PREFERENCES_STORAGE_KEY } from "@/lib/local-state/keys";
import { loadPreferences } from "@/lib/local-state/preferences";
import { getCompareSlugs } from "@/lib/local-state/compare";
import {
  PULSERANK_LOCAL_STATE_ENVELOPE_KEY,
  exportAll,
  importAll,
  validateLocalStateEnvelope,
} from "@/lib/local-state/export-import";
import { makeSavedProductRef } from "./fixtures";
import { MockLocalStorage, installBrowserStorage, uninstallBrowserStorage } from "./mock-storage";

const VALID_STORED_PRODUCT = { ...makeSavedProductRef(), savedAt: 1755000000000 };

const VALID_MY_DAY_RECORD = {
  slug: "espresso",
  name: "Espresso",
  timeLabel: "07:30",
  caffeineMg: 75,
  id: "entry-1",
  date: "2026-08-21",
  createdAt: 1755000000000,
};

const VALID_RECENTLY_VIEWED_RECORD = {
  slug: "celsius-original",
  viewedAt: 1755000000000,
  ref: makeSavedProductRef(),
};

function baseEnvelope(): Record<string, unknown> {
  return {
    [PULSERANK_LOCAL_STATE_ENVELOPE_KEY]: 1,
    exportedAt: "2026-08-21T00:00:00.000Z",
    preferences: null,
    compare: [],
    savedProducts: [],
    myDay: [],
    recentlyViewed: [],
  };
}

describe("export-import", () => {
  describe("validateLocalStateEnvelope (pure)", () => {
    it("accepts a minimal envelope and fills empty sections", () => {
      const result = validateLocalStateEnvelope(baseEnvelope());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.compare).toEqual([]);
        expect(result.envelope.savedProducts).toEqual([]);
        expect(result.envelope.myDay).toEqual([]);
        expect(result.envelope.recentlyViewed).toEqual([]);
        expect(result.envelope.pulserankLocalStateVersion).toBe(1);
      }
    });

    it("accepts a full envelope with valid records", () => {
      const envelope = {
        ...baseEnvelope(),
        preferences: { theme: "dark" },
        compare: ["a", "b"],
        savedProducts: [VALID_STORED_PRODUCT],
        myDay: [VALID_MY_DAY_RECORD],
        recentlyViewed: [VALID_RECENTLY_VIEWED_RECORD],
      };
      const result = validateLocalStateEnvelope(envelope);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.preferences).toEqual({ theme: "dark" });
        expect(result.envelope.savedProducts[0]?.savedAt).toBe(1755000000000);
        expect(result.envelope.recentlyViewed[0]?.slug).toBe("celsius-original");
      }
    });

    it("rejects structural violations with a reason", () => {
      const cases: unknown[] = [
        null,
        "envelope",
        42,
        [],
        { exportedAt: "2026-08-21T00:00:00.000Z" }, // version missing
        { ...baseEnvelope(), [PULSERANK_LOCAL_STATE_ENVELOPE_KEY]: 2 },
        { ...baseEnvelope(), [PULSERANK_LOCAL_STATE_ENVELOPE_KEY]: "1" },
        { ...baseEnvelope(), exportedAt: "" },
        { ...baseEnvelope(), exportedAt: 123 },
        { ...baseEnvelope(), compare: "not-an-array" },
        { ...baseEnvelope(), savedProducts: {} },
        { ...baseEnvelope(), myDay: true },
        { ...baseEnvelope(), recentlyViewed: "nope" },
        { ...baseEnvelope(), preferences: "dark" },
        { ...baseEnvelope(), preferences: ["dark"] },
      ];
      for (const value of cases) {
        const result = validateLocalStateEnvelope(value);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
      }
    });

    it("drops invalid individual records instead of rejecting", () => {
      const envelope = {
        ...baseEnvelope(),
        compare: ["good", 42, "", "good", "also-good", "x", "y"],
        savedProducts: [{ garbage: true }, VALID_STORED_PRODUCT],
        myDay: [{ ...VALID_MY_DAY_RECORD, date: "not-a-date" }, VALID_MY_DAY_RECORD],
        recentlyViewed: [{ broken: 1 }, VALID_RECENTLY_VIEWED_RECORD],
      };
      const result = validateLocalStateEnvelope(envelope);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.envelope.compare).toEqual(["good", "also-good", "x", "y"]);
        expect(result.envelope.savedProducts).toHaveLength(1);
        expect(result.envelope.myDay).toHaveLength(1);
        expect(result.envelope.recentlyViewed).toHaveLength(1);
      }
    });

    it("sanitizes corrupt preference payloads to defaults", () => {
      const result = validateLocalStateEnvelope({
        ...baseEnvelope(),
        preferences: { theme: "neon", nonsense: true },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.envelope.preferences).toEqual({ theme: "system" });
    });
  });

  describe("on the server (SSR)", () => {
    beforeEach(() => {
      uninstallBrowserStorage();
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    });

    it("refuses an empty backup when browser storage is unavailable", async () => {
      await expect(exportAll()).rejects.toThrow(/Export unavailable/);
    });

    it("imports nothing and reports zero counts for a valid envelope", async () => {
      const summary = await importAll(baseEnvelope());
      expect(summary).toEqual({
        preferences: false,
        compare: 0,
        savedProducts: 0,
        myDay: 0,
        recentlyViewed: 0,
        errors: ["localStorage", "IndexedDB"],
      });
    });

    it("throws on schema-invalid envelopes instead of writing", async () => {
      await expect(importAll({ nonsense: true })).rejects.toThrow(/pulserankLocalStateVersion/);
      await expect(importAll("not-an-object")).rejects.toThrow(/JSON object/);
      await expect(
        importAll({ ...baseEnvelope(), [PULSERANK_LOCAL_STATE_ENVELOPE_KEY]: 99 }),
      ).rejects.toThrow(/Unsupported/);
    });
  });

  describe("with localStorage available but no IndexedDB", () => {
    let storage: ReturnType<typeof installBrowserStorage>;

    beforeEach(() => {
      storage = installBrowserStorage();
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    });

    it("restores preferences and compare while IndexedDB counts stay zero", async () => {
      storage.seedRaw(PREFERENCES_STORAGE_KEY, JSON.stringify({ theme: "light" }));
      const summary = await importAll({
        ...baseEnvelope(),
        preferences: { theme: "dark", defaultCategory: "energy-drinks" },
        compare: ["cold-brew", "espresso"],
      });
      expect(summary.preferences).toBe(true);
      expect(summary.compare).toBe(2);
      expect(summary.savedProducts).toBe(0);
      expect(summary.myDay).toBe(0);
      expect(summary.recentlyViewed).toBe(0);
      expect(loadPreferences()).toEqual({
        theme: "dark",
        defaultCategory: "energy-drinks",
      });
      expect(getCompareSlugs()).toEqual(["cold-brew", "espresso"]);
    });

    it("refuses export when IndexedDB is unavailable", async () => {
      const summary = await importAll({
        ...baseEnvelope(),
        preferences: { theme: "system", reducedMotionOverride: "on" },
        compare: ["matcha"],
      });
      expect(summary.preferences).toBe(true);

      await expect(exportAll()).rejects.toThrow(/IndexedDB is unavailable/);
    });

    it("restores an explicitly empty compare tray", async () => {
      const { addCompareSlug } = await import("@/lib/local-state/compare");
      addCompareSlug("kept");
      await importAll({ ...baseEnvelope(), preferences: null, compare: [] });
      expect(getCompareSlugs()).toEqual([]);
    });

    it("reports a failed empty compare write instead of claiming success", async () => {
      const throwing = new MockLocalStorage();
      throwing.setItem = () => { throw new Error("QuotaExceededError"); };
      installBrowserStorage(throwing);
      const summary = await importAll({ ...baseEnvelope(), preferences: null, compare: [] });
      expect(summary.compare).toBe(0);
      expect(summary.errors).toContain("compare");
    });
  });
});
