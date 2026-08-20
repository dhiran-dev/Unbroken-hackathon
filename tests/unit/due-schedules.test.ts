import { describe, expect, it } from "vitest";

import {
  findDueSchedules,
  type SavedCommuteSchedule,
} from "@/domain/notifications/due-schedules";

const weekday = (day: SavedCommuteSchedule["weekdays"][number]) => [day];

function schedule(
  overrides: Partial<SavedCommuteSchedule> = {},
): SavedCommuteSchedule {
  return {
    id: "schedule-1",
    active: true,
    weekdays: weekday(3),
    departureTime: "08:00",
    reminderLeadMinutes: 30,
    ...overrides,
  };
}

function dueAt(
  schedules: readonly SavedCommuteSchedule[],
  now: string,
  preparedTokens: readonly string[] = [],
) {
  return findDueSchedules({
    schedules,
    now: new Date(now),
    preparedTokens: new Set(preparedTokens),
  });
}

describe("findDueSchedules", () => {
  it("finds an active Wednesday schedule at its 30-minute Pacific lead time", () => {
    const due = dueAt(
      [schedule()],
      "2026-08-19T14:30:00.000Z", // 07:30 PDT
    );

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      scheduleId: "schedule-1",
      serviceDate: "2026-08-19",
      idempotencyKey: "commute/schedule-1/2026-08-19",
      dueAt: new Date("2026-08-19T14:30:00.000Z"),
      departureAt: new Date("2026-08-19T15:00:00.000Z"),
      leadMinutes: 30,
    });
    expect(Object.keys(due[0] ?? {})).not.toContain("email");
  });

  it("requires the selected Pacific weekday and skips a paused schedule", () => {
    const schedules = [
      schedule({ id: "active", weekdays: weekday(3) }),
      schedule({ id: "paused", active: false, weekdays: weekday(3) }),
    ];

    expect(
      dueAt(schedules, "2026-08-20T14:30:00.000Z"), // Thursday
    ).toEqual([]);
    expect(
      dueAt(schedules, "2026-08-19T14:30:00.000Z").map(
        (candidate) => candidate.scheduleId,
      ),
    ).toEqual(["active"]);
  });

  it.each([
    [15, "2026-08-19T14:45:00.000Z"],
    [30, "2026-08-19T14:30:00.000Z"],
    [45, "2026-08-19T14:15:00.000Z"],
    [60, "2026-08-19T14:00:00.000Z"],
  ] as const)(
    "supports the approved %d-minute lead",
    (leadMinutes, expectedDueAt) => {
      const due = dueAt(
        [schedule({ reminderLeadMinutes: leadMinutes })],
        expectedDueAt,
      );

      expect(due).toHaveLength(1);
      expect(due[0]?.leadMinutes).toBe(leadMinutes);
      expect(due[0]?.dueAt).toEqual(new Date(expectedDueAt));
    },
  );

  it("supports a due time on the prior Pacific calendar date", () => {
    const due = dueAt(
      [
        schedule({
          departureTime: "00:10",
          reminderLeadMinutes: 60,
          weekdays: weekday(4),
        }),
      ],
      "2026-08-20T06:40:00.000Z", // 23:40 PDT on Wednesday
    );

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      serviceDate: "2026-08-20",
      dueAt: new Date("2026-08-20T06:10:00.000Z"),
      departureAt: new Date("2026-08-20T07:10:00.000Z"),
    });
  });

  it("does not return a schedule before its lead window or after departure", () => {
    const schedules = [schedule()];

    expect(dueAt(schedules, "2026-08-19T14:29:59.999Z")).toEqual([]);
    expect(dueAt(schedules, "2026-08-19T15:00:00.000Z")).toEqual([]);
    expect(dueAt(schedules, "2026-08-19T15:15:00.000Z")).toEqual([]);
  });

  it("does not repeat a schedule/date token after a worker restart", () => {
    const first = dueAt([schedule()], "2026-08-19T14:45:00.000Z");
    const restarted = dueAt(
      [schedule()],
      "2026-08-19T14:55:00.000Z",
      first.map((candidate) => candidate.idempotencyKey),
    );

    expect(first).toHaveLength(1);
    expect(restarted).toEqual([]);
  });

  it("fails closed for unsafe persisted IDs and non-safe-integer weekdays", () => {
    const invalidSchedules = [
      schedule({ id: " schedule-1" }),
      schedule({ id: "schedule-1 " }),
      schedule({ id: "schedule/1" }),
      schedule({ id: "schedule\u00001" }),
      schedule({ id: "s".repeat(192) }),
      schedule({
        weekdays: [1.5 as SavedCommuteSchedule["weekdays"][number]],
      }),
      schedule({
        weekdays: [Number.NaN as SavedCommuteSchedule["weekdays"][number]],
      }),
    ];

    for (const invalidSchedule of invalidSchedules) {
      expect(dueAt([invalidSchedule], "2026-08-19T14:30:00.000Z")).toEqual([]);
    }
  });

  it("resolves a nonexistent spring-forward departure using the next valid Pacific instant", () => {
    const due = dueAt(
      [
        schedule({
          departureTime: "02:30",
          weekdays: weekday(7),
          reminderLeadMinutes: 30,
        }),
      ],
      "2026-03-08T10:00:00.000Z", // 03:00 PDT, after the skipped hour
    );

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      serviceDate: "2026-03-08",
      dueAt: new Date("2026-03-08T10:00:00.000Z"),
      departureAt: new Date("2026-03-08T10:30:00.000Z"), // 03:30 PDT
    });
  });

  it("chooses the first occurrence of an ambiguous fall-back departure", () => {
    const due = dueAt(
      [
        schedule({
          departureTime: "01:30",
          weekdays: weekday(7),
          reminderLeadMinutes: 30,
        }),
      ],
      "2026-11-01T08:00:00.000Z", // 01:00 PDT, first 01:30 is due
    );

    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      serviceDate: "2026-11-01",
      dueAt: new Date("2026-11-01T08:00:00.000Z"),
      departureAt: new Date("2026-11-01T08:30:00.000Z"), // 01:30 PDT
    });
    expect(
      dueAt(
        [
          schedule({
            departureTime: "01:30",
            weekdays: weekday(7),
            reminderLeadMinutes: 30,
          }),
        ],
        "2026-11-01T09:00:00.000Z", // second 01:00, first occurrence missed
      ),
    ).toEqual([]);
  });

  it("returns candidates in stable due-time and schedule order", () => {
    const due = dueAt(
      [
        schedule({ id: "later", reminderLeadMinutes: 15 }),
        schedule({ id: "earlier", reminderLeadMinutes: 60 }),
      ],
      "2026-08-19T14:50:00.000Z",
    );

    expect(due.map((candidate) => candidate.scheduleId)).toEqual([
      "earlier",
      "later",
    ]);
  });
});
