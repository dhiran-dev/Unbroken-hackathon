import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: undefined }));

import { PostgresNotificationRecipientResolver } from "@/server/notifications/recipient-resolver";

const dialect = new PgDialect();
const OUTBOX_ID = "00000000-0000-4000-8000-000000000001";

function resolver(rows: Array<Record<string, unknown>>) {
  const calls: string[] = [];
  const database = {
    async execute(query: unknown) {
      const rendered = dialect.sqlToQuery(query as never);
      calls.push(rendered.sql);
      return rows;
    },
  };
  return {
    resolver: new PostgresNotificationRecipientResolver(database as never),
    calls,
  };
}

describe("Postgres notification recipient seam", () => {
  it("resolves one safe rider address through the outbox and schedule", async () => {
    const { resolver: recipientResolver, calls } = resolver([
      { email: "rider@example.com" },
    ]);

    await expect(recipientResolver.resolveRecipient(OUTBOX_ID)).resolves.toBe(
      "rider@example.com",
    );
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("from notification_outbox as o");
    expect(calls[0]).toContain("commute_schedules as s");
    expect(calls[0]).toContain('"user" as u');
    expect(calls[0]).toContain("o.status = 'sending'");
    expect(calls[0]).toContain("o.departure_at > clock_timestamp()");
    expect(calls[0]).toContain("u.role = 'rider'");
    expect(calls[0]).toContain("u.email_verified = true");
    expect(calls[0]).toContain("u.banned = false");
    expect(calls[0]).not.toMatch(/insert|update|delete/iu);
  });

  it("fails closed for zero, duplicate, malformed, or unavailable rows", async () => {
    for (const rows of [
      [],
      [{ email: "one@example.com" }, { email: "two@example.com" }],
      [{ email: " rider@example.com" }],
      [{ email: "not-an-email" }],
      [{ email: "bad\n@example.com" }],
    ]) {
      const { resolver: recipientResolver } = resolver(rows);
      await expect(
        recipientResolver.resolveRecipient(OUTBOX_ID),
      ).resolves.toBeNull();
    }

    const database = {
      async execute() {
        throw new Error("private database detail");
      },
    };
    const recipientResolver = new PostgresNotificationRecipientResolver(
      database as never,
    );
    await expect(
      recipientResolver.resolveRecipient(OUTBOX_ID),
    ).resolves.toBeNull();
  });

  it("does not query for an invalid outbox id", async () => {
    const { resolver: recipientResolver, calls } = resolver([
      { email: "rider@example.com" },
    ]);

    await expect(
      recipientResolver.resolveRecipient("not-a-uuid"),
    ).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });
});
