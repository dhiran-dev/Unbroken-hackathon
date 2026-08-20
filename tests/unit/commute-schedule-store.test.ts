import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: undefined }));

import { PostgresCommuteScheduleStore } from "@/server/commutes/service";

const dialect = new PgDialect();

describe("Postgres commute schedule replacement", () => {
  it("uses the database clock at the update, not the transaction start", async () => {
    let conflictUpdate: Record<string, unknown> | undefined;
    const database = {
      insert() {
        return {
          values() {
            return {
              onConflictDoUpdate(input: { set: Record<string, unknown> }) {
                conflictUpdate = input.set;
                return {
                  async returning() {
                    return [
                      {
                        id: "00000000-0000-4000-8000-000000000001",
                        userId: "rider-a",
                        slot: "first",
                        originPlaceId: "stop:origin",
                        destinationPlaceId: "landmark:ferry-building",
                        days: ["wednesday"],
                        departureTime: "08:00",
                        timezone: "America/Los_Angeles",
                        leadMinutes: 30,
                        paused: false,
                        createdAt: new Date("2026-08-19T12:00:00.000Z"),
                        updatedAt: new Date("2026-08-19T14:31:00.000Z"),
                      },
                    ];
                  },
                };
              },
            };
          },
        };
      },
    };
    const store = new PostgresCommuteScheduleStore(database as never);

    await store.replaceForRider("rider-a", "first", {
      originPlaceId: "stop:origin",
      destinationPlaceId: "landmark:ferry-building",
      days: ["wednesday"],
      departureTime: "08:00",
      reminderMinutes: 30,
      paused: false,
      timezone: "America/Los_Angeles",
    });

    const updatedAt = conflictUpdate?.updatedAt;
    expect(updatedAt).toBeDefined();
    const rendered = dialect.sqlToQuery(updatedAt as never).sql;
    expect(rendered).toContain("clock_timestamp()");
    expect(rendered).not.toContain("CURRENT_TIMESTAMP");
  });
});
