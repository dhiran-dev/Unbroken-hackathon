import { beforeEach, describe, expect, it } from "vitest";

import { PREFERENCES_STORAGE_KEY } from "@/lib/local-state/keys";
import {
  DEFAULT_PREFERENCES,
  clearPreferences,
  loadPreferences,
  parsePreferences,
  sanitizePreferences,
  savePreferences,
  updatePreferences,
} from "@/lib/local-state/preferences";
import {
  installBrowserStorage,
  uninstallBrowserStorage,
} from "./mock-storage";

describe("preferences", () => {
  describe("on the server (SSR)", () => {
    beforeEach(uninstallBrowserStorage);

    it("loads the defaults without touching storage", () => {
      expect(loadPreferences()).toEqual({ theme: "system" });
      expect(DEFAULT_PREFERENCES).toEqual({ theme: "system" });
    });

    it("no-ops saves and updates", () => {
      expect(savePreferences({ theme: "dark" })).toBe(false);
      expect(updatePreferences({ theme: "light" })).toBeNull();
      expect(clearPreferences()).toBe(false);
    });

    it("parses corrupt JSON back to defaults", () => {
      expect(parsePreferences("{not json")).toEqual({ theme: "system" });
    });
  });

  describe("in the browser (mocked localStorage)", () => {
    let storage: ReturnType<typeof installBrowserStorage>;

    beforeEach(() => {
      storage = installBrowserStorage();
    });

    it("round-trips preferences through localStorage", () => {
      expect(savePreferences({ theme: "dark", defaultCategory: "coffee" })).toBe(true);
      expect(storage.getItem(PREFERENCES_STORAGE_KEY)).toBe(
        JSON.stringify({ theme: "dark", defaultCategory: "coffee" }),
      );
      expect(loadPreferences()).toEqual({ theme: "dark", defaultCategory: "coffee" });
    });

    it("returns defaults when nothing is stored", () => {
      expect(loadPreferences()).toEqual({ theme: "system" });
    });

    it("falls back to defaults on corrupt payloads instead of throwing", () => {
      storage.seedRaw(PREFERENCES_STORAGE_KEY, "{{{corrupt");
      expect(loadPreferences()).toEqual({ theme: "system" });
    });

    it("drops mistyped and unknown fields, keeps valid ones", () => {
      storage.seedRaw(
        PREFERENCES_STORAGE_KEY,
        JSON.stringify({
          theme: "neon",
          reducedMotionOverride: "on",
          defaultCategory: "",
          extraField: true,
        }),
      );
      expect(loadPreferences()).toEqual({
        theme: "system",
        reducedMotionOverride: "on",
      });
    });

    it("rejects non-object payloads", () => {
      expect(parsePreferences(JSON.stringify(["dark"]))).toEqual({ theme: "system" });
      expect(parsePreferences(JSON.stringify("dark"))).toEqual({ theme: "system" });
      expect(parsePreferences(JSON.stringify(null))).toEqual({ theme: "system" });
    });

    it("merges patches onto stored preferences", () => {
      savePreferences({ theme: "dark", reducedMotionOverride: "off" });
      const merged = updatePreferences({ reducedMotionOverride: "auto" });
      expect(merged).toEqual({ theme: "dark", reducedMotionOverride: "auto" });
      expect(loadPreferences()).toEqual({ theme: "dark", reducedMotionOverride: "auto" });
    });

    it("clears stored preferences", () => {
      savePreferences({ theme: "light" });
      expect(clearPreferences()).toBe(true);
      expect(storage.getItem(PREFERENCES_STORAGE_KEY)).toBeNull();
      expect(loadPreferences()).toEqual({ theme: "system" });
    });
  });

  describe("sanitizePreferences (pure)", () => {
    it("accepts every documented value", () => {
      expect(sanitizePreferences({ theme: "light", reducedMotionOverride: "off", defaultCategory: "tea" }))
        .toEqual({ theme: "light", reducedMotionOverride: "off", defaultCategory: "tea" });
      expect(sanitizePreferences(undefined)).toEqual({ theme: "system" });
      expect(sanitizePreferences(42)).toEqual({ theme: "system" });
    });
  });
});
