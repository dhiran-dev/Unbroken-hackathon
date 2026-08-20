import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDER_MINUTES,
  validateCommuteDraft,
} from "@/domain/commute/schedule";

const valid = {
  originPlaceId: "stop:origin",
  destinationPlaceId: "landmark:ferry-building",
  days: ["monday", "wednesday", "friday"],
  departureTime: "08:30",
  reminderMinutes: 30,
  paused: false,
} as const;

describe("saved commute schedule contract", () => {
  it("accepts a catalog-only Pacific schedule and normalizes its day order", () => {
    expect(
      validateCommuteDraft({
        ...valid,
        days: ["friday", "monday", "wednesday"],
      }),
    ).toEqual({
      ok: true,
      value: {
        ...valid,
        days: ["monday", "wednesday", "friday"],
        timezone: "America/Los_Angeles",
      },
    });
  });

  it("defaults the reminder to 30 minutes and keeps a schedule active", () => {
    expect(DEFAULT_REMINDER_MINUTES).toBe(30);
    expect(
      validateCommuteDraft({
        originPlaceId: valid.originPlaceId,
        destinationPlaceId: valid.destinationPlaceId,
        days: ["tuesday"],
        departureTime: "17:05",
      }),
    ).toEqual({
      ok: true,
      value: {
        originPlaceId: valid.originPlaceId,
        destinationPlaceId: valid.destinationPlaceId,
        days: ["tuesday"],
        departureTime: "17:05",
        reminderMinutes: 30,
        paused: false,
        timezone: "America/Los_Angeles",
      },
    });
  });

  it.each([
    ["a current location origin", { originPlaceId: "current_location" }],
    [
      "a current location object",
      { originPlaceId: { type: "current_location" } },
    ],
    ["a malformed place reference", { originPlaceId: "stop:bad place" }],
    ["the same endpoint", { destinationPlaceId: valid.originPlaceId }],
    ["an empty day list", { days: [] }],
    ["a duplicate day", { days: ["monday", "monday"] }],
    ["an unknown day", { days: ["weekday"] }],
    ["a non-canonical time", { departureTime: "8:30" }],
    ["a nonexistent time", { departureTime: "24:00" }],
    ["an unsupported reminder", { reminderMinutes: 10 }],
    ["a non-boolean pause", { paused: "yes" }],
  ] as const)(
    "rejects %s without a partial normalized value",
    (_name, change) => {
      const result = validateCommuteDraft({ ...valid, ...change } as never);
      expect(result).toEqual({ ok: false, code: "COMMUTE_INVALID" });
    },
  );

  it("rejects extra fields so invalid updates cannot be partly applied", () => {
    expect(
      validateCommuteDraft({ ...valid, unexpected: "private" } as never),
    ).toEqual({ ok: false, code: "COMMUTE_INVALID" });
  });
});
