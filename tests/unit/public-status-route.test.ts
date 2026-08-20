import { describe, expect, it } from "vitest";

import {
  createPublicStatusGet,
  parsePublicStatusFilter,
} from "@/app/api/public/status/route";
import type {
  PublicCitywideStatus,
  PublicCitywideStatusView,
} from "@/server/citywide-status/public-citywide-status";

const date = new Date("2026-08-20T12:00:00.000Z");

function view(): PublicCitywideStatusView {
  const source = {
    state: "current" as const,
    checkedAt: date,
    sourceUpdatedAt: null,
    sourceUrl: "https://www.sfmta.com/example",
    summary: "No current changes.",
    count: 0,
  };
  return {
    elevators: {
      ...source,
      sourceUrl:
        "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
      stations: [],
      counts: { accessible: 0, limited: 0, unavailable: 0, unknown: 0 },
    },
    advisories: { ...source, items: [] },
    relocations: { ...source, items: [] },
    guides: { ...source, items: [] },
    alerts: {
      ...source,
      sourceUrl: "https://511.org/open-data/transit",
      items: [],
    },
  };
}

describe("GET /api/public/status", () => {
  it("normalizes bounded q/type/state filters and ignores invalid values", () => {
    const parsed = parsePublicStatusFilter(
      new Request(
        "https://unbroken.local/api/public/status?q=  Powell  &type=bad&state=unknown&state=current",
      ),
    );
    expect(parsed).toEqual({ query: "Powell", type: "all", state: "all" });
  });

  it("returns the exact no-store success envelope deterministically", async () => {
    const status: PublicCitywideStatus = { read: async () => view() };
    const get = createPublicStatusGet({
      getStatus: () => status,
      readPlannerFlag: () => "true",
      clock: () => date,
    });
    const first = await get(
      new Request("https://unbroken.local/api/public/status"),
    );
    const second = await get(
      new Request("https://unbroken.local/api/public/status"),
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("no-store, max-age=0");
    expect(await first.text()).toBe(await second.text());
    expect(
      JSON.parse(
        await (
          await get(new Request("https://unbroken.local/api/public/status"))
        ).text(),
      ),
    ).toMatchObject({
      available: true,
      elevators: { state: "current" },
    });
  });

  it("fails closed unless CITYWIDE_PLANNER_ENABLED is exactly true", async () => {
    const status: PublicCitywideStatus = { read: async () => view() };
    const disabled = createPublicStatusGet({
      getStatus: () => status,
      readPlannerFlag: () => "TRUE",
      clock: () => date,
    });
    const disabledResponse = await disabled(
      new Request("https://unbroken.local/api/public/status"),
    );
    expect(disabledResponse.status).toBe(503);
    expect(disabledResponse.headers.get("cache-control")).toBe(
      "no-store, max-age=0",
    );

    const enabled = createPublicStatusGet({
      getStatus: () => status,
      readPlannerFlag: () => "true",
      clock: () => date,
    });
    expect(
      (await enabled(new Request("https://unbroken.local/api/public/status")))
        .status,
    ).toBe(200);
  });

  it("maps an unexpected top-level read failure to the fixed safe 503", async () => {
    const get = createPublicStatusGet({
      getStatus: async () => {
        throw new Error("token=secret internal-db-id=private");
      },
      readPlannerFlag: () => "true",
      clock: () => date,
    });
    const response = await get(
      new Request("https://unbroken.local/api/public/status"),
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      available: false,
      code: "PUBLIC_STATUS_UNAVAILABLE",
      message: "Current status information is unavailable right now.",
    });
  });
});
