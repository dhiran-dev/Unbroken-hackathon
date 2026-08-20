import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/transit/catalog", () => ({
  getTransitCatalog: vi.fn(),
}));
vi.mock("@/components/map/lazy-citywide-stop-map", () => ({
  LazyCitywideStopMap: "lazy-citywide-stop-map",
}));

import { getTransitCatalog } from "@/server/transit/catalog";
import { CitywideStopMapShell } from "@/components/map/citywide-stop-map-shell";

const feedHash = "a".repeat(64);
const coverage = {
  available: true as const,
  snapshotId: "snapshot-a",
  feedHash,
  counts: {
    stops: 3_238,
    routes: 68,
    trips: 50_690,
    stopTimes: 1_901_119,
    services: 6,
    shapePoints: 45_308,
  },
};

function mockedCoverage(value: unknown) {
  vi.mocked(getTransitCatalog).mockReturnValue({
    getCoverage: vi.fn().mockResolvedValue(value),
  } as never);
}

describe("CitywideStopMapShell", () => {
  it("reads coverage only and passes its active feed hash to the lazy map", async () => {
    mockedCoverage(coverage);

    const element = await CitywideStopMapShell({
      className: "map-shell",
      height: 480,
    });

    expect(element).toMatchObject({
      type: "lazy-citywide-stop-map",
      props: { feedHash, className: "map-shell", height: 480 },
    });
    expect(getTransitCatalog).toHaveBeenCalledTimes(1);
  });

  it.each([
    null,
    { available: false },
    { ...coverage, feedHash: "A".repeat(64) },
    { ...coverage, counts: { ...coverage.counts, stops: 0 } },
  ])("fails closed for invalid coverage: %o", async (invalidCoverage) => {
    mockedCoverage(invalidCoverage);

    const element = await CitywideStopMapShell({});

    expect(element).toMatchObject({
      props: {
        children: "Map is unavailable. Use the trip steps instead.",
      },
    });
  });

  it("fails closed when coverage cannot be read", async () => {
    vi.mocked(getTransitCatalog).mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const element = await CitywideStopMapShell({});

    expect(element).toMatchObject({
      props: {
        children: "Map is unavailable. Use the trip steps instead.",
      },
    });
  });
});
