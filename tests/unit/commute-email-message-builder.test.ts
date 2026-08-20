import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { sha256Json } from "@/domain/collection/identity";
import type { SavedCommute } from "@/domain/commute/service";
import { normalizeJourneyPlan } from "@/domain/journey/citywide-journey-form";
import type { JourneyPlan, JourneyPlanner } from "@/domain/journey/journey";
import {
  createCommuteEmailMessageBuilder,
  PostgresCommuteEmailMessageContextStore,
  type CommuteEmailOutboxContext,
  type CommuteEmailMessageBuilderDependencies,
} from "@/server/commutes/email-message-builder";

const OUTBOX_ID = "00000000-0000-4000-8000-000000000010";
const SCHEDULE_ID = "00000000-0000-4000-8000-000000000001";
const DEPARTURE = "2026-08-20T15:30:00.000Z";
const UPDATED_AT = "2026-08-19T12:00:00.000Z";

const schedule: SavedCommute = {
  id: SCHEDULE_ID,
  slot: "first",
  originPlaceId: "stop:origin",
  destinationPlaceId: "landmark:ferry-building",
  days: ["thursday"],
  departureTime: "08:30",
  timezone: "America/Los_Angeles",
  reminderMinutes: 30,
  paused: false,
  createdAt: "2026-08-19T11:00:00.000Z",
  updatedAt: UPDATED_AT,
};

