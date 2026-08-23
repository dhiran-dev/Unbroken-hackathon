import { afterEach, describe, expect, it, vi } from "vitest";

import { makeSavedProductRef } from "./fixtures";

const dbConstants = {
  SAVED_PRODUCTS_SAVED_AT_INDEX: "savedAt",
  SAVED_PRODUCTS_STORE: "saved-products",
  MY_DAY_DATE_INDEX: "date",
  MY_DAY_STORE: "my-day",
  RECENTLY_VIEWED_VIEWED_AT_INDEX: "viewedAt",
  RECENTLY_VIEWED_STORE: "recently-viewed",
};

function mockDatabase(rawRows: unknown[]) {
  const index = { getAll: () => ({}) };
  const objectStore = {
    index: () => index,
    getAll: () => ({}),
  };
  return {
    transaction: () => ({ objectStore: () => objectStore }),
    rawRows,
  };
}

async function importReader(modulePath: string, rows: unknown[]) {
  const database = mockDatabase(rows);
  vi.doMock("@/lib/local-state/db", () => ({
    ...dbConstants,
    withDatabase: async () => database,
    requestToPromise: async () => database.rawRows,
    transactionToPromise: async () => undefined,
  }));
  return import(modulePath);
}

describe("IndexedDB read sanitization", () => {
  afterEach(() => {
    vi.doUnmock("@/lib/local-state/db");
    vi.resetModules();
    delete (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange;
  });

  it("drops corrupted saved-product rows before the My Pulse shelf sees them", async () => {
    const valid = { ...makeSavedProductRef(), savedAt: 10 };
    const mod = await importReader("@/lib/local-state/saved-products", [valid, { slug: "bad" }, null]);
    await expect(mod.listSavedProducts()).resolves.toEqual([valid]);
  });

  it("drops corrupted My Day rows before totals or charts see them", async () => {
    (globalThis as { IDBKeyRange?: unknown }).IDBKeyRange = { only: (value: string) => value };
    const valid = {
      slug: "espresso",
      name: "Espresso",
      timeLabel: "08:00",
      caffeineMg: 75,
      id: "day-1",
      date: "2026-08-23",
      createdAt: 1,
    };
    const mod = await importReader("@/lib/local-state/my-day", [valid, { ...valid, caffeineMg: -1 }]);
    await expect(mod.listMyDayRecordsForDate("2026-08-23")).resolves.toEqual([valid]);
  });

  it("drops corrupted recent-view rows before the local history list is rendered", async () => {
    const ref = makeSavedProductRef({ slug: "espresso" });
    const valid = { slug: ref.slug, viewedAt: 10, ref };
    const mod = await importReader("@/lib/local-state/recently-viewed", [valid, { viewedAt: 11, ref: null }]);
    await expect(mod.listRecentlyViewed()).resolves.toEqual([valid]);
  });
});
