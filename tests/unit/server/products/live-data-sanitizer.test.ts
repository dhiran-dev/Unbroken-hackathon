import { describe, expect, it } from "vitest";

import { sanitizeLiveRun } from "@/server/products/live-data-sanitizer";

describe("live data run sanitizer", () => {
  it("exposes resumable lifecycle evidence without provider identity or payloads", () => {
    const result = sanitizeLiveRun({
      status: "provider_wait_timeout",
      trigger: "job:pulse.collect.discovery",
      rowCount: null,
      startedAt: new Date("2026-08-22T10:00:00Z"),
      finishedAt: new Date("2026-08-22T11:00:00Z"),
      createdAt: new Date("2026-08-22T09:59:00Z"),
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

    expect(result).not.toHaveProperty("runId");
    expect(result).not.toHaveProperty("errorCode");
    expect(result).not.toHaveProperty("provider");
    expect(result.stages.collect).toBe("timed_out");
    expect(result.rowCounts).toEqual({
      collected: null,
      input: 663,
      stored: 663,
      parsed: null,
      promoted: null,
      warnings: 2,
    });
    expect(result.createdAt).toBe("2026-08-22T09:59:00.000Z");
    expect(JSON.stringify(result)).not.toContain("j_private123");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("uses unknown values instead of publishing malformed operational labels", () => {
    const result = sanitizeLiveRun({
      status: "  ",
      trigger: "provider:raw-secret",
      rowCount: -1,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-08-22T12:00:00Z"),
      report: {
        provider: {
          kind: "bright_data_dca",
          status: "waiting",
          attempts: 1,
          submittedAt: "not-a-timestamp",
          lastPollAt: "2026-08-22T12:01:00Z",
        },
      },
    });

    expect(result.status).toBe("unknown");
    expect(result.trigger).toBe("unknown");
    expect(result).not.toHaveProperty("errorCode");
    expect(result.rowCounts.collected).toBeNull();
    expect(result.stages.collect).toBe("in_progress");
  });

  it.each([
    "job:pulse.provider.poll",
    "job:pulse.collect.provider-poll",
    "job:pulse.collect.sample.extra",
    "job:pulse.collect.discovery/secret",
  ])("does not publish provider-like or near-match trigger %s", (trigger) => {
    const result = sanitizeLiveRun({
      status: "running",
      trigger,
      rowCount: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-08-22T12:00:00Z"),
      report: null,
    });

    expect(result.trigger).toBe("unknown");
  });

  it.each([
    "job:pulse.collect.sample",
    "job:pulse.collect.discovery",
    "job:pulse.heal.verify",
  ])("preserves known public trigger %s", (trigger) => {
    const result = sanitizeLiveRun({
      status: "running",
      trigger,
      rowCount: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-08-22T12:00:00Z"),
      report: null,
    });

    expect(result.trigger).toBe(trigger);
  });
});
