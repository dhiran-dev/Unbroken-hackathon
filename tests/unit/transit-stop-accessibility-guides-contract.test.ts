import { describe, expect, it } from "vitest";

import {
  readStopAccessibilityGuides,
  refreshStopAccessibilityGuides,
  type StopAccessibilityGuideCollection,
  type StopAccessibilityGuideRefreshAttempt,
  type StopAccessibilityGuideRefreshResult,
  type StopAccessibilityGuideStore,
  type StoredStopAccessibilityGuideSnapshot,
} from "@/server/transit/stop-accessibility-guides";
import {
  STOP_ACCESSIBILITY_SOURCE_URL,
  stopAccessibilityEnvelope,
} from "@/../tests/support/stop-accessibility-guides";

const COLLECTOR_ID = "c_mt0719p0vuntmudm6";
const START = new Date("2026-08-20T00:29:00.000Z");
const CHECKED = new Date("2026-08-20T00:30:00.000Z");

class ContractStore implements StopAccessibilityGuideStore {
  current: StoredStopAccessibilityGuideSnapshot | null = null;
  latest: {
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null = null;
  beforeApply: (() => void) | null = null;
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
    this.beforeApply?.();
    this.beforeApply = null;
    if (
      attempt.basedOnSnapshotId !== (this.current?.snapshotId ?? null) ||
      (this.current !== null && attempt.checkedAt < this.current.checkedAt)
    ) {
      return { status: "rejected", activeSnapshot: this.current };
    }
    if (attempt.status !== "validated") {
      this.latest = { status: attempt.status, checkedAt: attempt.checkedAt };
      return { status: attempt.status, activeSnapshot: this.current };
    }
    if (this.current?.payloadHash === attempt.payloadHash) {
      this.current = { ...this.current, checkedAt: attempt.checkedAt };
      this.history.set(attempt.payloadHash, this.current);
      this.latest = { status: "current", checkedAt: attempt.checkedAt };
      return { status: "unchanged", activeSnapshot: this.current };
    }
    const historical = this.history.get(attempt.payloadHash);
    if (historical) {
      this.current = { ...historical, checkedAt: attempt.checkedAt };
      this.history.set(attempt.payloadHash, this.current);
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

function collector(
  envelope: unknown = stopAccessibilityEnvelope(),
  overrides: Partial<StopAccessibilityGuideCollection> = {},
) {
  return {
    collect: async () => ({
      collectorId: COLLECTOR_ID,
      sourceUrl: STOP_ACCESSIBILITY_SOURCE_URL,
      collectedAt: CHECKED,
      datasetComplete: true,
      envelope,
      ...overrides,
    }),
  };
}

describe("stop accessibility guide contract", () => {
  it("normalizes source whitespace before exact prose validation", async () => {
    const store = new ContractStore();
    const accessibility_content = String(
      stopAccessibilityEnvelope().accessibility_content,
    )
      .replace("following Metro", "following\u00a0Metro")
      .replaceAll("\n", "\n\n\n");

    const result = await refreshStopAccessibilityGuides(
      { at: START },
      {
        collector: collector(
          stopAccessibilityEnvelope({ accessibility_content }),
        ),
        store,
      },
    );

    expect(result.status).toBe("promoted");
    expect(result.activeSnapshot?.guides).toHaveLength(52);
  });

  it("preserves order and repeated names while leaving an unknown name unmapped", async () => {
    const store = new ContractStore();
    const content = String(
      stopAccessibilityEnvelope().accessibility_content,
    ).replace(
      "San Jose and Randall streets (J, N)",
      "Unmapped platform name (J, N)",
    );
    const result = await refreshStopAccessibilityGuides(
      { at: START },
      {
        collector: collector(
          stopAccessibilityEnvelope({ accessibility_content: content }),
        ),
        store,
      },
    );
    const view = await readStopAccessibilityGuides({ at: CHECKED }, { store });

    expect(result.status).toBe("promoted");
    expect(view.guides.slice(10, 17).map((guide) => guide.routeNames)).toEqual([
      ["J", "N"],
      ["J"],
      ["J"],
      ["J"],
      ["J"],
      ["J"],
      ["J", "K"],
    ]);
    expect(view.guides[10]).toMatchObject({
      stationName: "Unmapped platform name",
      stopId: null,
      accessibilityState: "unknown",
    });
    expect(
      view.guides.filter(
        (guide) => guide.stationName === "West Portal Station",
      ),
    ).toHaveLength(3);
  });

  it("rejects reordered sections, additions, contraction, and malformed routes", async () => {
    const valid = String(stopAccessibilityEnvelope().accessibility_content);
    const mutations = [
      valid
        .replace("J CHURCH ACCESSIBILITY:", "TEMP HEADING")
        .replace("K INGLESIDE ACCESSIBILITY:", "J CHURCH ACCESSIBILITY:")
        .replace("TEMP HEADING", "K INGLESIDE ACCESSIBILITY:"),
      `${valid}\nAn unexpected extra stop (N)`,
      valid.replace("Church and 18th streets (J, K)\n", ""),
      valid.replace(
        "San Jose and Randall streets (J, N)",
        "San Jose and Randall streets (X, N)",
      ),
      valid.replace(
        "San Jose and Randall streets (J, N)",
        "San Jose and Randall streets (J, T)",
      ),
    ];

    for (const accessibility_content of mutations) {
      const store = new ContractStore();
      const result = await refreshStopAccessibilityGuides(
        { at: START },
        {
          collector: collector(
            stopAccessibilityEnvelope({ accessibility_content }),
          ),
          store,
        },
      );
      expect(result).toMatchObject({
        status: "rejected",
        activeSnapshot: null,
      });
    }
  });

  it("rejects a repeated stop within one route section", async () => {
    const accessibility_content = String(
      stopAccessibilityEnvelope().accessibility_content,
    ).replace("Church and 30th streets (J)", "Church and 29th streets (J)");
    const store = new ContractStore();

    const result = await refreshStopAccessibilityGuides(
      { at: START },
      {
        collector: collector(
          stopAccessibilityEnvelope({ accessibility_content }),
        ),
        store,
      },
    );

    expect(result.status).toBe("rejected");
  });

  it("rejects HTML, control characters, blank entries, and overlong content", async () => {
    const valid = String(stopAccessibilityEnvelope().accessibility_content);
    const mutations = [
      valid.replace(
        "West Portal Station (K, L, M)",
        "<script>alert(1)</script> (K, L, M)",
      ),
      valid.replace(
        "West Portal Station (K, L, M)",
        "West\u0007 Portal Station (K, L, M)",
      ),
      valid.replace("West Portal Station (K, L, M)", " (K, L, M)"),
      `${valid}${"x".repeat(8_001)}`,
    ];

    for (const accessibility_content of mutations) {
      const store = new ContractStore();
      const result = await refreshStopAccessibilityGuides(
        { at: START },
        {
          collector: collector(
            stopAccessibilityEnvelope({ accessibility_content }),
          ),
          store,
        },
      );
      expect(result.status).toBe("rejected");
    }
  });

  it("rejects incomplete collection and changed collector, URL, input, title, or shape", async () => {
    const cases: Array<{
      envelope?: unknown;
      overrides?: Partial<StopAccessibilityGuideCollection>;
    }> = [
      { overrides: { datasetComplete: false } },
      { overrides: { collectorId: "c_other" } },
      { overrides: { sourceUrl: `${STOP_ACCESSIBILITY_SOURCE_URL}/wrong` } },
      {
        envelope: stopAccessibilityEnvelope({
          input: { url: `${STOP_ACCESSIBILITY_SOURCE_URL}/wrong` },
        }),
      },
      { envelope: stopAccessibilityEnvelope({ page_title: "Other page" }) },
      {
        envelope: stopAccessibilityEnvelope({
          product_page_url: `${STOP_ACCESSIBILITY_SOURCE_URL}?changed=1`,
        }),
      },
      {
        envelope: stopAccessibilityEnvelope({
          source_url: `${STOP_ACCESSIBILITY_SOURCE_URL}#changed`,
        }),
      },
      {
        envelope: { ...stopAccessibilityEnvelope(), unexpected: "drift" },
      },
    ];

    for (const testCase of cases) {
      const store = new ContractStore();
      const result = await refreshStopAccessibilityGuides(
        { at: START },
        {
          collector: collector(
            testCase.envelope ?? stopAccessibilityEnvelope(),
            testCase.overrides,
          ),
          store,
        },
      );
      expect(result.status).toBe("rejected");
    }
  });

  it("rejects malformed or implausible scrape and collection times", async () => {
    const cases: Array<{
      envelope: unknown;
      overrides?: Partial<StopAccessibilityGuideCollection>;
    }> = [
      {
        envelope: stopAccessibilityEnvelope({ scraped_at: "August 20, 2026" }),
      },
      {
        envelope: stopAccessibilityEnvelope({
          scraped_at: "2026-02-30T00:30:00.000Z",
        }),
      },
      {
        envelope: stopAccessibilityEnvelope({
          scraped_at: "2026-08-20T00:50:00.000Z",
        }),
      },
      {
        envelope: stopAccessibilityEnvelope(),
        overrides: { collectedAt: new Date("2026-08-20T00:45:00.000Z") },
      },
      {
        envelope: stopAccessibilityEnvelope(),
        overrides: { collectedAt: new Date("2026-08-20T00:20:00.000Z") },
      },
    ];

    for (const testCase of cases) {
      const store = new ContractStore();
      const result = await refreshStopAccessibilityGuides(
        { at: START },
        {
          collector: collector(testCase.envelope, testCase.overrides),
          store,
        },
      );
      expect(result.status).toBe("rejected");
    }
  });

  it("revalidates unchanged content at the collector completion time", async () => {
    const store = new ContractStore();
    const first = await refreshStopAccessibilityGuides(
      { at: START },
      { collector: collector(), store },
    );
    const later = new Date("2026-08-20T01:00:00.000Z");
    const second = await refreshStopAccessibilityGuides(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: collector(
          stopAccessibilityEnvelope({ scraped_at: later.toISOString() }),
          { collectedAt: later },
        ),
        store,
      },
    );

    expect(first.status).toBe("promoted");
    expect(second.status).toBe("unchanged");
    expect(second.activeSnapshot?.checkedAt).toEqual(later);
    expect(second.activeSnapshot?.sourceUpdatedAt).toBeNull();
    expect(second.activeSnapshot?.payloadHash).toBe(
      first.activeSnapshot?.payloadHash,
    );
  });

  it("retains trusted guidance as older after rejected and unavailable checks", async () => {
    const store = new ContractStore();
    await refreshStopAccessibilityGuides(
      { at: START },
      { collector: collector(), store },
    );
    const rejected = await refreshStopAccessibilityGuides(
      { at: new Date("2026-08-20T01:00:00.000Z") },
      {
        collector: collector(
          stopAccessibilityEnvelope({ page_title: "Changed" }),
          { collectedAt: new Date("2026-08-20T01:01:00.000Z") },
        ),
        store,
      },
    );
    const afterRejected = await readStopAccessibilityGuides(
      { at: new Date("2026-08-20T01:02:00.000Z") },
      { store },
    );
    expect(rejected.status).toBe("rejected");
    expect(afterRejected.state).toBe("older");
    expect(afterRejected.guides).toHaveLength(52);

    const unavailable = await refreshStopAccessibilityGuides(
      { at: new Date("2026-08-20T02:00:00.000Z") },
      {
        collector: {
          collect: async () => Promise.reject(new Error("private")),
        },
        store,
      },
    );
    expect(unavailable.status).toBe("unavailable");
    expect(JSON.stringify(unavailable)).not.toContain("private");
    expect(
      (
        await readStopAccessibilityGuides(
          { at: new Date("2026-08-20T02:01:00.000Z") },
          { store },
        )
      ).state,
    ).toBe("older");
  });

  it("rejects a stale baseline and preserves a concurrent trusted snapshot", async () => {
    const store = new ContractStore();
    await refreshStopAccessibilityGuides(
      { at: START },
      { collector: collector(), store },
    );
    const newer = {
      ...store.current!,
      snapshotId: "concurrent-snapshot",
      payloadHash: "concurrent-hash",
      checkedAt: new Date("2026-08-20T00:31:00.000Z"),
    };
    store.beforeApply = () => {
      store.current = newer;
    };
    const result = await refreshStopAccessibilityGuides(
      { at: new Date("2026-08-20T00:31:00.000Z") },
      {
        collector: collector(
          stopAccessibilityEnvelope({
            scraped_at: "2026-08-20T00:32:00.000Z",
          }),
          { collectedAt: new Date("2026-08-20T00:32:00.000Z") },
        ),
        store,
      },
    );
    expect(result.status).toBe("rejected");
    expect(result.activeSnapshot?.snapshotId).toBe("concurrent-snapshot");
  });

  it("reactivates a previously verified A snapshot after B", async () => {
    const store = new ContractStore();
    const a = stopAccessibilityEnvelope();
    const b = stopAccessibilityEnvelope({
      accessibility_content: String(a.accessibility_content).replace(
        "San Jose and Randall streets (J, N)",
        "San Jose and Randall changed platform (J, N)",
      ),
      scraped_at: "2026-08-20T01:00:00.000Z",
    });
    const first = await refreshStopAccessibilityGuides(
      { at: START },
      { collector: collector(a), store },
    );
    const second = await refreshStopAccessibilityGuides(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: collector(b, {
          collectedAt: new Date("2026-08-20T01:00:00.000Z"),
        }),
        store,
      },
    );
    const thirdTime = new Date("2026-08-20T02:00:00.000Z");
    const third = await refreshStopAccessibilityGuides(
      { at: new Date("2026-08-20T01:59:00.000Z") },
      {
        collector: collector(
          stopAccessibilityEnvelope({ scraped_at: thirdTime.toISOString() }),
          { collectedAt: thirdTime },
        ),
        store,
      },
    );

    expect([first.status, second.status, third.status]).toEqual([
      "promoted",
      "promoted",
      "promoted",
    ]);
    expect(third.activeSnapshot?.snapshotId).toBe(
      first.activeSnapshot?.snapshotId,
    );
  });

  it("reports unavailable without a snapshot and becomes older after 36 hours", async () => {
    const store = new ContractStore();
    expect(
      await readStopAccessibilityGuides({ at: CHECKED }, { store }),
    ).toEqual({
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: STOP_ACCESSIBILITY_SOURCE_URL,
      guides: [],
    });
    await refreshStopAccessibilityGuides(
      { at: START },
      { collector: collector(), store },
    );
    expect(
      (
        await readStopAccessibilityGuides(
          { at: new Date("2026-08-21T12:30:00.000Z") },
          { store },
        )
      ).state,
    ).toBe("current");
    expect(
      (
        await readStopAccessibilityGuides(
          { at: new Date("2026-08-21T12:30:00.001Z") },
          { store },
        )
      ).state,
    ).toBe("older");
  });
});
