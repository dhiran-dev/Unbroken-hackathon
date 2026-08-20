import { describe, expect, it, vi } from "vitest";

import { createEmailHistoryGet } from "@/app/api/me/email-history/route";

const rider = { userId: "rider-a", role: "rider" as const };

describe("email-history route contract", () => {
  it("denies anonymous and operator sessions before reading history", async () => {
    const listForRider = vi.fn(async () => []);
    const anonymous = createEmailHistoryGet({
      readRider: vi.fn(async () => null),
      history: { listForRider },
    });
    await expect(
      anonymous(new Request("https://unbroken.test/api/me/email-history")),
    ).resolves.toMatchObject({ status: 401 });
    expect(listForRider).not.toHaveBeenCalled();

    const operator = createEmailHistoryGet({
      readRider: vi.fn(
        async () =>
          ({
            userId: "operator-a",
            role: "admin",
          }) as never,
      ),
      history: { listForRider },
    });
    await expect(
      operator(new Request("https://unbroken.test/api/me/email-history")),
    ).resolves.toMatchObject({ status: 401 });
    expect(listForRider).not.toHaveBeenCalled();
  });

  it("returns a stable public unavailable response for malformed or throwing history", async () => {
    const malformed = createEmailHistoryGet({
      readRider: vi.fn(async () => rider),
      history: {
        listForRider: vi.fn(async () => [
          {
            serviceDate: "2026-02-30",
            slot: "first" as const,
            status: "sent" as const,
          },
        ]),
      },
    });
    const malformedResponse = await malformed(
      new Request("https://unbroken.test/api/me/email-history"),
    );
    expect(malformedResponse.status).toBe(503);
    await expect(malformedResponse.json()).resolves.toEqual({
      code: "COMMUTE_UNAVAILABLE",
      message: "Your trips are unavailable right now.",
    });

    const thrown = createEmailHistoryGet({
      readRider: vi.fn(async () => rider),
      history: {
        listForRider: vi.fn(async () => {
          throw new Error("private database URL and provider token");
        }),
      },
    });
    const response = await thrown(
      new Request("https://unbroken.test/api/me/email-history"),
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("sorts latest dates, bounds twenty rows, and passes only the current rider", async () => {
    const rows = Array.from({ length: 21 }, (_, index) => ({
      serviceDate: new Date(Date.UTC(2026, 7, 20 - index))
        .toISOString()
        .slice(0, 10),
      slot: index % 2 === 0 ? ("return" as const) : ("first" as const),
      status: "sent" as const,
    }));
    const listForRider = vi.fn(async () => rows);
    const get = createEmailHistoryGet({
      readRider: vi.fn(async () => rider),
      history: { listForRider },
    });
    const response = await get(
      new Request("https://unbroken.test/api/me/email-history"),
    );
    const body = (await response.json()) as {
      deliveries: Array<{ serviceDate: string; slot: string; status: string }>;
    };
    expect(response.status).toBe(200);
    expect(body.deliveries).toHaveLength(20);
    expect(body.deliveries[0]).toEqual({
      serviceDate: "2026-08-20",
      slot: "return",
      status: "sent",
    });
    expect(body.deliveries.at(-1)?.serviceDate).toBe("2026-08-01");
    expect(listForRider).toHaveBeenCalledWith("rider-a");
  });
});
