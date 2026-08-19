import { beforeEach, describe, expect, it, vi } from "vitest";

import { collectBrightData } from "@/server/services/bright-data";
import { createBrightDataStopRelocationCollector } from "@/server/transit/stop-relocation-collector";
import {
  STOP_RELOCATION_COLLECTOR_ID,
  STOP_RELOCATION_SOURCE_URL,
} from "@/server/transit/stop-relocations";
import { stopRelocationEnvelope } from "../support/stop-relocations";

vi.mock("@/server/services/bright-data", () => ({
  collectBrightData: vi.fn(),
}));

const collectMock = vi.mocked(collectBrightData);

beforeEach(() => {
  collectMock.mockReset();
});

describe("Bright Data stop relocation collector", () => {
  it("returns only one complete exact source envelope", async () => {
    const envelope = stopRelocationEnvelope();
    collectMock.mockResolvedValue({
      collectionId: "j_Synthetic123",
      payload: [envelope],
      collectedAt: new Date("2026-08-20T01:00:00.000Z"),
    });

    await expect(
      createBrightDataStopRelocationCollector("synthetic-token").collect(),
    ).resolves.toEqual({
      collectorId: STOP_RELOCATION_COLLECTOR_ID,
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
      collectedAt: new Date("2026-08-20T01:00:00.000Z"),
      datasetComplete: true,
      envelope,
    });
    expect(collectMock).toHaveBeenCalledWith({
      BRIGHTDATA_API_TOKEN: "synthetic-token",
      BRIGHTDATA_COLLECTOR_ID: STOP_RELOCATION_COLLECTOR_ID,
      SFMTA_SOURCE_URL: STOP_RELOCATION_SOURCE_URL,
    });
  });

  it.each([
    { payload: [] },
    { payload: [{ partial: true }, { unexpected: true }] },
  ])("marks empty or multi-record output incomplete", async ({ payload }) => {
    collectMock.mockResolvedValue({
      collectionId: "j_Synthetic123",
      payload,
      collectedAt: new Date("2026-08-20T01:00:00.000Z"),
    });

    await expect(
      createBrightDataStopRelocationCollector("synthetic-token").collect(),
    ).resolves.toMatchObject({
      datasetComplete: false,
      envelope: null,
    });
  });
});
