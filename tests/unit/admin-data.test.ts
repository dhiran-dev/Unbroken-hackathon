import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/db/client", () => ({ db: {} }));

import {
  csvValue,
  parseIncidentFilters,
  parseRunFilters,
  sanitizedMetadata,
  toCsv,
} from "@/server/services/admin-data";

describe("admin query parsing and safe exports", () => {
  it("normalizes URL-backed run filters and bounds page size", () => {
    const filters = parseRunFilters(
      new URLSearchParams({
        q: "  source update  ",
        status: "accepted",
        classification: "healthy_no_change",
        sort: "oldest",
        pageSize: "999",
        from: "2026-01-01",
      }),
    );

    expect(filters.q).toBe("source update");
    expect(filters.status).toBe("accepted");
    expect(filters.sort).toBe("oldest");
    expect(filters.pageSize).toBe(50);
    expect(filters.from?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });

  it("falls back safely for unknown incident filters", () => {
    const filters = parseIncidentFilters({ state: "not-a-state", classification: "nope", pageSize: "1" });
    expect(filters.state).toBe("all");
    expect(filters.classification).toBe("all");
    expect(filters.pageSize).toBe(5);
  });

  it("removes sensitive metadata before export", () => {
    expect(
      sanitizedMetadata({
        action: "review",
        count: 2,
        prompt: "do not export",
        payload: { private: true },
        nested: { private: true },
      }),
    ).toEqual({ action: "review", count: 2 });
  });

  it("quotes CSV cells and preserves a stable header", () => {
    expect(csvValue('a,"b"\n')).toBe('"a,""b"" "');
    expect(
      toCsv([
        { id: "run-1", status: "accepted" },
        { id: "run-2", status: "rejected" },
      ]),
    ).toBe('"id","status"\n"run-1","accepted"\n"run-2","rejected"');
  });

  it("neutralizes spreadsheet formulas but preserves ordinary numeric and timestamp cells", () => {
    expect(csvValue("=SUM(A1:A2)")).toBe("\"'=SUM(A1:A2)\"");
    expect(csvValue("+SUM(A1:A2)")).toBe("\"'+SUM(A1:A2)\"");
    expect(csvValue("-SUM(A1:A2)")).toBe("\"'-SUM(A1:A2)\"");
    expect(csvValue("@command")).toBe(String.fromCharCode(34, 39) + "@command" + String.fromCharCode(34));
    expect(csvValue("\t=SUM(A1:A2)")).toBe("\"'\t=SUM(A1:A2)\"");
    expect(csvValue("\r=SUM(A1:A2)")).toBe("\"' =SUM(A1:A2)\"");
    expect(csvValue("-42.5")).toBe("\"-42.5\"");
    expect(csvValue(-42.5)).toBe("\"-42.5\"");
    expect(csvValue("2026-08-19T12:34:56.000Z")).toBe("\"2026-08-19T12:34:56.000Z\"");
  });
});
