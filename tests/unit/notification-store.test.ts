import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: undefined }));

import {
  PostgresNotificationOutboxStore,
  PostgresNotificationScheduleSource,
} from "@/server/notifications/outbox-store";

const dialect = new PgDialect();
const NOW = new Date("2026-08-19T14:30:00.000Z");
const DEPARTURE = new Date("2026-08-19T15:00:00.000Z");
const SERVICE_DATE = "2026-08-19";

type OutboxState = {
  id: string;
  scheduleId: string;
  serviceDate: string;
  departureAt: Date;
  idempotencyKey: string;
  status: "pending" | "sending" | "failed" | "sent" | "suppressed";
  attemptCount: number;
  nextAttemptAt: Date | null;
  updatedAt: Date;
};

type Ledger = { reservedCount: number; sentCount: number };

function uuid(index: number) {
  return "00000000-0000-4000-8000-" + index.toString(16).padStart(12, "0");
}

function outbox(index: number, serviceDate = SERVICE_DATE): OutboxState {
  const id = uuid(index);
  const scheduleId = uuid(index + 10_000);
  return {
    id,
    scheduleId,
    serviceDate,
    departureAt: DEPARTURE,
    idempotencyKey: "commute/" + scheduleId + "/" + serviceDate,
    status: "pending",
    attemptCount: 0,
    nextAttemptAt: null,
    updatedAt: NOW,
  };
}

class FakeDatabase {
  now = new Date(NOW);
  capacityState: "closed" | "paused" | null = "closed";
  readonly outboxes = new Map<string, OutboxState>();
  readonly ledgers = new Map<string, Ledger>();
  scheduleRows: Array<Record<string, unknown>> = [];
  lastQuery = "";
  lastParams: unknown[] = [];
  private queue: Promise<void> = Promise.resolve();

