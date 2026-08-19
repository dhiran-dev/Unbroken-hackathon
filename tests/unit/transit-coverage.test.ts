import { describe, expect, it } from "vitest";

import { classifyTransitCoverage } from "@/domain/transit/coverage";

describe("citywide transit coverage state", () => {
  it("uses the San Francisco calendar date for current coverage", () => {
    expect(
      classifyTransitCoverage(
        "2026-08-18",
        new Date("2026-08-19T06:30:00.000Z"),
      ),
    ).toBe("current");
  });

  it("marks a prior service date as older", () => {
    expect(
      classifyTransitCoverage(
        "2026-08-18",
        new Date("2026-08-19T18:00:00.000Z"),
      ),
    ).toBe("older");
  });
});
