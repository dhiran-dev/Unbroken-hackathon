import { describe, expect, it } from "vitest";

import {
  NOTIFICATION_BATCH_LIMIT,
  NOTIFICATION_PREPARATION_SCAN_LIMIT,
  prepareDueNotifications,
  sendDueNotifications,
  type NotificationJobPlanner,
} from "@/server/notifications/jobs";
import type { SavedCommuteSchedule } from "@/domain/notifications/due-schedules";

const NOW = new Date("2026-08-19T14:30:00.000Z");

function uuid(index: number) {
  return "00000000-0000-4000-8000-" + index.toString(16).padStart(12, "0");
}

function schedules(count: number): SavedCommuteSchedule[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uuid(index + 1),
    active: true,
    weekdays: [3],
    departureTime: "08:00",
    reminderLeadMinutes: 30 as const,
  }));
}

function planner(overrides: Partial<NotificationJobPlanner> = {}) {
  const calls = { prepare: [] as string[], send: [] as string[] };
  const value: NotificationJobPlanner = {
    prepare: async (input) => {
      calls.prepare.push(input.idempotencyKey);
      return { status: "prepared" };
    },
    sendNotification: async (outboxId) => {
      calls.send.push(outboxId);
      return { status: "sent", outboxId };
    },
    ...overrides,
  };
  return { value, calls };
}

describe("notification job orchestration", () => {
  it("does not read schedules or due outboxes when the flag is not exact true", async () => {
    let sourceCalls = 0;
    let queueCalls = 0;
    const { value } = planner();
    await expect(
      prepareDueNotifications({
        source: {
          listSchedules: async () => {
            sourceCalls += 1;
            return schedules(1);
          },
        },
        dependencies: { planner: value, readEmailsFlag: () => "TRUE" },
        now: NOW,
      }),
    ).resolves.toEqual({
      status: "disabled",
      prepared: 0,
      duplicates: 0,
      invalid: 0,
    });
    await expect(
      sendDueNotifications({
        queue: {
          listDueOutboxIds: async () => {
            queueCalls += 1;
            return [uuid(1)];
          },
        },
        dependencies: { planner: value, readEmailsFlag: () => "false" },
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "disabled", attempted: 0 });
    expect(sourceCalls).toBe(0);
    expect(queueCalls).toBe(0);
  });

  it("prepares only one bounded batch and leaves later due work for the next tick", async () => {
    const { value, calls } = planner();
    const result = await prepareDueNotifications({
      source: { listSchedules: async () => schedules(100) },
      dependencies: { planner: value, readEmailsFlag: () => "true" },
      now: NOW,
    });
    expect(result).toEqual({
      status: "completed",
      prepared: NOTIFICATION_BATCH_LIMIT,
      duplicates: 0,
      invalid: 0,
    });
    expect(calls.prepare).toHaveLength(NOTIFICATION_BATCH_LIMIT);
  });

  it("does not let duplicate preparations starve later new rows", async () => {
    let prepareCalls = 0;
    const { value } = planner({
      prepare: async () => {
        prepareCalls += 1;
        return {
          status:
            prepareCalls <= NOTIFICATION_BATCH_LIMIT ? "duplicate" : "prepared",
        };
      },
    });
    const result = await prepareDueNotifications({
      source: {
        listSchedules: async () =>
          schedules(NOTIFICATION_PREPARATION_SCAN_LIMIT),
      },
      dependencies: { planner: value, readEmailsFlag: () => "true" },
      now: NOW,
    });
    expect(result).toEqual({
      status: "completed",
      prepared: NOTIFICATION_BATCH_LIMIT,
      duplicates: NOTIFICATION_BATCH_LIMIT,
      invalid: 0,
    });
    expect(prepareCalls).toBe(NOTIFICATION_PREPARATION_SCAN_LIMIT);
  });

  it("honors a planner disable result during a preparation scan", async () => {
    const { value } = planner({
      prepare: async () => ({ status: "disabled" }),
    });
    await expect(
      prepareDueNotifications({
        source: { listSchedules: async () => schedules(1) },
        dependencies: { planner: value, readEmailsFlag: () => "true" },
        now: NOW,
      }),
    ).resolves.toEqual({
      status: "disabled",
      prepared: 0,
      duplicates: 0,
      invalid: 0,
    });
  });

  it("claims and sends only one bounded batch", async () => {
    const { value, calls } = planner();
    const ids = Array.from({ length: 100 }, (_, index) => uuid(index + 1));
    const limitCalls: number[] = [];
    const result = await sendDueNotifications({
      queue: {
        listDueOutboxIds: async (_now, limit) => {
          limitCalls.push(limit);
          return ids;
        },
      },
      dependencies: { planner: value, readEmailsFlag: () => "true" },
      now: NOW,
    });
    expect(result).toEqual({
      status: "completed",
      attempted: NOTIFICATION_BATCH_LIMIT,
      sent: NOTIFICATION_BATCH_LIMIT,
      retries: 0,
      failed: 0,
      deferred: 0,
    });
    expect(limitCalls).toEqual([NOTIFICATION_BATCH_LIMIT]);
    expect(calls.send).toHaveLength(NOTIFICATION_BATCH_LIMIT);
  });

  it("stops new claims after a budget or circuit pause result", async () => {
    let sendCalls = 0;
    const { value } = planner({
      sendNotification: async (outboxId) => {
        sendCalls += 1;
        return {
          status: "deferred" as const,
          outboxId,
          reason: "circuit_paused" as const,
        };
      },
    });
    const result = await sendDueNotifications({
      queue: {
        listDueOutboxIds: async () => [uuid(1), uuid(2), uuid(3)],
      },
      dependencies: { planner: value, readEmailsFlag: () => "true" },
      now: NOW,
    });
    expect(result).toEqual({
      status: "completed",
      attempted: 1,
      sent: 0,
      retries: 0,
      failed: 0,
      deferred: 1,
    });
    expect(sendCalls).toBe(1);
  });

  it("rejects duplicate queue IDs and planner results bound to another outbox", async () => {
    const duplicate = planner();
    await expect(
      sendDueNotifications({
        queue: { listDueOutboxIds: async () => [uuid(1), uuid(1)] },
        dependencies: {
          planner: duplicate.value,
          readEmailsFlag: () => "true",
        },
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "unavailable", attempted: 0 });
    expect(duplicate.calls.send).toHaveLength(0);

    const mismatch = planner({
      sendNotification: async () => ({ status: "sent", outboxId: uuid(2) }),
    });
    await expect(
      sendDueNotifications({
        queue: { listDueOutboxIds: async () => [uuid(1)] },
        dependencies: { planner: mismatch.value, readEmailsFlag: () => "true" },
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "unavailable", attempted: 1 });
  });

  it("fails closed on an unavailable source or malformed queued ID", async () => {
    const { value } = planner();
    await expect(
      prepareDueNotifications({
        source: {
          listSchedules: async () => {
            throw new Error("private database details");
          },
        },
        dependencies: { planner: value, readEmailsFlag: () => "true" },
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "unavailable" });
    await expect(
      sendDueNotifications({
        queue: { listDueOutboxIds: async () => ["not-a-uuid"] },
        dependencies: { planner: value, readEmailsFlag: () => "true" },
        now: NOW,
      }),
    ).resolves.toMatchObject({ status: "unavailable", attempted: 0 });
  });
});
