import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AdminCoveragePage from "@/app/admin/coverage/page";
import { canPerformOperatorAction, isOperatorRole } from "@/server/auth/roles";
import {
  getAdminCoverage,
  type AdminCoverageSnapshot,
} from "@/server/services/admin-coverage";

vi.mock("@/server/services/admin-coverage", () => ({
  getAdminCoverage: vi.fn(),
}));

const checkedAt = new Date("2026-08-20T12:00:00.000Z");
const sourceUpdatedAt = new Date("2026-08-20T11:59:00.000Z");
const realtimeSourceUrl = "https://511.org/open-data/transit";
const sourceUrls = {
  elevators:
    "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
  accessibility_advisories:
    "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
  stop_relocations:
    "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  stop_accessibility:
    "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
} as const;

const coverage = {
  status: "partial",
  static: {
    status: "unavailable",
    state: null,
    serviceDate: null,
    activeServiceCount: null,
    counts: null,
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl: null,
  },
  realtime: [
    {
      feedType: "trip_updates",
      status: "current",
      entityCount: 120,
      checkedAt,
      sourceUpdatedAt,
      expiresAt: new Date("2026-08-20T12:05:00.000Z"),
      sourceUrl: realtimeSourceUrl,
    },
    {
      feedType: "vehicles",
      status: "older",
      entityCount: 80,
      checkedAt,
      sourceUpdatedAt,
      expiresAt: new Date("2026-08-20T11:55:00.000Z"),
      sourceUrl: realtimeSourceUrl,
    },
    {
      feedType: "alerts",
      status: "current",
      entityCount: 4,
      checkedAt,
      sourceUpdatedAt,
      expiresAt: new Date("2026-08-20T12:15:00.000Z"),
      sourceUrl: realtimeSourceUrl,
    },
  ],
  sources: [
    {
      key: "elevators",
      label: "Elevator observations",
      status: "unavailable",
      rowCount: null,
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: null,
    },
    {
      key: "accessibility_advisories",
      label: "Accessibility advisories",
      status: "current",
      rowCount: 11,
      checkedAt,
      sourceUpdatedAt,
      sourceUrl: sourceUrls.accessibility_advisories,
    },
    {
      key: "stop_relocations",
      label: "Stop relocations",
      status: "current",
      rowCount: 6,
      checkedAt,
      sourceUpdatedAt,
      sourceUrl: sourceUrls.stop_relocations,
    },
    {
      key: "stop_accessibility",
      label: "Accessible-stop guidance",
      status: "current",
      rowCount: 41,
      checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: sourceUrls.stop_accessibility,
    },
  ],
} satisfies AdminCoverageSnapshot;

async function markup(statusFilter?: string): Promise<string> {
  const page = await AdminCoveragePage({
    searchParams: Promise.resolve(statusFilter ? { statusFilter } : {}),
  });
  return renderToStaticMarkup(page);
}

describe("operator citywide coverage page seam", () => {
  beforeEach(() => {
    vi.mocked(getAdminCoverage).mockResolvedValue(structuredClone(coverage));
  });

  it("renders all seven fixed source rows with separate provenance times and safe official links", async () => {
    const html = await markup();

    expect(html).toContain("Citywide coverage");
    expect(html).toContain("Checked by UNBROKEN at");
    expect(html).toContain("SFMTA updated at");
    const body = html.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/)?.[0] ?? "";
    expect((body.match(/<tr/g) ?? []).length).toBe(7);
    for (const label of [
      "Trip updates",
      "Vehicle positions",
      "Service alerts",
      "Elevator observations",
      "Accessibility advisories",
      "Stop relocations",
      "Accessible-stop guidance",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("min-w-[980px]");
    expect(html).not.toContain("collectorId");
    expect(html).not.toContain("payloadHash");
    expect(html).not.toContain("validationReport");

    const externalHrefs = [...html.matchAll(/href="(https:[^"]+)"/g)]
      .map((match) => match[1])
      .filter((href): href is string => typeof href === "string");
    expect(externalHrefs).toEqual(
      expect.arrayContaining([
        realtimeSourceUrl,
        sourceUrls.accessibility_advisories,
        sourceUrls.stop_relocations,
        sourceUrls.stop_accessibility,
      ]),
    );
    expect(
      externalHrefs.every(
        (href) =>
          href.startsWith("https://511.org/") ||
          href.startsWith("https://www.sfmta.com/"),
      ),
    ).toBe(true);
  });

  it("keeps unavailable static evidence visibly unavailable without fabricated counts", async () => {
    const html = await markup();

    expect(html).toContain("Static schedule unavailable");
    expect(html).toContain("No checked static snapshot is available");
    expect(html).not.toContain("3,238");
    expect(html).not.toContain("active calendars");
  });

  it("filters the fixed rows by status through the keyboard-labelled native form", async () => {
    const html = await markup("unavailable");

    expect(html).toContain('id="coverage-status-filter"');
    expect(html).toContain('name="statusFilter"');
    expect(html).toContain('for="coverage-status-filter"');
    const body = html.match(/<tbody[^>]*>[\s\S]*?<\/tbody>/)?.[0] ?? "";
    expect((body.match(/<tr/g) ?? []).length).toBe(1);
    expect(html).toContain("Elevator observations");
    expect(html).not.toContain("Trip updates");
    expect(html).toContain("Not available");
  });

  it("keeps the direct route behind the existing operator capability gate", () => {
    const layout = readFileSync(
      new URL("../../src/app/admin/layout.tsx", import.meta.url),
      "utf8",
    );
    const auth = readFileSync(
      new URL("../../src/server/auth/session.ts", import.meta.url),
      "utf8",
    );

    expect(layout).toContain('requireOperatorCapability("operate")');
    expect(auth).toContain(
      "if (!session || !isOperatorRole(session.user.role))",
    );
    expect(auth).toContain('redirect("/login")');
    expect(auth).toContain('redirect("/admin")');
    expect(isOperatorRole("rider")).toBe(false);
    expect(canPerformOperatorAction("rider", "operate")).toBe(false);
    expect(canPerformOperatorAction("owner", "operate")).toBe(true);
    expect(canPerformOperatorAction("admin", "operate")).toBe(true);
  });
});
