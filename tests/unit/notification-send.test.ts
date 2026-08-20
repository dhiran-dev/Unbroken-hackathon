import { describe, expect, it } from "vitest";

import {
  DAILY_EMAIL_BUDGET,
  MONTHLY_EMAIL_BUDGET,
  RETRY_DELAYS_MS,
  createNotificationOutbox,
  decideNotificationFailure,
  type NotificationDeliveryStore,
  type NotificationSendClaim,
  type ProviderSendResult,
} from "@/domain/notifications/outbox";
import type { DueSchedule } from "@/domain/notifications/due-schedules";

const OUTBOX_ID = "00000000-0000-4000-8000-000000000010";
const CLAIM: NotificationSendClaim = {
  outboxId: OUTBOX_ID,
  scheduleId: "00000000-0000-4000-8000-000000000001",
  serviceDate: "2026-08-19",
  departureAt: new Date("2026-08-19T15:00:00.000Z"),
  idempotencyKey: "commute/00000000-0000-4000-8000-000000000001/2026-08-19",
  attemptNumber: 1,
};
const NOW = new Date("2026-08-19T14:30:00.000Z");
const DUE: DueSchedule = {
  scheduleId: CLAIM.scheduleId,
  serviceDate: CLAIM.serviceDate,
  dueAt: NOW,
  departureAt: CLAIM.departureAt,
  leadMinutes: 30,
  idempotencyKey: CLAIM.idempotencyKey,
};

type DeliveryStoreOverrides = Partial<
  Pick<
    NotificationDeliveryStore,
    "prepare" | "claim" | "markSent" | "markFailure"
  >
> & {
  confirmSendReady?: NotificationDeliveryStore["confirmSendReady"];
};

function deliveryStore(
  overrides: DeliveryStoreOverrides = {},
): NotificationDeliveryStore {
  const defaults: NotificationDeliveryStore = {
    prepare: async () => ({
      status: "prepared" as const,
      outboxId: OUTBOX_ID,
    }),
    claim: async () => ({ status: "claimed" as const, claim: CLAIM }),
    confirmSendReady: async () => ({ status: "ready" as const }),
    markSent: async () => ({ status: "sent" as const }),
    markFailure: async () => ({
      status: "retry_scheduled" as const,
      nextAttemptAt: new Date("2026-08-19T14:31:00.000Z"),
    }),
  };
  return {
    ...defaults,
    ...overrides,
    confirmSendReady: overrides.confirmSendReady ?? defaults.confirmSendReady,
  };
}

function service(
  store: NotificationDeliveryStore,
  providerResult: ProviderSendResult = {
    status: "sent",
    providerMessageId: "msg-1",
  },
) {
  const calls: Array<Record<string, unknown>> = [];
  const planner = createNotificationOutbox({
    store,
    provider: {
      send: async (input) => {
        calls.push(input);
        return providerResult;
      },
    },
    recipientResolver: { resolveRecipient: async () => "rider@example.com" },
    buildMessage: async () => ({
      subject: "Commute update",
      text: "Your update is ready.",
      html: "<p>Your update is ready.</p>",
    }),
    readEmailsFlag: () => "true",
  });
  return { planner, calls };
}

describe("notification retry policy seam", () => {
  it("pauses the email circuit only for provider rate and quota failures", () => {
    for (const failure of ["rate_limited", "quota_exhausted"] as const) {
      const decision = decideNotificationFailure({
        now: NOW,
        departureAt: CLAIM.departureAt,
        attemptNumber: 1,
        failure,
      });
      expect(decision.pauseCircuit).toBe(true);
      expect(decision.status).toBe("retry_scheduled");
    }
    expect(
      decideNotificationFailure({
        now: NOW,
        departureAt: CLAIM.departureAt,
        attemptNumber: 1,
        failure: "timeout",
      }).pauseCircuit,
    ).toBe(false);
  });

  it("never schedules a retry after departure or at the attempt bound", () => {
    expect(
      decideNotificationFailure({
        now: new Date("2026-08-19T15:00:00.000Z"),
        departureAt: CLAIM.departureAt,
        attemptNumber: 1,
        failure: "timeout",
      }).status,
    ).toBe("suppressed");
    expect(
      decideNotificationFailure({
        now: NOW,
        departureAt: CLAIM.departureAt,
        attemptNumber: 3,
        failure: "timeout",
      }).status,
    ).toBe("failed");
  });

  it("keeps retry delay bounded by the departure instant", () => {
    const decision = decideNotificationFailure({
      now: NOW,
      departureAt: CLAIM.departureAt,
      attemptNumber: 1,
      failure: "timeout",
      retryDelaysMs: RETRY_DELAYS_MS,
    });
    expect(decision.nextAttemptAt).toEqual(
      new Date("2026-08-19T14:31:00.000Z"),
    );
    expect(decision.nextAttemptAt!.getTime()).toBeLessThan(
      CLAIM.departureAt.getTime(),
    );
  });
});

