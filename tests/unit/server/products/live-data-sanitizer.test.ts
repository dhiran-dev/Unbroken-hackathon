import { describe, expect, it } from "vitest";

import { sanitizeLiveRun } from "@/server/products/live-data-sanitizer";

describe("live data run sanitizer", () => {
  it("exposes resumable lifecycle evidence without provider identity or payloads", () => {
    const result = sanitizeLiveRun({
      id: "run-1",
      status: "provider_wait_timeout",
      trigger: "job:pulse.collect.discovery",
      rowCount: null,
      errorCode: "provider_wait_timeout",
      startedAt: new Date("2026-08-22T10:00:00Z"),
      finishedAt: new Date("2026-08-22T11:00:00Z"),
      report: {
        provider: {
          kind: "bright_data_dca",
          collectionId: "j_private123",
          status: "timed_out",
          attempts: 8,
          submittedAt: "2026-08-22T10:00:00Z",
          lastPollAt: "2026-08-22T10:59:00Z",
        },
        landing: { inputRows: 663, storedRows: 663, collectorErrorWarnings: 2 },
        rawPayload: { secret: true },
      },
    });

    expect(result.provider).toMatchObject({
      kind: "bright_data_dca",
      status: "timed_out",
      attempts: 8,
      hasCollectionId: true,
      resumable: true,
    });
    expect(result.rowCounts).toEqual({
      collected: null,
      input: 663,
      stored: 663,
      parsed: null,
      promoted: null,
      warnings: 2,
    });
    expect(JSON.stringify(result)).not.toContain("j_private123");
    expect(JSON.stringify(result)).not.toContain("secret");
  });
});
