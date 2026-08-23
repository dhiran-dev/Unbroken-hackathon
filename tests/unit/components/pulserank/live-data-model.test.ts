import { describe, expect, it } from "vitest";

import type { LiveDataStats } from "@/server/products/queries";

import {
  chartPoints,
  formatRelative,
  pipelineStages,
  runStateCounts,
  summaryCards,
} from "@/components/pulserank/live-data/live-data-model";

const stats: LiveDataStats = {
  schemaVersion: "1.1",
  observationCounts: {
    trusted: 12,
    candidate: 3,
    quarantined: 1,
    rejected: 0,
    superseded: 2,
  },
  lastCollectionRunAt: "2026-08-23T10:00:00.000Z",
  openIncidentCount: 1,
  trustedProductCount: 8,
  freshness: {
    latestTrustedObservationAt: "2026-08-23T09:58:00.000Z",
    latestSuccessfulCollectionAt: "2026-08-23T10:00:00.000Z",
  },
  activeCollectors: [{ source: "Synthetic source" }],
  lastCollectionRun: {
    status: "succeeded",
    trigger: "job:pulse.collect",
    rowCount: 20,
    at: "2026-08-23T10:00:00.000Z",
  },
  recentRuns: [
    {
      status: "succeeded",
      trigger: "job:pulse.collect",
      startedAt: "2026-08-23T09:59:00.000Z",
      finishedAt: "2026-08-23T10:00:00.000Z",
      createdAt: "2026-08-23T09:58:00.000Z",
      stages: {
        submit: "not_applicable",
        collect: "complete",
        land: "complete",
        ingest: "complete",
        validate: "passed",
        promote: "complete",
        rebuild: "complete",
      },
      rowCounts: {
        collected: 20,
        input: 20,
        stored: 20,
        parsed: 19,
        promoted: 8,
        warnings: 1,
      },
    },
  ],
};

describe("live data view model", () => {
  it("maps summary values to trusted stats and leaves derived quality unpublished", () => {
    const cards = summaryCards(stats);

    expect(cards.map(({ label, value }) => [label, value])).toEqual([
      ["Products tracked", "8"],
      ["Trusted snapshots", "12"],
      ["Sources active", "1"],
      ["Open incidents", "1"],
      ["Quality score", "Not published"],
    ]);
    expect(cards.at(-1)?.detail).toContain("no derived score");
  });

  it("keeps future timestamps honest instead of calling them recent", () => {
    expect(formatRelative("2026-08-23T12:01:00.000Z", new Date("2026-08-23T12:00:00.000Z"))).toBe("In 1 min");
  });

  it("does not turn missing run evidence into a positive pipeline state", () => {
    const missingRun = { ...stats, recentRuns: [], lastCollectionRun: null };
    const stages = pipelineStages(missingRun);

    expect(stages.every((stage) => stage.status === "Not available")).toBe(true);
    expect(stages.every((stage) => stage.tone === "muted")).toBe(true);
  });

  it("plots only reported row counts from sanitized run timestamps", () => {
    const [point] = chartPoints(stats);
    expect(point?.value).toBe(20);
    expect(point?.timestamp).toBe("2026-08-23T10:00:00.000Z");

    const withoutCount: LiveDataStats = {
      ...stats,
      recentRuns: [{ ...stats.recentRuns[0]!, rowCounts: { ...stats.recentRuns[0]!.rowCounts, collected: null } }],
    };
    expect(chartPoints(withoutCount)).toEqual([]);
  });

  it("keeps unknown run states out of the in-progress bucket", () => {
    const counts = runStateCounts({
      ...stats,
      recentRuns: [{ ...stats.recentRuns[0]!, status: "cancelled" }],
    });
    expect(counts).toEqual({ completed: 0, inProgress: 0, needsAttention: 0, unknown: 1 });
  });
});
