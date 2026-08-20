import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  createEmailHistoryReader,
  MAX_EMAIL_HISTORY,
  normalizeEmailHistoryRows,
  PostgresEmailHistoryStore,
} from "@/server/commutes/email-history";

describe("email history projection seam", () => {
  it("keeps both slots on the same date, maps in-flight work to pending, and caps at twenty", () => {
    const rows = [
      { serviceDate: "2026-08-20", slot: "return", status: "sent" },
      { serviceDate: "2026-08-20", slot: "first", status: "sending" },
      ...Array.from({ length: 20 }, (_, index) => ({
        serviceDate: new Date(Date.UTC(2026, 7, 19 - index))
          .toISOString()
          .slice(0, 10),
        slot: "first" as const,
        status: "failed" as const,
      })),
    ];

    const result = normalizeEmailHistoryRows(rows);

    expect(result).toHaveLength(MAX_EMAIL_HISTORY);
    expect(result?.slice(0, 2)).toEqual([
      { serviceDate: "2026-08-20", slot: "first", status: "pending" },
      { serviceDate: "2026-08-20", slot: "return", status: "sent" },
    ]);
  });

  it("fails closed for invalid dates, slots, statuses, and duplicate persisted keys", () => {
    expect(
      normalizeEmailHistoryRows([
        { serviceDate: "2026-02-30", slot: "first", status: "sent" },
      ]),
    ).toBeNull();
    expect(
      normalizeEmailHistoryRows([
        { serviceDate: "2026-08-20", slot: "third", status: "sent" },
      ]),
    ).toBeNull();
    expect(
      normalizeEmailHistoryRows([
        { serviceDate: "2026-08-20", slot: "first", status: "provider_error" },
      ]),
    ).toBeNull();
    expect(
      normalizeEmailHistoryRows([
        { serviceDate: "2026-08-20", slot: "first", status: "sent" },
        { serviceDate: "2026-08-20", slot: "first", status: "failed" },
      ]),
    ).toBeNull();
  });

  it("passes only the current rider to the owner-scoped store and hides malformed rows", async () => {
    const listForRider = vi.fn(async () => [
      {
        serviceDate: "2026-08-20",
        slot: "first",
        status: "sent",
        providerMessageId: "secret",
      },
    ]);
    const reader = createEmailHistoryReader({ listForRider });

    await expect(reader.listForRider("rider-a")).resolves.toEqual([
      { serviceDate: "2026-08-20", slot: "first", status: "sent" },
    ]);
    expect(listForRider).toHaveBeenCalledWith("rider-a");

    const malformed = createEmailHistoryReader({
      listForRider: vi.fn(async () => [
        { serviceDate: "2026-08-20", slot: "first", status: "private" },
      ]),
    });
    await expect(malformed.listForRider("rider-a")).rejects.toThrow();
  });

  it("projects retryable outbox failures as pending in the production query", async () => {
    const execute = vi.fn(async (query: unknown) => {
      void query;
      return [
        { serviceDate: "2026-08-20", slot: "first", status: "pending" },
        { serviceDate: "2026-08-19", slot: "return", status: "failed" },
      ];
    });
    const store = new PostgresEmailHistoryStore({ execute } as never);

    await expect(store.listForRider("rider-a")).resolves.toEqual([
      { serviceDate: "2026-08-20", slot: "first", status: "pending" },
      { serviceDate: "2026-08-19", slot: "return", status: "failed" },
    ]);

    const query = new PgDialect().sqlToQuery(
      execute.mock.calls[0]![0] as never,
    );
    expect(query.params).toEqual(["rider-a", 20]);
    expect(query.sql).toContain("schedule.user_id =");
    expect(query.sql).toContain("outbox.departure_at <= clock_timestamp()");
    expect(query.sql).toContain("outbox.status <> \x27sent\x27");
    expect(query.sql).toContain("outbox.status = \x27sent\x27");
    expect(query.sql).toContain("outbox.status = \x27suppressed\x27");
    expect(query.sql).toContain("outbox.next_attempt_at is not null");
    expect(query.sql).toContain("else outbox.status");
    expect(
      normalizeEmailHistoryRows([
        { serviceDate: "2026-08-19", slot: "return", status: "suppressed" },
      ]),
    ).toEqual([
      { serviceDate: "2026-08-19", slot: "return", status: "suppressed" },
    ]);
    expect(query.sql).not.toContain("email_deliveries");
  });
});