  async transaction<T>(
    callback: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback(new FakeTransaction(this));
    } finally {
      release();
    }
  }

  async execute(query: unknown): Promise<Array<Record<string, unknown>>> {
    const rendered = dialect.sqlToQuery(query as never);
    this.lastQuery = rendered.sql;
    this.lastParams = rendered.params;
    if (rendered.sql.includes(" limit ")) {
      const limit = Number(rendered.params[rendered.params.length - 1]);
      return this.scheduleRows.slice(0, limit);
    }
    return this.scheduleRows;
  }

  ledger(period: "day" | "month", periodStart: string) {
    return (
      this.ledgers.get(period + ":" + periodStart) ?? {
        reservedCount: 0,
        sentCount: 0,
      }
    );
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeDatabase) {}

  async execute(query: unknown): Promise<Array<Record<string, unknown>>> {
    const rendered = dialect.sqlToQuery(query as never);
    const text = rendered.sql.replace(/\s+/gu, " ").trim();
    const params = rendered.params;

    if (text.startsWith("select clock_timestamp() as now")) {
      return [{ now: new Date(this.database.now) }];
    }
    if (
      text.includes("from notification_outbox") &&
      text.includes("for update") &&
      text.includes("where id =")
    ) {
      const row = this.database.outboxes.get(String(params[0]));
      return row ? [this.row(row)] : [];
    }
    if (text.startsWith("insert into email_budget_ledger")) {
      const period = String(params[0]);
      const periodStart = String(params[1]);
      const key = period + ":" + periodStart;
      if (!this.database.ledgers.has(key)) {
        this.database.ledgers.set(key, { reservedCount: 0, sentCount: 0 });
      }
      return [];
    }
    if (text.includes("from email_budget_ledger")) {
      const period = String(params[0]);
      const periodStart = String(params[1]);
      return [this.database.ledger(period as "day" | "month", periodStart)];
    }
    if (text.includes("select email_circuit_state as state")) {
      return this.database.capacityState === null
        ? []
        : [{ state: this.database.capacityState }];
    }
    if (text.startsWith("select count(*)::int as count")) {
      const month = text.includes("service_date >= ");
      const outboxId = String(params[month ? 3 : 1]);
      const periodStart = String(params[0]);
      const active = [...this.database.outboxes.values()].filter((row) => {
        if (row.id === outboxId || row.attemptCount < 1) return false;
        if (
          row.status !== "sending" &&
          !(row.status === "failed" && row.nextAttemptAt)
        ) {
          return false;
        }
        return month
          ? row.serviceDate.startsWith(periodStart.slice(0, 7))
          : row.serviceDate === periodStart;
      });
      return [{ count: active.length }];
    }
    if (text.startsWith("update signup_capacity")) {
      return this.database.capacityState === null
        ? []
        : (() => {
            this.database.capacityState = "paused";
            return [{ id: 1 }];
          })();
    }
    if (
      text.startsWith("update email_budget_ledger") &&
      text.includes("reserved_count = reserved_count + 1")
    ) {
      const period = text.includes("period = 'day'") ? "day" : "month";
      const periodStart = String(params[0]);
      const ledger = this.database.ledger(period, periodStart);
      ledger.reservedCount += 1;
      this.database.ledgers.set(period + ":" + periodStart, ledger);
      return [];
    }
    if (
      text.startsWith("update email_budget_ledger") &&
      text.includes("reserved_count = reserved_count - 1")
    ) {
      const period = text.includes("period = 'day'") ? "day" : "month";
      const sentDelta = Number(params[0]);
      const periodStart = String(params[1]);
      const ledger = this.database.ledger(period, periodStart);
      ledger.reservedCount -= 1;
      ledger.sentCount += sentDelta;
      this.database.ledgers.set(period + ":" + periodStart, ledger);
      return [{ id: uuid(999_999) }];
    }
    if (text.startsWith("insert into notification_outbox")) {
      const scheduleId = String(params[0]);
      const serviceDate = String(params[1]);
      const existing = [...this.database.outboxes.values()].find(
        (row) =>
          row.scheduleId === scheduleId && row.serviceDate === serviceDate,
      );
      if (existing) return [];
      const row = outbox(this.database.outboxes.size + 1, serviceDate);
      row.scheduleId = scheduleId;
      row.idempotencyKey = String(params[3]);
      row.departureAt = new Date(String(params[2]));
      row.updatedAt = new Date(this.database.now);
      this.database.outboxes.set(row.id, row);
      return [{ id: row.id }];
    }
    if (text.startsWith("update notification_outbox")) {
      const id = text.includes("suppressed")
        ? String(params[0])
        : String(params[params.length - 1]);
      const row = this.database.outboxes.get(id);
      if (!row) return [];
      if (text.includes("set status = 'sending'")) {
        row.status = "sending";
        row.attemptCount = Number(params[0]);
        row.nextAttemptAt = null;
        row.updatedAt = new Date(this.database.now);
        return [];
      }
      if (text.includes("set status = 'suppressed'")) {
        row.status = "suppressed";
        row.nextAttemptAt = null;
        row.updatedAt = new Date(this.database.now);
        return [{ id }];
      }
      if (text.includes("set status = 'failed'")) {
        row.status = "failed";
        row.nextAttemptAt = null;
        row.updatedAt = new Date(this.database.now);
        return [];
      }
      if (text.includes("set status = 'sent'")) {
        row.status = "sent";
        row.nextAttemptAt = null;
        row.updatedAt = new Date(this.database.now);
        return [];
      }
      if (text.includes("set status = $1")) {
        row.status = String(params[0]) as OutboxState["status"];
        row.nextAttemptAt =
          params[1] instanceof Date ? new Date(params[1]) : null;
        row.updatedAt = new Date(this.database.now);
        return [];
      }
      return [];
    }
    if (text.startsWith("insert into email_deliveries")) return [];
    if (text.includes("from commute_schedules"))
      return this.database.scheduleRows;
    return [];
  }

  private row(row: OutboxState) {
    return {
      id: row.id,
      scheduleId: row.scheduleId,
      serviceDate: row.serviceDate,
      departureAt: new Date(row.departureAt),
      idempotencyKey: row.idempotencyKey,
      status: row.status,
      attemptCount: row.attemptCount,
      nextAttemptAt: row.nextAttemptAt ? new Date(row.nextAttemptAt) : null,
      updatedAt: new Date(row.updatedAt),
    };
  }
}

