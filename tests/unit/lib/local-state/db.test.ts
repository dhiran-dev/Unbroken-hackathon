import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MY_DAY_STORE,
  PULSERANK_DB_NAME,
  PULSERANK_DB_VERSION,
  RECENTLY_VIEWED_STORE,
  SAVED_PRODUCTS_SAVED_AT_INDEX,
  SAVED_PRODUCTS_STORE,
  isIndexedDbAvailable,
  requestToPromise,
  transactionToPromise,
  withDatabase,
} from "@/lib/local-state/db";
import { uninstallBrowserStorage } from "./mock-storage";

interface GlobalWithIdb {
  indexedDB?: unknown;
}

/** Minimal IDBRequest stand-in whose callbacks the test fires manually. */
function fakeRequest<T>(result: T): { request: IDBRequest<T>; succeed: () => void; fail: () => void } {
  const fake = {
    onsuccess: null as (() => void) | null,
    onerror: null as (() => void) | null,
    result,
  };
  return {
    request: fake as unknown as IDBRequest<T>,
    succeed: () => fake.onsuccess?.(),
    fail: () => fake.onerror?.(),
  };
}

/** Minimal IDBTransaction stand-in whose callbacks the test fires manually. */
function fakeTransaction(): {
  transaction: IDBTransaction;
  complete: () => void;
  abort: () => void;
} {
  const fake = {
    oncomplete: null as (() => void) | null,
    onabort: null as (() => void) | null,
    onerror: null as (() => void) | null,
    error: null as Error | null,
  };
  return {
    transaction: fake as unknown as IDBTransaction,
    complete: () => fake.oncomplete?.(),
    abort: () => {
      fake.error = new Error("aborted");
      fake.onabort?.();
    },
  };
}

describe("db plumbing", () => {
  beforeEach(() => {
    delete (globalThis as GlobalWithIdb).indexedDB;
    uninstallBrowserStorage();
  });

  afterEach(() => {
    delete (globalThis as GlobalWithIdb).indexedDB;
  });

  it("exposes the single shared database identity and store names", () => {
    expect(PULSERANK_DB_NAME).toBe("pulserank");
    expect(PULSERANK_DB_VERSION).toBe(1);
    expect(SAVED_PRODUCTS_STORE).toBe("saved-products");
    expect(MY_DAY_STORE).toBe("my-day");
    expect(RECENTLY_VIEWED_STORE).toBe("recently-viewed");
    expect(SAVED_PRODUCTS_SAVED_AT_INDEX).toBe("savedAt");
  });

  describe("isIndexedDbAvailable", () => {
    it("is false without indexedDB (SSR) and true when one exists", () => {
      expect(isIndexedDbAvailable()).toBe(false);
      (globalThis as GlobalWithIdb).indexedDB = {};
      expect(isIndexedDbAvailable()).toBe(true);
    });
  });

  describe("withDatabase", () => {
    it("resolves null on the server instead of throwing", async () => {
      await expect(withDatabase()).resolves.toBeNull();
    });

    it("resolves null when indexedDB.open throws synchronously", async () => {
      (globalThis as GlobalWithIdb).indexedDB = {
        open(): IDBOpenDBRequest {
          throw new Error("open is not allowed");
        },
      };
      await expect(withDatabase()).resolves.toBeNull();
    });
  });

  describe("requestToPromise", () => {
    it("resolves with the request result on success", async () => {
      const { request, succeed } = fakeRequest({ slug: "celsius-original" });
      const pending = requestToPromise(request);
      succeed();
      await expect(pending).resolves.toEqual({ slug: "celsius-original" });
    });

    it("rejects with the request error", async () => {
      const fake = {
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        error: new Error("DataError") as Error | null,
      };
      const pending = requestToPromise(fake as unknown as IDBRequest<unknown>);
      const assertion = expect(pending).rejects.toThrow("DataError");
      // Fires the onerror handler requestToPromise assigned.
      fake.onerror?.();
      await assertion;
    });
  });

  describe("transactionToPromise", () => {
    it("resolves when the transaction completes", async () => {
      const { transaction, complete } = fakeTransaction();
      const pending = transactionToPromise(transaction);
      complete();
      await expect(pending).resolves.toBeUndefined();
    });

    it("rejects when the transaction aborts", async () => {
      const { transaction, abort } = fakeTransaction();
      const pending = transactionToPromise(transaction);
      const assertion = expect(pending).rejects.toThrow("aborted");
      abort();
      await assertion;
    });
  });
});
