import { describe, expect, it } from "vitest";

import {
  readStopAccessibilityGuides,
  refreshStopAccessibilityGuides,
  type StopAccessibilityGuideRefreshAttempt,
  type StopAccessibilityGuideRefreshResult,
  type StopAccessibilityGuideStore,
  type StoredStopAccessibilityGuideSnapshot,
} from "@/server/transit/stop-accessibility-guides";
import {
  STOP_ACCESSIBILITY_SOURCE_URL,
  UNDERGROUND_GUIDANCE,
  stopAccessibilityEnvelope,
} from "@/../tests/support/stop-accessibility-guides";

const COLLECTOR_ID = "c_mt0719p0vuntmudm6";
const START = new Date("2026-08-20T00:29:00.000Z");
const CHECKED = new Date("2026-08-20T00:30:00.000Z");

class MemoryStore implements StopAccessibilityGuideStore {
  current: StoredStopAccessibilityGuideSnapshot | null = null;
  latest: {
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null = null;
  private history = new Map<string, StoredStopAccessibilityGuideSnapshot>();
  private sequence = 0;

  async getCurrentSnapshot() {
    return this.current;
  }

  async getLatestAttempt() {
    return this.latest;
  }

  async applyRefreshAttempt(
    attempt: StopAccessibilityGuideRefreshAttempt,
  ): Promise<StopAccessibilityGuideRefreshResult> {
    if (attempt.basedOnSnapshotId !== (this.current?.snapshotId ?? null)) {
      return { status: "rejected", activeSnapshot: this.current };
    }
    if (attempt.status !== "validated") {
      this.latest = { status: attempt.status, checkedAt: attempt.checkedAt };
      return { status: attempt.status, activeSnapshot: this.current };
    }
    const historical = this.history.get(attempt.payloadHash);
    if (historical) {
      this.current = {
        ...historical,
        checkedAt: attempt.checkedAt,
      };
      this.latest = { status: "current", checkedAt: attempt.checkedAt };
      return { status: "promoted", activeSnapshot: this.current };
    }
    const snapshot: StoredStopAccessibilityGuideSnapshot = {
      snapshotId: `snapshot-${++this.sequence}`,
      payloadHash: attempt.payloadHash,
      structuralFingerprint: attempt.structuralFingerprint,
      checkedAt: attempt.checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: attempt.sourceUrl,
      guides: attempt.guides,
    };
    this.current = snapshot;
    this.history.set(attempt.payloadHash, snapshot);
    this.latest = { status: "current", checkedAt: attempt.checkedAt };
    return { status: "promoted", activeSnapshot: snapshot };
  }
}

function collector(envelope: unknown = stopAccessibilityEnvelope()) {
  return {
    collect: async () => ({
      collectorId: COLLECTOR_ID,
      sourceUrl: STOP_ACCESSIBILITY_SOURCE_URL,
      collectedAt: CHECKED,
      datasetComplete: true,
      envelope,
    }),
  };
}

describe("stop accessibility guide refresh and public read", () => {
  it("publishes all reviewed official guidance without inferring stop IDs or status", async () => {
    const store = new MemoryStore();

    const result = await refreshStopAccessibilityGuides(
      { at: START },
      { collector: collector(), store },
    );
    const view = await readStopAccessibilityGuides(
      { at: new Date("2026-08-20T01:00:00.000Z") },
      { store },
    );

    expect(result.status).toBe("promoted");
    expect(view.guides).toHaveLength(52);
    expect(view).toMatchObject({
      state: "current",
      checkedAt: CHECKED,
      sourceUpdatedAt: null,
      sourceUrl: STOP_ACCESSIBILITY_SOURCE_URL,
    });
    expect(view.guides.slice(0, 10).map((guide) => guide.stationName)).toEqual([
      "Embarcadero",
      "Montgomery",
      "Powell",
      "Civic Center",
      "Van Ness",
      "Church Street",
      "Castro Street",
      "Forest Hill",
      "Chinatown-Rose-Pak",
      "Union Square-Market Street",
    ]);
    expect(view.guides[0]).toEqual({
      stationName: "Embarcadero",
      stopId: null,
      routeNames: ["Muni Metro"],
      guidance: UNDERGROUND_GUIDANCE,
      accessibilityState: "unknown",
      reviewed: true,
      publicUrl: STOP_ACCESSIBILITY_SOURCE_URL,
    });
    expect(
      view.guides.filter(
        (guide) => guide.stationName === "West Portal Station",
      ),
    ).toHaveLength(3);
    expect(view.guides.at(-1)).toMatchObject({
      stationName: "T Third between Chinatown and Sunnydale",
      routeNames: ["T"],
      accessibilityState: "unknown",
      reviewed: true,
    });
    expect(JSON.stringify(view)).not.toMatch(
      /wheelchair-safe|scraped_at|input|applicant/i,
    );
  });
});