const plan: JourneyPlan = {
  status: "confirmed",
  title: "Step-free details confirmed",
  summary: "A step-free journey is available.",
  departureAt: DEPARTURE,
  arrivalAt: "2026-08-20T16:00:00.000Z",
  durationMinutes: 30,
  legs: [],
  warnings: [],
  changes: [],
  sources: [],
  map: {
    bounds: { west: -122.42, south: 37.75, east: -122.39, north: 37.8 },
    origin: { type: "Point", coordinates: [-122.42, 37.75] },
    destination: { type: "Point", coordinates: [-122.39, 37.8] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
};

const origin = {
  id: "stop:origin",
  type: "stop" as const,
  name: "24th Street Mission",
  description: "Origin stop",
  latitude: 37.75,
  longitude: -122.42,
  stopIds: ["origin"],
  routeNames: ["J Church"],
};
const destination = {
  id: "landmark:ferry-building",
  type: "landmark" as const,
  name: "Ferry Building",
  description: "Destination landmark",
  latitude: 37.8,
  longitude: -122.39,
  stopIds: [],
  routeNames: [],
};

function context(
  overrides: Partial<CommuteEmailOutboxContext> = {},
): CommuteEmailOutboxContext {
  return {
    outboxId: OUTBOX_ID,
    scheduleId: SCHEDULE_ID,
    serviceDate: "2026-08-20",
    departureAt: new Date(DEPARTURE),
    outboxStatus: "sending",
    schedule,
    previousSnapshot: null,
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<CommuteEmailMessageBuilderDependencies> = {},
) {
  return {
    context: {
      read: vi.fn(async () => context()),
      persistCurrentSnapshot: vi.fn(async () => undefined),
    },
    catalog: {
      getPlace: vi.fn(async ({ placeId }: { placeId: string }) => {
        if (placeId === origin.id) return origin;
        if (placeId === destination.id) return destination;
        return null;
      }),
    },
    planner: { plan: vi.fn(async () => plan) } satisfies JourneyPlanner,
    renderEmail: vi.fn(() => ({
      subject: "Your 8:30 AM trip is unchanged",
      html: "<html>safe</html>",
      text: "Your trip is unchanged.",
    })),
    clock: () => new Date("2026-08-20T14:00:00.000Z"),
    appOrigin: "https://unbroken.test",
    ...overrides,
  } satisfies CommuteEmailMessageBuilderDependencies;
}

describe("authenticated outbox email message builder", () => {
  it("loads exact context, refreshes catalog-bound journey, compares prior snapshot, and persists safe current snapshot", async () => {
    const deps = dependencies();
    const previousPlan = { ...plan, durationMinutes: 25 };
    deps.context.read = vi.fn(async () =>
      context({
        previousSnapshot: {
          plan: previousPlan,
          fingerprint: { hash: "private" },
        } as never,
      }),
    );
    const builder = createCommuteEmailMessageBuilder(deps);

    await expect(builder(OUTBOX_ID)).resolves.toEqual({
      subject: "Your 8:30 AM trip is unchanged",
      html: "<html>safe</html>",
      text: "Your trip is unchanged.",
    });

    expect(deps.context.read).toHaveBeenCalledWith(OUTBOX_ID);
    expect(deps.catalog.getPlace).toHaveBeenNthCalledWith(1, {
      placeId: "stop:origin",
    });
    expect(deps.catalog.getPlace).toHaveBeenNthCalledWith(2, {
      placeId: "landmark:ferry-building",
    });
    expect(deps.planner.plan).toHaveBeenCalledWith({
      origin: { type: "catalog", placeId: "stop:origin" },
      destination: { type: "catalog", placeId: "landmark:ferry-building" },
      departureAt: DEPARTURE,
    });
    expect(deps.renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        plan,
        manageUrl: "https://unbroken.test/rider/trips",
        appOrigin: "https://unbroken.test",
      }),
    );
    const persisted = (
      deps.context.persistCurrentSnapshot as unknown as {
        mock: { calls: unknown[][] };
      }
    ).mock.calls[0]![0] as Record<string, unknown>;
    expect(persisted).toEqual(
      expect.objectContaining({
        outboxId: OUTBOX_ID,
        scheduleId: SCHEDULE_ID,
        serviceDate: "2026-08-20",
        plan,
        expectedScheduleUpdatedAt: UPDATED_AT,
        expectedDepartureAt: DEPARTURE,
        capturedAt: new Date("2026-08-20T14:00:00.000Z"),
      }),
    );
    expect(persisted.planHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(
      JSON.stringify(
        (deps.renderEmail as unknown as { mock: { calls: unknown[][] } }).mock
          .calls[0]![0],
      ),
    ).not.toMatch(/fingerprint|provider|outbox|recipient|email/iu);
  });

  it("fails closed for a wrong outbox ID, mismatched context, failed status, paused schedule, or inconsistent departure", async () => {
    const cases: Array<
      [string, Partial<CommuteEmailOutboxContext> | null, string]
    > = [
      [
        "mismatched context ID",
        { outboxId: "00000000-0000-4000-8000-000000000011" },
        "COMMUTE_MESSAGE_CONTEXT_INVALID",
      ],
      [
        "failed status",
        { outboxStatus: "failed" as never },
        "COMMUTE_MESSAGE_CONTEXT_INVALID",
      ],
      [
        "paused schedule",
        { schedule: { ...schedule, paused: true } },
        "COMMUTE_MESSAGE_CONTEXT_INVALID",
      ],
      [
        "inconsistent departure",
        { departureAt: new Date("2026-08-20T16:30:00.000Z") },
        "COMMUTE_MESSAGE_CONTEXT_INVALID",
      ],
    ];

    for (const [, override, error] of cases) {
      const deps = dependencies({
        context: {
          read: vi.fn(async () =>
            override === null ? null : context(override),
          ),
          persistCurrentSnapshot: vi.fn(async () => undefined),
        },
      });
      const builder = createCommuteEmailMessageBuilder(deps);
      await expect(builder(OUTBOX_ID)).rejects.toThrow(error);
      expect(deps.planner.plan).not.toHaveBeenCalled();
    }

    const deps = dependencies();
    const builder = createCommuteEmailMessageBuilder(deps);
    await expect(builder("not-an-outbox-id")).rejects.toThrow(
      "COMMUTE_MESSAGE_OUTBOX_INVALID",
    );
    expect(deps.context.read).not.toHaveBeenCalled();
  });

  it("does not return a message when the schedule revision changes during planning", async () => {
    const deps = dependencies({
      context: {
        read: vi.fn(async () => context()),
        persistCurrentSnapshot: vi.fn(async () => {
          throw new Error("COMMUTE_MESSAGE_CONTEXT_STALE");
        }),
      },
    });
    const builder = createCommuteEmailMessageBuilder(deps);

    await expect(builder(OUTBOX_ID)).rejects.toThrow(
      "COMMUTE_MESSAGE_CONTEXT_STALE",
    );
    expect(deps.renderEmail).toHaveBeenCalledTimes(1);
    expect(deps.context.persistCurrentSnapshot).toHaveBeenCalledTimes(1);
  });

  it("rejects non-origin app URLs before rendering links", async () => {
    for (const appOrigin of [
      "javascript:alert(1)",
      "http://unbroken.test",
      "https://unbroken.test/rider/trips",
      "https://user:pass@unbroken.test",
      "https://unbroken.test/?private=1",
      "https://unbroken.test/#private",
    ]) {
      const deps = dependencies({ appOrigin });
      const builder = createCommuteEmailMessageBuilder(deps);
      await expect(builder(OUTBOX_ID)).rejects.toThrow(
        "COMMUTE_MESSAGE_ORIGIN_INVALID",
      );
      expect(deps.context.read).not.toHaveBeenCalled();
    }
  });

  it("rejects a plan hash that does not match the normalized plan before opening a transaction", async () => {
    const transaction = vi.fn();
    const store = new PostgresCommuteEmailMessageContextStore({
      transaction,
    } as never);

    await expect(
      store.persistCurrentSnapshot({
        outboxId: OUTBOX_ID,
        scheduleId: SCHEDULE_ID,
        serviceDate: "2026-08-20",
        plan: plan as never,
        planHash: "a".repeat(64),
        expectedScheduleUpdatedAt: UPDATED_AT,
        expectedDepartureAt: DEPARTURE,
        capturedAt: new Date("2026-08-20T14:00:00.000Z"),
      }),
    ).rejects.toThrow("COMMUTE_MESSAGE_SNAPSHOT_INVALID");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("stores only the normalized plan projection", async () => {
    const normalizedPlan = normalizeJourneyPlan(plan);
    if (!normalizedPlan) throw new Error("test plan is invalid");
    const privatePlan = {
      ...normalizedPlan,
      privateSecret: "must-not-cross-the-seam",
    };
    const responses: unknown[][] = [
      [
        {
          scheduleId: SCHEDULE_ID,
          serviceDate: "2026-08-20",
          departureAt: new Date(DEPARTURE),
          outboxStatus: "sending",
          scheduleUpdatedAt: new Date(UPDATED_AT),
          paused: false,
        },
      ],
      [{ id: "00000000-0000-4000-8000-000000000099" }],
      [{ id: OUTBOX_ID }],
    ];
    const execute = vi.fn(async (query: unknown) => {
      void query;
      return responses.shift() ?? [];
    });
    const transaction = vi.fn(
      async (callback: (value: { execute: typeof execute }) => Promise<void>) =>
        callback({ execute }),
    );
    const store = new PostgresCommuteEmailMessageContextStore({
      transaction,
    } as never);

    await store.persistCurrentSnapshot({
      outboxId: OUTBOX_ID,
      scheduleId: SCHEDULE_ID,
      serviceDate: "2026-08-20",
      plan: privatePlan as never,
      planHash: sha256Json(normalizedPlan),
      expectedScheduleUpdatedAt: UPDATED_AT,
      expectedDepartureAt: DEPARTURE,
      capturedAt: new Date("2026-08-20T14:00:00.000Z"),
    });

    const insertQuery = new PgDialect().sqlToQuery(
      execute.mock.calls[1]![0] as never,
    );
    expect(insertQuery.params[2]).toBe(normalizedPlan.status);
    expect(insertQuery.params).toContain(JSON.stringify(normalizedPlan));
    expect(insertQuery.params).not.toContain(JSON.stringify(privatePlan));
    expect(JSON.stringify(insertQuery.params)).not.toContain(
      "must-not-cross-the-seam",
    );
  });

  it("rejects a past context and malformed prior snapshot before planning", async () => {
    const past = dependencies({
      clock: () => new Date("2026-08-20T16:00:00.000Z"),
    });
    await expect(
      createCommuteEmailMessageBuilder(past)(OUTBOX_ID),
    ).rejects.toThrow("COMMUTE_MESSAGE_CONTEXT_INVALID");
    expect(past.planner.plan).not.toHaveBeenCalled();

    const malformed = dependencies({
      context: {
        read: vi.fn(async () =>
          context({
            previousSnapshot: { plan: { status: "private" } } as never,
          }),
        ),
        persistCurrentSnapshot: vi.fn(async () => undefined),
      },
    });
    await expect(
      createCommuteEmailMessageBuilder(malformed)(OUTBOX_ID),
    ).rejects.toThrow("COMMUTE_MESSAGE_CONTEXT_INVALID");
    expect(malformed.planner.plan).not.toHaveBeenCalled();
  });

  it("queries a future sending outbox and only a latest prior sent snapshot", async () => {
    const execute = vi.fn(async (query: unknown): Promise<unknown[]> => {
      void query;
      return [];
    });
    const store = new PostgresCommuteEmailMessageContextStore({
      execute,
    } as never);

    await expect(store.read(OUTBOX_ID)).resolves.toBeNull();
    const query = new PgDialect().sqlToQuery(
      execute.mock.calls[0]![0] as never,
    );
    expect(query.params).toEqual([OUTBOX_ID]);
    expect(query.sql).toContain("outbox.status = 'sending'");
    expect(query.sql).toContain("outbox.departure_at > clock_timestamp()");
    expect(query.sql).toContain("schedule.paused = false");
    expect(query.sql).toContain("previous_outbox.status = 'sent'");
    expect(query.sql).toContain(
      "previous_outbox.service_date < outbox.service_date",
    );
    expect(query.sql).toContain(
      "snapshot.id = previous_outbox.journey_snapshot_id",
    );
    expect(query.sql).not.toContain("snapshot.id = outbox.journey_snapshot_id");
    expect(query.sql).not.toMatch(/recipient|email|provider|user_id/iu);
  });
});
