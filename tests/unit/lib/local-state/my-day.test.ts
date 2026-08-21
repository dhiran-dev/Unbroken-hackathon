import { beforeEach, describe, expect, it } from "vitest";

import {
  createMyDayId,
  createMyDayRecord,
  groupMyDayRecords,
  isDateString,
  sanitizeMyDayEntry,
  sanitizeMyDayRecord,
  sortMyDayRecords,
} from "@/lib/local-state/my-day";
import type { MyDayRecord } from "@/lib/local-state/my-day";
import { uninstallBrowserStorage } from "./mock-storage";

function record(overrides: Partial<MyDayRecord>): MyDayRecord {
  return {
    slug: "cold-brew",
    name: "Cold Brew",
    timeLabel: "08:00",
    caffeineMg: 150,
    id: "id-1",
    date: "2026-08-21",
    createdAt: 1,
    ...overrides,
  };
}

describe("my-day", () => {
  describe("SSR safety (no window, no indexedDB)", () => {
    beforeEach(() => {
      uninstallBrowserStorage();
      delete (globalThis as { indexedDB?: unknown }).indexedDB;
    });

    it("resolves reads to empty results", async () => {
      const mod = await import("@/lib/local-state/my-day");
      await expect(mod.listMyDayRecords()).resolves.toEqual([]);
      await expect(mod.listMyDayRecordsForDate("2026-08-21")).resolves.toEqual([]);
      await expect(mod.listMyDayEntries("2026-08-21")).resolves.toEqual([]);
      await expect(mod.listMyDayDates()).resolves.toEqual([]);
      await expect(mod.listMyDayGrouped()).resolves.toEqual({});
    });

    it("resolves writes to no-ops but still validates input", async () => {
      const mod = await import("@/lib/local-state/my-day");
      const entry = { slug: "espresso", name: "Espresso", timeLabel: "07:30", caffeineMg: 75 };
      await expect(mod.addMyDayEntry("2026-08-21", entry)).resolves.toBeNull();
      await expect(mod.removeMyDayEntry("missing")).resolves.toBe(false);
      await expect(mod.clearMyDay()).resolves.toBeUndefined();
      await expect(mod.clearMyDay("2026-08-21")).resolves.toBeUndefined();
      await expect(mod.addMyDayEntry("not-a-date", entry)).rejects.toThrow(TypeError);
      await expect(mod.listMyDayRecordsForDate("2026-02-31")).rejects.toThrow(TypeError);
    });
  });

  describe("isDateString (pure)", () => {
    it("accepts real YYYY-MM-DD dates", () => {
      expect(isDateString("2026-08-21")).toBe(true);
      expect(isDateString("2024-02-29")).toBe(true);
    });

    it("rejects malformed or impossible dates", () => {
      expect(isDateString("2026-02-31")).toBe(false);
      expect(isDateString("2026-13-01")).toBe(false);
      expect(isDateString("20260821")).toBe(false);
      expect(isDateString("21-08-2026")).toBe(false);
      expect(isDateString("2026-8-1")).toBe(false);
      expect(isDateString("")).toBe(false);
      expect(isDateString(20260821)).toBe(false);
    });
  });

  describe("createMyDayRecord (pure)", () => {
    const entry = { slug: "espresso", name: "Espresso", timeLabel: "07:30", caffeineMg: 75 };

    it("builds an id-stamped record", () => {
      const built = createMyDayRecord("2026-08-21", entry, 42);
      expect(built).toMatchObject({ ...entry, date: "2026-08-21", createdAt: 42 });
      expect(built.id.length).toBeGreaterThan(0);
    });

    it("throws TypeError on invalid date or entry", () => {
      expect(() => createMyDayRecord("08/21/2026", entry)).toThrow(TypeError);
      expect(() => createMyDayRecord("2026-08-21", { ...entry, caffeineMg: -1 })).toThrow(
        TypeError,
      );
      expect(() =>
        createMyDayRecord("2026-08-21", { ...entry, name: "" }),
      ).toThrow(TypeError);
    });

    it("generates distinct ids", () => {
      const seen = new Set([createMyDayId(), createMyDayId(), createMyDayId()]);
      expect(seen.size).toBe(3);
    });
  });

  describe("grouping and ordering (pure)", () => {
    it("groups by date with sorted keys and in-day order", () => {
      const records = [
        record({ timeLabel: "09:30", date: "2026-08-20", createdAt: 5 }),
        record({ timeLabel: "08:00", date: "2026-08-21", createdAt: 2 }),
        record({ timeLabel: "07:00", date: "2026-08-21", createdAt: 9 }),
        record({ timeLabel: "08:00", date: "2026-08-21", createdAt: 1 }),
        record({ timeLabel: "06:00", date: "2026-08-19", createdAt: 3 }),
      ];
      const grouped = groupMyDayRecords(records);
      expect(Object.keys(grouped)).toEqual(["2026-08-19", "2026-08-20", "2026-08-21"]);
      expect(grouped["2026-08-21"]).toEqual([
        { slug: "cold-brew", name: "Cold Brew", timeLabel: "07:00", caffeineMg: 150 },
        { slug: "cold-brew", name: "Cold Brew", timeLabel: "08:00", caffeineMg: 150 },
        { slug: "cold-brew", name: "Cold Brew", timeLabel: "08:00", caffeineMg: 150 },
      ]);
      // Entries are stripped to MyDayEntry (no id/date/createdAt leakage).
      expect(Object.keys(grouped["2026-08-19"]?.[0] ?? {})).toEqual([
        "slug",
        "name",
        "timeLabel",
        "caffeineMg",
      ]);
    });

    it("sorts without mutating the input", () => {
      const records = [
        record({ timeLabel: "10:00", id: "a" }),
        record({ timeLabel: "06:00", id: "b" }),
      ];
      const sorted = sortMyDayRecords(records);
      expect(sorted.map((item) => item.id)).toEqual(["b", "a"]);
      expect(records.map((item) => item.id)).toEqual(["a", "b"]);
    });
  });

  describe("sanitizers (pure)", () => {
    it("sanitizes entries", () => {
      expect(sanitizeMyDayEntry(record({}))).toEqual({
        slug: "cold-brew",
        name: "Cold Brew",
        timeLabel: "08:00",
        caffeineMg: 150,
      });
      expect(sanitizeMyDayEntry({ ...record({}), caffeineMg: -1 })).toBeNull();
      expect(sanitizeMyDayEntry({ ...record({}), caffeineMg: "150" })).toBeNull();
      expect(sanitizeMyDayEntry({ ...record({}), slug: "" })).toBeNull();
      expect(sanitizeMyDayEntry(null)).toBeNull();
    });

    it("sanitizes stored records", () => {
      expect(sanitizeMyDayRecord(record({}))?.id).toBe("id-1");
      expect(sanitizeMyDayRecord(record({ date: "not-a-date" }))).toBeNull();
      expect(sanitizeMyDayRecord(record({ id: "" }))).toBeNull();
      const noCreatedAt = sanitizeMyDayRecord({
        slug: "s",
        name: "n",
        timeLabel: "t",
        caffeineMg: 0,
        id: "x",
        date: "2026-08-21",
      });
      expect(typeof noCreatedAt?.createdAt).toBe("number");
    });
  });
});