function store(database: FakeDatabase) {
  return new PostgresNotificationOutboxStore(
    database as unknown as ConstructorParameters<
      typeof PostgresNotificationOutboxStore
    >[0],
  );
}

async function claim(
  notificationStore: PostgresNotificationOutboxStore,
  outboxId: string,
  dailyBudget = 80,
  monthlyBudget = 2_480,
) {
  return notificationStore.claim({
    outboxId,
    now: NOW,
    dailyBudget,
    monthlyBudget,
    maxAttempts: 3,
    leaseMs: 5 * 60 * 1_000,
  });
}

describe("Postgres notification transaction seam", () => {
  it("reserves exactly the daily 80th item and pauses the 81st", async () => {
    const database = new FakeDatabase();
    const notificationStore = store(database);
    const ids: string[] = [];
    for (let index = 1; index <= 81; index += 1) {
      const row = outbox(index);
      database.outboxes.set(row.id, row);
      ids.push(row.id);
    }

    const results = await Promise.all(
      ids.map((id) => claim(notificationStore, id)),
    );
    expect(
      results.filter((result) => result.status === "claimed"),
    ).toHaveLength(80);
    expect(
      results.filter((result) => result.status === "budget_exhausted"),
    ).toHaveLength(1);
    expect(database.ledger("day", SERVICE_DATE)).toEqual({
      reservedCount: 80,
      sentCount: 0,
    });
    expect(database.capacityState).toBe("paused");
  });

  it("reserves exactly the monthly 2,480th item and pauses the 2,481st", async () => {
    const database = new FakeDatabase();
    const notificationStore = store(database);
    const ids: string[] = [];
    for (let index = 1; index <= 2_481; index += 1) {
      const row = outbox(index);
      database.outboxes.set(row.id, row);
      ids.push(row.id);
    }

    const results = await Promise.all(
      ids.map((id) => claim(notificationStore, id, 3_000, 2_480)),
    );
    expect(
      results.filter((result) => result.status === "claimed"),
    ).toHaveLength(2_480);
    expect(
      results.filter((result) => result.status === "budget_exhausted"),
    ).toHaveLength(1);
    expect(database.ledger("month", "2026-08-01")).toEqual({
      reservedCount: 2_480,
      sentCount: 0,
    });
  });

  it("does not release a terminal reservation a second time after restart", async () => {
    const database = new FakeDatabase();
    const notificationStore = store(database);
    const row = outbox(1);
    database.outboxes.set(row.id, row);

    const firstClaim = await claim(notificationStore, row.id);
    expect(firstClaim.status).toBe("claimed");
    const claimValue =
      firstClaim.status === "claimed" ? firstClaim.claim : null;
    expect(claimValue).not.toBeNull();
    await expect(
      notificationStore.markFailure({
        claim: claimValue!,
        decision: {
          status: "failed",
          errorCode: "timeout",
          nextAttemptAt: null,
          pauseCircuit: false,
        },
      }),
    ).resolves.toEqual({ status: "failed" });
    expect(database.ledger("day", SERVICE_DATE).reservedCount).toBe(0);

    database.now = new Date("2026-08-19T15:01:00.000Z");
    await expect(claim(notificationStore, row.id)).resolves.toEqual({
      status: "failed",
    });
    expect(database.ledger("day", SERVICE_DATE).reservedCount).toBe(0);
  });

  it("reclaims an expired send lease without double-reserving its budget", async () => {
    const database = new FakeDatabase();
    const notificationStore = store(database);
    const row = outbox(1);
    database.outboxes.set(row.id, row);

    const firstClaim = await claim(notificationStore, row.id);
    expect(firstClaim.status).toBe("claimed");
    database.now = new Date("2026-08-19T14:36:00.000Z");
    const secondClaim = await notificationStore.claim({
      outboxId: row.id,
      now: database.now,
      dailyBudget: 80,
      monthlyBudget: 2_480,
      maxAttempts: 3,
      leaseMs: 5 * 60 * 1_000,
    });
    expect(secondClaim.status).toBe("claimed");
    expect(
      secondClaim.status === "claimed" ? secondClaim.claim.attemptNumber : 0,
    ).toBe(2);
    expect(database.ledger("day", SERVICE_DATE).reservedCount).toBe(1);
  });

  it("suppresses a claim when the DB clock crosses departure before provider work", async () => {
    const database = new FakeDatabase();
    const notificationStore = store(database);
    const row = outbox(1);
    database.outboxes.set(row.id, row);

    const result = await claim(notificationStore, row.id);
    expect(result.status).toBe("claimed");
    if (result.status !== "claimed") return;
    database.now = DEPARTURE;

    await expect(
      notificationStore.confirmSendReady({ claim: result.claim }),
    ).resolves.toEqual({ status: "suppressed" });
    expect(database.outboxes.get(row.id)?.status).toBe("suppressed");
    expect(database.ledger("day", SERVICE_DATE).reservedCount).toBe(0);
  });

  it("fails closed when the singleton capacity row is absent", async () => {
    const database = new FakeDatabase();
    database.capacityState = null;
    const notificationStore = store(database);
    const row = outbox(1);
    database.outboxes.set(row.id, row);

    await expect(claim(notificationStore, row.id)).resolves.toEqual({
      status: "circuit_paused",
    });
    expect(database.ledger("day", SERVICE_DATE).reservedCount).toBe(0);
  });

  it("rejects a stale due item after the schedule departure was edited", async () => {
    const database = new FakeDatabase();
    database.scheduleRows = [
      {
        id: uuid(10_001),
        paused: false,
        days: ["wednesday"],
        departureTime: "16:00",
        timezone: "America/Los_Angeles",
        leadMinutes: 30,
      },
    ];
    const notificationStore = store(database);
    const due = {
      scheduleId: uuid(10_001),
      serviceDate: SERVICE_DATE,
      dueAt: new Date("2026-08-19T14:30:00.000Z"),
      departureAt: DEPARTURE,
      leadMinutes: 30 as const,
      idempotencyKey: "commute/" + uuid(10_001) + "/" + SERVICE_DATE,
    };

    await expect(notificationStore.prepare(due)).rejects.toThrow(
      "notification schedule changed",
    );
  });

  it("exposes a bounded production due-outbox queue and rejects malformed IDs", async () => {
    const database = new FakeDatabase();
    database.scheduleRows = Array.from({ length: 100 }, (_, index) => ({
      id: uuid(index + 1),
    }));
    const notificationStore = store(database);

    await expect(
      notificationStore.listDueOutboxIds(NOW, 1_000),
    ).resolves.toHaveLength(80);

    database.scheduleRows = [{ id: "not-a-uuid" }];
    await expect(notificationStore.listDueOutboxIds(NOW, 80)).rejects.toThrow(
      "notification due outbox unavailable",
    );
  });

  it("queues stale sending rows so a restarted worker can reclaim them", async () => {
    const database = new FakeDatabase();
    database.scheduleRows = [{ id: uuid(1) }];
    const notificationStore = store(database);

    await expect(notificationStore.listDueOutboxIds(NOW, 80)).resolves.toEqual([
      uuid(1),
    ]);
    expect(database.lastQuery).toContain("make_interval");
    expect(database.lastParams).toContain("sending");
    expect(database.lastParams).toContain(300);
  });

  it("fails closed when a schedule source row has the wrong timezone", async () => {
    const database = new FakeDatabase();
    database.scheduleRows = [
      {
        id: uuid(10_001),
        paused: false,
        days: ["wednesday"],
        departureTime: "15:00",
        timezone: "UTC",
        leadMinutes: 30,
      },
    ];
    const source = new PostgresNotificationScheduleSource(
      database as unknown as ConstructorParameters<
        typeof PostgresNotificationScheduleSource
      >[0],
    );

    await expect(source.listSchedules()).rejects.toThrow(
      "notification schedule source unavailable",
    );
  });
});
