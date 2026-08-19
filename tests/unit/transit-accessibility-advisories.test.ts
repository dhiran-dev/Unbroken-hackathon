import { describe, expect, it } from "vitest";

import {
  ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  readAccessibilityAdvisories,
  refreshAccessibilityAdvisories,
  type AccessibilityAdvisoryCollection,
  type AccessibilityAdvisoryStore,
  type AccessibilityRefreshAttempt,
  type AccessibilityRefreshResult,
  type StoredAccessibilitySnapshot,
} from "@/server/transit/accessibility-advisories";
import {
  ACCESSIBILITY_SOURCE_URL,
  accessibilityAdvisoryRows,
} from "../support/accessibility-advisories";

class MemoryAdvisoryStore implements AccessibilityAdvisoryStore {
  attempts: AccessibilityRefreshAttempt[] = [];
  latest: {
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null;

  constructor(public current: StoredAccessibilitySnapshot | null = null) {
    this.latest = current
      ? { status: "current", checkedAt: current.checkedAt }
      : null;
  }

  async getCurrentSnapshot() {
    return this.current;
  }

  async getLatestAttempt() {
    return this.latest;
  }

  async applyRefreshAttempt(
    attempt: AccessibilityRefreshAttempt,
  ): Promise<AccessibilityRefreshResult> {
    this.attempts.push(attempt);
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
    const unchanged = this.current?.payloadHash === attempt.payloadHash;
    this.current = {
      snapshotId: unchanged ? this.current!.snapshotId : "snapshot-new",
      payloadHash: attempt.payloadHash,
      structuralFingerprint: attempt.structuralFingerprint,
      checkedAt: attempt.checkedAt,
      sourceUpdatedAt: null,
      sourceUrl: ACCESSIBILITY_ADVISORY_SOURCE_URL,
      advisories: attempt.advisories,
    };
    this.latest = { status: "current", checkedAt: attempt.checkedAt };
    return {
      status: unchanged ? "unchanged" : "promoted",
      activeSnapshot: this.current,
    };
  }
}

describe("accessibility advisory refresh", () => {
  it("publishes only normalized public facts from the fixed official source", async () => {
    const store = new MemoryAdvisoryStore();
    const rows = accessibilityAdvisoryRows();

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T17:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: [...rows].reverse(),
          }),
        },
        store,
      },
    );

    expect(result.activeSnapshot?.advisories).toHaveLength(11);
    expect(result).toMatchObject({
      status: "promoted",
      activeSnapshot: {
        checkedAt: new Date("2026-08-19T18:00:00.000Z"),
        sourceUpdatedAt: null,
        sourceUrl: ACCESSIBILITY_SOURCE_URL,
        advisories: expect.arrayContaining([
          {
            advisoryId: expect.stringMatching(/^advisory-[a-f0-9]{32}$/),
            title: "Accessibility change 1",
            description: "Use the marked boarding area for advisory 1.",
            affectedRoutes: ["Route 1"],
            affectedStops: [],
            startsAt: null,
            endsAt: null,
            publicUrl:
              "https://www.sfmta.com/travel-updates/accessibility-%E2%80%93-change-1",
          },
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("Downtown");
    expect(JSON.stringify(result)).not.toContain("input");
    expect(JSON.stringify(result)).not.toContain("collection");
    expect(store.attempts).toHaveLength(1);
  });

  it("rejects an incomplete collection without replacing trusted data", async () => {
    const prior: StoredAccessibilitySnapshot = {
      snapshotId: "snapshot-prior",
      payloadHash: "prior-hash",
      structuralFingerprint: "f".repeat(64),
      checkedAt: new Date("2026-08-19T16:30:00.000Z"),
      sourceUpdatedAt: null,
      sourceUrl: ACCESSIBILITY_SOURCE_URL,
      advisories: accessibilityAdvisoryRows().map((row, index) => ({
        advisoryId: `prior-${index}`,
        title: row.title,
        description: row.body_text,
        affectedRoutes: row.routes_affected,
        affectedStops: row.stops_affected,
        startsAt: null,
        endsAt: null,
        publicUrl: row.detail_url,
      })),
    };
    const store = new MemoryAdvisoryStore(prior);

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows().slice(0, 8),
          }),
        },
        store,
      },
    );

    expect(result).toEqual({ status: "rejected", activeSnapshot: prior });
    expect(store.current).toBe(prior);
    expect(store.attempts[0]).toMatchObject({
      status: "rejected",
      validationReport: {
        reasons: [expect.objectContaining({ code: "ROW_COUNT_TOO_LOW" })],
      },
    });
  });

  it("revalidates unchanged content and refreshes the checked time idempotently", async () => {
    const initialStore = new MemoryAdvisoryStore();
    let collectionNumber = 0;
    const dependencies = {
      collector: {
        collect: async () => {
          collectionNumber += 1;
          const rows = accessibilityAdvisoryRows();
          return {
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date(
              collectionNumber === 1
                ? "2026-08-19T18:00:00.000Z"
                : "2026-08-19T18:30:00.000Z",
            ),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: collectionNumber === 1 ? rows : [...rows].reverse(),
          };
        },
      },
      store: initialStore,
    };
    const first = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      dependencies,
    );
    const second = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:30:00.000Z") },
      dependencies,
    );

    expect(first.status).toBe("promoted");
    expect(second).toMatchObject({
      status: "unchanged",
      activeSnapshot: {
        payloadHash: first.activeSnapshot?.payloadHash,
        checkedAt: new Date("2026-08-19T18:30:00.000Z"),
      },
    });
    expect(initialStore.attempts).toHaveLength(2);
  });

  it("rejects a refresh based on a snapshot that lost a concurrent race", async () => {
    const store = new MemoryAdvisoryStore();
    const first = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows(),
          }),
        },
        store,
      },
    );
    expect(first.status).toBe("promoted");
    const concurrentWinner: StoredAccessibilitySnapshot = {
      ...first.activeSnapshot!,
      snapshotId: "snapshot-concurrent",
      payloadHash: "concurrent-hash",
      checkedAt: new Date("2026-08-19T18:20:00.000Z"),
    };

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:10:00.000Z") },
      {
        collector: {
          collect: async () => {
            store.current = concurrentWinner;
            return {
              collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
              sourceUrl: ACCESSIBILITY_SOURCE_URL,
              collectedAt: new Date("2026-08-19T18:00:00.000Z"),
              listingComplete: true,
              detailNavigationComplete: true,
              rows: accessibilityAdvisoryRows({ title: "A different change" }),
            };
          },
        },
        store,
      },
    );

    expect(result).toEqual({
      status: "rejected",
      activeSnapshot: concurrentWinner,
    });
    expect(store.current).toBe(concurrentWinner);
  });

  it("aggregates identity, layout, date, entity, duplicate, text, and URL failures safely", async () => {
    const rows: Array<Record<string, unknown>> = accessibilityAdvisoryRows();
    rows[0] = { ...rows[0], scraped_at: "not-a-date" };
    rows[1] = { ...rows[1], routes_affected: [], stops_affected: [] };
    rows[2] = {
      ...rows[2],
      detail_url: rows[3]!.detail_url,
      source_url: rows[3]!.detail_url,
      product_page_url: rows[3]!.detail_url,
    };
    rows[4] = { ...rows[4], unexpected_field: "layout drift" };
    rows[5] = { ...rows[5], detail_url: "javascript:alert(1)" };
    rows[6] = { ...rows[6], title: "   ", body_text: "" };
    rows[7] = { ...rows[7], relocation_rows: [{}] };
    rows[8] = { ...rows[8], service_affected: [] };
    rows[9] = { ...rows[9], source_url: rows[10]!.source_url };
    const store = new MemoryAdvisoryStore();

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: "wrong-collector",
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows,
          }),
        },
        store,
      },
    );

    expect(result).toEqual({ status: "rejected", activeSnapshot: null });
    const reasonCodes =
      store.attempts[0]?.status === "rejected"
        ? store.attempts[0].validationReport.reasons.map(
            (reason) => reason.code,
          )
        : [];
    expect(reasonCodes).toEqual(
      expect.arrayContaining([
        "COLLECTOR_ID_MISMATCH",
        "INVALID_SCRAPED_AT",
        "AFFECTED_ENTITY_MISSING",
        "DUPLICATE_ADVISORY",
        "ROW_SHAPE_CHANGED",
        "INVALID_DETAIL_URL",
        "INVALID_TEXT",
        "RELOCATION_ROWS_PRESENT",
        "ACCESSIBILITY_TAG_MISSING",
        "SOURCE_URL_MISMATCH",
      ]),
    );
    expect(JSON.stringify(store.attempts[0])).not.toContain("javascript:");
    expect(JSON.stringify(store.attempts[0])).not.toContain("example.com");
    expect(JSON.stringify(store.attempts[0])).not.toContain("layout drift");
  });

  it("sanitizes safe text and rejects stale collection times", async () => {
    const safeStore = new MemoryAdvisoryStore();
    const sanitized = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows({
              title: "<b>Lift</b> &amp; ramp",
              body_text: "<script>private()</script><p>Use the ramp.</p>",
            }),
          }),
        },
        store: safeStore,
      },
    );
    expect(sanitized.activeSnapshot?.advisories[0]).toMatchObject({
      title: "Lift & ramp",
      description: "Use the ramp.",
    });

    const stale = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T20:00:01.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T20:00:01.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows(),
          }),
        },
        store: safeStore,
      },
    );
    expect(stale.status).toBe("rejected");
    expect(safeStore.current).toBe(sanitized.activeSnapshot);
    expect(safeStore.attempts.at(-1)).toMatchObject({
      status: "rejected",
      validationReport: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "SCRAPE_TIME_IMPLAUSIBLE" }),
        ]),
      },
    });
  });

  it("keeps the absolute 11-row floor after a trusted baseline", async () => {
    const store = new MemoryAdvisoryStore();
    await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows(),
          }),
        },
        store,
      },
    );
    const contracted = accessibilityAdvisoryRows({
      scraped_at: "2026-08-19T18:20:00.000Z",
    }).slice(0, 9);

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:30:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:30:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: contracted,
          }),
        },
        store,
      },
    );

    expect(result.activeSnapshot?.advisories).toHaveLength(11);
    expect(result).toMatchObject({
      status: "rejected",
      activeSnapshot: { advisories: expect.any(Array) },
    });
  });

  it("reports current, older, and unavailable without confusing checked time with an SFMTA time", async () => {
    const emptyStore = new MemoryAdvisoryStore();
    await expect(
      readAccessibilityAdvisories(
        { at: new Date("2026-08-19T18:00:00.000Z") },
        { store: emptyStore },
      ),
    ).resolves.toEqual({
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: ACCESSIBILITY_SOURCE_URL,
      advisories: [],
    });

    await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:00:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows(),
          }),
        },
        store: emptyStore,
      },
    );
    expect(
      await readAccessibilityAdvisories(
        { at: new Date("2026-08-19T19:00:00.000Z") },
        { store: emptyStore },
      ),
    ).toMatchObject({
      state: "current",
      checkedAt: new Date("2026-08-19T18:00:00.000Z"),
      sourceUpdatedAt: null,
    });
    expect(
      await readAccessibilityAdvisories(
        { at: new Date("2026-08-19T19:30:01.000Z") },
        { store: emptyStore },
      ),
    ).toMatchObject({ state: "older", sourceUpdatedAt: null });

    const unavailable = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:30:00.000Z") },
      {
        collector: { collect: async () => Promise.reject(new Error("secret")) },
        store: emptyStore,
      },
    );
    expect(unavailable.status).toBe("unavailable");
    const afterFailure = await readAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:31:00.000Z") },
      { store: emptyStore },
    );
    expect(afterFailure.advisories).toHaveLength(11);
    expect(afterFailure).toMatchObject({
      state: "older",
      checkedAt: new Date("2026-08-19T18:00:00.000Z"),
      sourceUpdatedAt: null,
      advisories: expect.any(Array),
    });
    expect(JSON.stringify(unavailable)).not.toContain("secret");
  });

  it("rejects missing or incomplete listing and detail-navigation evidence", async () => {
    const cases = [
      {},
      { listingComplete: false, detailNavigationComplete: true },
      { listingComplete: true, detailNavigationComplete: false },
    ];

    for (const evidence of cases) {
      const store = new MemoryAdvisoryStore();
      const result = await refreshAccessibilityAdvisories(
        { at: new Date("2026-08-19T17:59:00.000Z") },
        {
          collector: {
            collect: async () =>
              ({
                collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
                sourceUrl: ACCESSIBILITY_SOURCE_URL,
                collectedAt: new Date("2026-08-19T18:00:00.000Z"),
                rows: accessibilityAdvisoryRows(),
                ...evidence,
              }) as AccessibilityAdvisoryCollection,
          },
          store,
        },
      );

      expect(result.status).toBe("rejected");
      expect(store.attempts[0]).toMatchObject({
        status: "rejected",
        checkedAt: new Date("2026-08-19T18:00:00.000Z"),
        validationReport: {
          reasons: expect.arrayContaining([
            expect.objectContaining({ code: "COLLECTION_INCOMPLETE" }),
          ]),
        },
      });
    }
  });

  it("rejects query, hash, userinfo, port, and overlong detail links", async () => {
    const rows: Array<Record<string, unknown>> = accessibilityAdvisoryRows();
    const unsafeUrls = [
      "https://www.sfmta.com/travel-updates/change?private=1",
      "https://www.sfmta.com/travel-updates/change#private",
      "https://user@www.sfmta.com/travel-updates/change",
      "https://www.sfmta.com:444/travel-updates/change",
      `https://www.sfmta.com/travel-updates/${"x".repeat(600)}`,
    ];
    unsafeUrls.forEach((url, index) => {
      rows[index] = {
        ...rows[index],
        detail_url: url,
        source_url: url,
        product_page_url: url,
      };
    });
    const store = new MemoryAdvisoryStore();

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T17:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows,
          }),
        },
        store,
      },
    );

    expect(result.status).toBe("rejected");
    const attempt = store.attempts[0];
    expect(
      attempt?.status === "rejected"
        ? attempt.validationReport.reasons.filter(
            (reason) => reason.code === "INVALID_DETAIL_URL",
          )
        : [],
    ).toHaveLength(5);
    expect(JSON.stringify(attempt)).not.toContain("private");
    expect(JSON.stringify(attempt)).not.toContain("user@");
  });

  it("accepts verified live description and affected-label bounds", async () => {
    const store = new MemoryAdvisoryStore();
    const routes = Array.from(
      { length: 51 },
      (_, index) => `Route ${index + 1}`,
    );

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T17:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows({
              body_text: "x".repeat(2_070),
              routes_affected: routes,
              stops_affected: [],
            }),
          }),
        },
        store,
      },
    );

    expect(result.status).toBe("promoted");
    expect(result.activeSnapshot?.checkedAt).toEqual(
      new Date("2026-08-19T18:00:00.000Z"),
    );
    expect(result.activeSnapshot?.advisories[0]?.description).toHaveLength(
      2_070,
    );
    expect(result.activeSnapshot?.advisories[0]?.affectedRoutes).toHaveLength(
      51,
    );
  });

  it("rejects an implausible collector completion time before it can replace trusted data", async () => {
    const store = new MemoryAdvisoryStore();
    const trusted = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T17:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T18:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows(),
          }),
        },
        store,
      },
    );

    const result = await refreshAccessibilityAdvisories(
      { at: new Date("2026-08-19T18:30:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: ACCESSIBILITY_ADVISORY_COLLECTOR_ID,
            sourceUrl: ACCESSIBILITY_SOURCE_URL,
            collectedAt: new Date("2026-08-19T19:00:00.000Z"),
            listingComplete: true,
            detailNavigationComplete: true,
            rows: accessibilityAdvisoryRows({
              title: "Untrusted future change",
            }),
          }),
        },
        store,
      },
    );

    expect(result).toEqual({
      status: "rejected",
      activeSnapshot: trusted.activeSnapshot,
    });
    expect(store.current).toBe(trusted.activeSnapshot);
    expect(store.attempts.at(-1)).toMatchObject({
      status: "rejected",
      checkedAt: new Date("2026-08-19T18:30:00.000Z"),
      validationReport: {
        reasons: [expect.objectContaining({ code: "COLLECTION_TIME_INVALID" })],
      },
    });
  });
});
