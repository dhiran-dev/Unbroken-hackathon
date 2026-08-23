import { describe, expect, it } from "vitest";

import type { MyDayRecord } from "@/lib/local-state/my-day";
import {
  buildDayTimeline,
  localStoreCountText,
  nextMyDayRecord,
  parseTimeLabel,
  sumMyDayCaffeine,
  storageBadgeText,
} from "@/components/pulserank/my-pulse/my-pulse-model";

function record(overrides: Partial<MyDayRecord> = {}): MyDayRecord {
  return {
    id: "entry-1",
    date: "2026-08-23",
    slug: "sample",
    name: "Sample drink",
    timeLabel: "08:30",
    caffeineMg: 80,
    createdAt: 1,
    ...overrides,
  };
}

describe("My Pulse day model", () => {
  it("parses supported time labels and leaves unknown labels unplottable", () => {
    expect(parseTimeLabel("08:30")).toBe(510);
    expect(parseTimeLabel("8:30 PM")).toBe(1_230);
    expect(parseTimeLabel("12 AM")).toBe(0);
    expect(parseTimeLabel("25:00")).toBeNull();
    expect(parseTimeLabel("whenever")).toBeNull();
  });

  it("sums only stored entries", () => {
    expect(sumMyDayCaffeine([record(), record({ id: "entry-2", caffeineMg: 0 })])).toBe(80);
  });

  it("builds cumulative points in time order without inventing unknown positions", () => {
    const result = buildDayTimeline([
      record({ id: "entry-2", timeLabel: "18:00", caffeineMg: 60, createdAt: 2 }),
      record({ id: "entry-1", timeLabel: "08:30", caffeineMg: 80, createdAt: 1 }),
      record({ id: "entry-3", timeLabel: "later", caffeineMg: 40, createdAt: 3 }),
    ]);
    expect(result.maxMg).toBe(140);
    expect(result.points.map((point) => [point.minute, point.totalMg])).toEqual([
      [0, 0],
      [510, 80],
      [1_080, 140],
    ]);
    expect(result.latest?.id).toBe("entry-2");
  });

  it("returns the next future entry by parsed time", () => {
    const afternoon = record({ id: "entry-2", timeLabel: "14:00" });
    expect(nextMyDayRecord([afternoon, record()], 600)?.id).toBe("entry-2");
    expect(nextMyDayRecord([afternoon, record()], 1_000)).toBeNull();
  });

  it("never formats unavailable or failed local reads as zero counts", () => {
    expect(localStoreCountText(0, "available", false, "saved locally")).toBe("0 saved locally");
    expect(localStoreCountText(0, "unavailable", false, "saved locally")).toBe("Unavailable");
    expect(localStoreCountText(0, "error", false, "of 4 local slots used")).toBe("Error");
    expect(localStoreCountText(0, "available", true, "recent locally")).toBe("Error");
  });

  it("only claims local persistence when both browser stores are healthy", () => {
    expect(storageBadgeText("available", "available")).toBe("Stored locally");
    expect(storageBadgeText("unavailable", "available")).toBe("Storage unavailable");
    expect(storageBadgeText("available", "unavailable")).toBe("Storage unavailable");
    expect(storageBadgeText("error", "available")).toBe("Storage error");
    expect(storageBadgeText("available", "error")).toBe("Storage error");
  });
});
