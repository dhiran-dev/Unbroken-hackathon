import { describe, expect, it } from "vitest";

import {
  COMPARE_STORAGE_KEY,
  LAST_SEEN_STORAGE_KEY,
  MY_DAY_STORAGE_KEY,
  PREFERENCES_STORAGE_KEY,
  PULSERANK_LOCAL_STATE_PREFIX,
  PULSERANK_LOCAL_STATE_VERSION,
  SAVED_PRODUCTS_STORAGE_KEY,
} from "@/lib/local-state/keys";

describe("local-state keys", () => {
  it("exposes the exact namespaced constants", () => {
    expect(PREFERENCES_STORAGE_KEY).toBe("pulserank:v1:preferences");
    expect(SAVED_PRODUCTS_STORAGE_KEY).toBe("pulserank:v1:saved-products");
    expect(COMPARE_STORAGE_KEY).toBe("pulserank:v1:compare");
    expect(MY_DAY_STORAGE_KEY).toBe("pulserank:v1:my-day");
    expect(LAST_SEEN_STORAGE_KEY).toBe("pulserank:v1:last-seen");
  });

  it("keeps every key under pulserank:v1 and never under unbroken:*", () => {
    const keys = [
      PREFERENCES_STORAGE_KEY,
      SAVED_PRODUCTS_STORAGE_KEY,
      COMPARE_STORAGE_KEY,
      MY_DAY_STORAGE_KEY,
      LAST_SEEN_STORAGE_KEY,
    ];
    for (const key of keys) {
      expect(key.startsWith(`${PULSERANK_LOCAL_STATE_PREFIX}:`)).toBe(true);
      expect(key.startsWith("unbroken:")).toBe(false);
    }
  });

  it("pins the local-state schema version", () => {
    expect(PULSERANK_LOCAL_STATE_VERSION).toBe(1);
    expect(PULSERANK_LOCAL_STATE_PREFIX).toBe("pulserank:v1");
  });
});
