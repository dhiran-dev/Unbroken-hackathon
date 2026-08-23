import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = unknown;

const harness = vi.hoisted(() => ({
  results: [] as QueryResult[],
  selectCalls: 0,
  whereCalls: 0,
}));

function nextResult(): QueryResult {
  return harness.results.shift() ?? [];
}

function queryChain() {
  const result = nextResult();
  const chain = {
    from() { return chain; },
    innerJoin() { return chain; },
    leftJoin() { return chain; },
    where() { harness.whereCalls += 1; return chain; },
    groupBy() { return chain; },
    orderBy() { return chain; },
    limit() { return chain; },
    then(resolve: (value: QueryResult) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return chain;
}

vi.mock("@/server/db/client", () => ({
  db: {
    select() {
      harness.selectCalls += 1;
      return queryChain();
    },
  },
}));

const { getLeaderboard, getLeaderboardFacets, getTrustedProductsBySlugs } =
  await import("@/server/products/queries");

const SNAPSHOT_ID = "11111111-1111-4111-8111-111111111111";

function rankedRow(rank: number) {
  return {
    productId: `22222222-2222-4222-8222-${String(rank).padStart(12, "0")}`,
    rank,
    metricKey: "highest-total-caffeine",
    metricValue: 1000 - rank,
    eligible: true,
    eligibilityFlags: ["value_exact"],
    productSlug: `late-${rank}`,
    productName: `Late match ${rank}`,
    productCategory: "coffee",
  };
}

describe("leaderboard query flow", () => {
  beforeEach(() => {
    harness.results = [];
    harness.selectCalls = 0;
    harness.whereCalls = 0;
  });

  it("keeps filtered pagination stable when matching rows begin after rank 200", async () => {
    harness.results = [
      [{ id: SNAPSHOT_ID, rebuiltAt: new Date("2026-08-22T12:00:00Z"), summary: { boardKey: "highest-total-caffeine", trustedProductCount: 400 } }],
      [],
      Array.from({ length: 8 }, (_, index) => rankedRow(201 + index)),
      [{ totalCount: 207 }],
    ];

    const result = await getLeaderboard("highest-total-caffeine", {
      limit: 7,
      category: "coffee",
      servingForm: "drink",
      completeOnly: true,
    });

    expect(result?.entries.map((entry) => entry.rank)).toEqual([201, 202, 203, 204, 205, 206, 207]);
    expect(result?.nextCursor).toBeTruthy();
    expect(harness.selectCalls).toBe(4);
    expect(harness.whereCalls).toBeGreaterThanOrEqual(4);
  });

  it("traverses a v2 cursor past rank 200 without renumbering snapshot ranks", async () => {
    harness.results = [
      [{ id: SNAPSHOT_ID, rebuiltAt: new Date("2026-08-22T12:00:00Z"), summary: { boardKey: "highest-total-caffeine", trustedProductCount: 400 } }],
      [],
      Array.from({ length: 201 }, (_, index) => rankedRow(index + 1)),
      [{ totalCount: 400 }],
    ];
    const firstPage = await getLeaderboard("highest-total-caffeine", {
      limit: 200,
      category: "coffee",
    });
    expect(firstPage?.entries.at(-1)?.rank).toBe(200);
    expect(firstPage?.nextCursor).toBeTruthy();

    harness.results = [
      [{ id: SNAPSHOT_ID, rebuiltAt: new Date("2026-08-22T12:00:00Z"), summary: { boardKey: "highest-total-caffeine", trustedProductCount: 400 } }],
      [],
      Array.from({ length: 8 }, (_, index) => rankedRow(index + 201)),
      [{ totalCount: 400 }],
    ];
    const secondPage = await getLeaderboard("highest-total-caffeine", {
      limit: 7,
      cursor: firstPage?.nextCursor,
      category: "coffee",
    });
    expect(secondPage?.entries.map((entry) => entry.rank)).toEqual([201, 202, 203, 204, 205, 206, 207]);
  });

  it("uses bounded aggregate facets and slug enrichment instead of catalog pages", async () => {
    harness.results = [
      [{ eligibleCount: 12, excludedCount: 3 }],
      [
        { label: "Conflicting values", count: 2 },
        { label: "Not published", count: 1 },
      ],
      [{ form: "drink" }, { form: "shot" }],
    ];
    const facets = await getLeaderboardFacets("highest-total-caffeine");
    expect(facets).toEqual({
      eligibleCount: 12,
      excludedCount: 3,
      reasons: [
        { label: "Conflicting values", count: 2 },
        { label: "Not published", count: 1 },
      ],
      servingForms: ["drink", "shot"],
    });
    expect(harness.selectCalls).toBe(3);

    harness.results = [[]];
    harness.selectCalls = 0;
    await getTrustedProductsBySlugs(["a", "b", "a"]);
    expect(harness.selectCalls).toBe(1);
  });
});