describe("notification send seam", () => {
  it("claims budgets, resolves the address only at send, and sends once with the permanent key", async () => {
    const store = deliveryStore();
    const { planner, calls } = service(store);
    await expect(planner.prepare(DUE)).resolves.toEqual({ status: "prepared" });
    await expect(planner.sendNotification(OUTBOX_ID, NOW)).resolves.toEqual({
      status: "sent",
      outboxId: OUTBOX_ID,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      to: "rider@example.com",
      idempotencyKey: CLAIM.idempotencyKey,
    });
  });

  it("redacts malformed provider results and records only the stable failure code", async () => {
    const failures: unknown[] = [];
    const store = deliveryStore({
      markFailure: async ({ decision }) => {
        failures.push(decision);
        return { status: "failed" as const };
      },
    });
    const { planner } = service(store, {
      status: "failed",
      reason: "provider_error",
    });
    await expect(planner.sendNotification(OUTBOX_ID, NOW)).resolves.toEqual({
      status: "failed",
      outboxId: OUTBOX_ID,
    });
    expect(failures).toEqual([
      expect.objectContaining({
        errorCode: "provider_error",
        pauseCircuit: false,
      }),
    ]);
    expect(JSON.stringify(failures)).not.toContain("private-provider-response");
  });

  it("suppresses a claim at departure without reaching the provider", async () => {
    let providerCalls = 0;
    const store = deliveryStore({
      claim: async () => ({ status: "suppressed" as const }),
    });
    const planner = createNotificationOutbox({
      store,
      provider: {
        send: async () => {
          providerCalls += 1;
          return { status: "sent", providerMessageId: "msg" };
        },
      },
      recipientResolver: { resolveRecipient: async () => "rider@example.com" },
      buildMessage: async () => ({
        subject: "Update",
        text: "Ready",
        html: "<p>Ready</p>",
      }),
      readEmailsFlag: () => "true",
    });
    await expect(
      planner.sendNotification(OUTBOX_ID, CLAIM.departureAt),
    ).resolves.toEqual({
      status: "deferred",
      outboxId: OUTBOX_ID,
      reason: "suppressed",
    });
    expect(providerCalls).toBe(0);
  });

  it("does not start an email when a slow build crosses departure", async () => {
    let buildCrossedDeparture = false;
    let providerCalls = 0;
    const store = deliveryStore({
      confirmSendReady: async () =>
        buildCrossedDeparture
          ? { status: "suppressed" as const }
          : { status: "ready" as const },
    });
    const planner = createNotificationOutbox({
      store,
      provider: {
        send: async () => {
          providerCalls += 1;
          return { status: "sent", providerMessageId: "msg" };
        },
      },
      recipientResolver: { resolveRecipient: async () => "rider@example.com" },
      buildMessage: async () => {
        buildCrossedDeparture = true;
        return {
          subject: "Commute update",
          text: "Your update is ready.",
          html: "<p>Your update is ready.</p>",
        };
      },
      readEmailsFlag: () => "true",
    });

    await expect(planner.sendNotification(OUTBOX_ID, NOW)).resolves.toEqual({
      status: "deferred",
      outboxId: OUTBOX_ID,
      reason: "suppressed",
    });
    expect(providerCalls).toBe(0);
  });

  it("rejects a stale or out-of-window retry result from the store", async () => {
    const store = deliveryStore({
      markFailure: async () => ({
        status: "retry_scheduled" as const,
        nextAttemptAt: new Date("2026-08-19T15:01:00.000Z"),
      }),
    });
    const { planner } = service(store, {
      status: "failed",
      reason: "timeout",
    });

    await expect(planner.sendNotification(OUTBOX_ID, NOW)).resolves.toEqual({
      status: "failed",
      outboxId: OUTBOX_ID,
    });
  });

  it("passes the fixed daily and monthly budget limits into the locked store claim", async () => {
    const inputs: Array<Record<string, unknown>> = [];
    const store = deliveryStore({
      claim: async (input) => {
        inputs.push(input);
        return { status: "budget_exhausted" as const };
      },
    });
    const { planner } = service(store);
    await expect(
      planner.sendNotification(OUTBOX_ID, NOW),
    ).resolves.toMatchObject({
      status: "deferred",
      reason: "budget_exhausted",
    });
    expect(inputs[0]).toMatchObject({
      dailyBudget: DAILY_EMAIL_BUDGET,
      monthlyBudget: MONTHLY_EMAIL_BUDGET,
    });
  });
});
