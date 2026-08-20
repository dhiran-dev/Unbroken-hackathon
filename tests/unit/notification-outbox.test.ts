import { describe, expect, it } from "vitest";

import {
  createNotificationOutbox,
  type NotificationOutboxStore,
} from "@/domain/notifications/outbox";

const dueItem = {
  scheduleId: "00000000-0000-4000-8000-000000000001",
  serviceDate: "2026-08-19",
  dueAt: new Date("2026-08-19T14:30:00.000Z"),
  departureAt: new Date("2026-08-19T15:00:00.000Z"),
  leadMinutes: 30 as const,
  idempotencyKey: "commute/00000000-0000-4000-8000-000000000001/2026-08-19",
};

const OUTBOX_ID = "00000000-0000-4000-8000-000000000010";

function store(overrides: Partial<NotificationOutboxStore> = {}) {
  return {
    prepare: async () => ({ status: "prepared" as const, outboxId: OUTBOX_ID }),
    ...overrides,
  } satisfies NotificationOutboxStore;
}

describe("notification outbox prepare seam", () => {
  it("requires the exact true commute-email flag before touching storage", async () => {
    let calls = 0;
    const outbox = createNotificationOutbox({
      store: store({
        prepare: async () => {
          calls += 1;
          return { status: "prepared" as const, outboxId: OUTBOX_ID };
        },
      }),
      provider: undefined,
      readEmailsFlag: () => "false",
    });

    await expect(outbox.prepare(dueItem)).resolves.toEqual({
      status: "disabled",
    });
    expect(calls).toBe(0);
  });

  it("prepares a due item through the store and returns duplicate unchanged", async () => {
    const statuses: Array<"prepared" | "duplicate"> = ["prepared", "duplicate"];
    const outbox = createNotificationOutbox({
      store: store({
        prepare: async () => ({
          status: statuses.shift()!,
          outboxId: OUTBOX_ID,
        }),
      }),
      provider: undefined,
      readEmailsFlag: () => "true",
    });

    await expect(outbox.prepare(dueItem)).resolves.toEqual({
      status: "prepared",
    });
    await expect(outbox.prepare(dueItem)).resolves.toEqual({
      status: "duplicate",
    });
  });

  it("rejects non-canonical UUIDs before storage", async () => {
    let calls = 0;
    const outbox = createNotificationOutbox({
      store: store({
        prepare: async () => {
          calls += 1;
          return { status: "prepared" as const, outboxId: OUTBOX_ID };
        },
      }),
      provider: undefined,
      readEmailsFlag: () => "true",
    });

    await expect(
      outbox.prepare({ ...dueItem, scheduleId: "schedule-1" }),
    ).resolves.toEqual({ status: "invalid" });
    expect(calls).toBe(0);
  });

  it("requires an approved lead and the due instant derived from departure", async () => {
    const outbox = createNotificationOutbox({
      store: store(),
      provider: undefined,
      readEmailsFlag: () => "true",
    });

    await expect(
      outbox.prepare({ ...dueItem, leadMinutes: 10 as never }),
    ).resolves.toEqual({ status: "invalid" });
    await expect(
      outbox.prepare({
        ...dueItem,
        dueAt: new Date("2026-08-19T14:29:00.000Z"),
      }),
    ).resolves.toEqual({ status: "invalid" });
  });

  it("fails closed for thrown or malformed store results", async () => {
    const thrown = createNotificationOutbox({
      store: store({
        prepare: async () => {
          throw new Error("private database detail");
        },
      }),
      provider: undefined,
      readEmailsFlag: () => "true",
    });
    await expect(thrown.prepare(dueItem)).resolves.toEqual({
      status: "unavailable",
    });

    const malformed = createNotificationOutbox({
      store: store({
        prepare: async () =>
          ({ status: "prepared", outboxId: "not-a-uuid" }) as never,
      }),
      provider: undefined,
      readEmailsFlag: () => "true",
    });
    await expect(malformed.prepare(dueItem)).resolves.toEqual({
      status: "unavailable",
    });
  });
});
