import { afterEach, describe, expect, it } from "vitest";

import {
  getLocalStorage,
  hasLocalStorage,
  readJsonStorage,
  removeStorageKey,
  writeJsonStorage,
} from "@/lib/local-state/storage";
import {
  MockLocalStorage,
  installBrowserStorage,
  uninstallBrowserStorage,
} from "./mock-storage";

interface WindowWithThrowingStorage {
  window?: { localStorage?: unknown };
}

/** Installs a `window` whose `localStorage` getter itself throws (Safari private mode). */
function installThrowingStorageAccess(): void {
  (globalThis as unknown as WindowWithThrowingStorage).window = {
    get localStorage(): unknown {
      throw new Error("The operation is insecure");
    },
  };
}

describe("storage helpers", () => {
  afterEach(uninstallBrowserStorage);

  describe("on the server (SSR)", () => {
    it("reports no storage and degrades every operation", () => {
      expect(getLocalStorage()).toBeNull();
      expect(hasLocalStorage()).toBe(false);
      expect(readJsonStorage("pulserank:v1:anything")).toBeUndefined();
      expect(writeJsonStorage("pulserank:v1:anything", { a: 1 })).toBe(false);
      expect(removeStorageKey("pulserank:v1:anything")).toBe(false);
    });
  });

  describe("in the browser (mocked localStorage)", () => {
    it("round-trips, removes, and reports availability", () => {
      const storage = installBrowserStorage();
      expect(hasLocalStorage()).toBe(true);
      expect(getLocalStorage()).not.toBeNull();

      expect(writeJsonStorage("pulserank:v1:key", { theme: "dark" })).toBe(true);
      expect(storage.getItem("pulserank:v1:key")).toBe(JSON.stringify({ theme: "dark" }));
      expect(readJsonStorage("pulserank:v1:key")).toEqual({ theme: "dark" });

      expect(removeStorageKey("pulserank:v1:key")).toBe(true);
      expect(readJsonStorage("pulserank:v1:key")).toBeUndefined();

      expect(readJsonStorage("pulserank:v1:missing")).toBeUndefined();
    });

    it("serializes primitives and preserves stored types through JSON", () => {
      const storage = installBrowserStorage();
      expect(writeJsonStorage("k-number", 42)).toBe(true);
      expect(writeJsonStorage("k-string", "hi")).toBe(true);
      expect(writeJsonStorage("k-array", [1, "two"])).toBe(true);
      expect(writeJsonStorage("k-null", null)).toBe(true);
      expect(storage.getItem("k-null")).toBe("null");
      expect(readJsonStorage("k-number")).toBe(42);
      expect(readJsonStorage("k-string")).toBe("hi");
      expect(readJsonStorage("k-array")).toEqual([1, "two"]);
      expect(readJsonStorage("k-null")).toBeNull();
    });

    it("treats corrupt payloads as missing instead of throwing", () => {
      const storage = installBrowserStorage();
      storage.seedRaw("pulserank:v1:broken", "{definitely-not-json");
      expect(readJsonStorage("pulserank:v1:broken")).toBeUndefined();
    });
  });

  describe("when storage operations throw", () => {
    it("degrades writes, reads, and removes to no-ops", () => {
      const throwing = new MockLocalStorage();
      throwing.setItem = () => {
        throw new Error("QuotaExceededError");
      };
      throwing.getItem = () => {
        throw new Error("SecurityError");
      };
      throwing.removeItem = () => {
        throw new Error("SecurityError");
      };
      installBrowserStorage(throwing);

      expect(hasLocalStorage()).toBe(true); // storage exists, it just fails
      expect(writeJsonStorage("pulserank:v1:key", 1)).toBe(false);
      expect(readJsonStorage("pulserank:v1:key")).toBeUndefined();
      expect(removeStorageKey("pulserank:v1:key")).toBe(false);
    });

    it("returns null from getLocalStorage when accessing localStorage itself throws", () => {
      installThrowingStorageAccess();
      expect(getLocalStorage()).toBeNull();
      expect(hasLocalStorage()).toBe(false);
      expect(writeJsonStorage("pulserank:v1:key", 1)).toBe(false);
    });
  });
});
