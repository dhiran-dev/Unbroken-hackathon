import { afterEach, describe, expect, it, vi } from "vitest";

import {
  FIREWORKS_API_BASE_URL,
  PRODUCTION_COLLECTOR_ID,
  PRODUCTION_SOURCE_URL,
  isAllowedProductionDatabaseUrl,
  isSecureProductionAuthUrl,
} from "@/lib/env";

afterEach(() => vi.unstubAllEnvs());

describe("production integration invariants", () => {
  it("keeps the exact collector, source, and Fireworks endpoint", () => {
    expect(PRODUCTION_COLLECTOR_ID).toBe("c_msyjsllt1r9ej5tdub");
    expect(PRODUCTION_SOURCE_URL).toBe("https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod");
    expect(FIREWORKS_API_BASE_URL).toBe("https://api.fireworks.ai/inference/v1");
  });

  it("accepts the exact owner-authorized endpoint and secure TLS modes", () => {
    expect(
      isAllowedProductionDatabaseUrl(
        "postgres://u:p@46.225.216.222:5432/unbroken_staging",
      ),
    ).toBe(true);
    expect(
      isAllowedProductionDatabaseUrl(
        "postgres://u:p@db/app?sslmode=require",
      ),
    ).toBe(true);
  });

  it("rejects all other non-TLS endpoints and explicit weak modes", () => {
    expect(isAllowedProductionDatabaseUrl("postgres://u:p@db/app")).toBe(false);
    for (const sslMode of ["disable", "prefer", "allow"]) {
      expect(
        isAllowedProductionDatabaseUrl(
          `postgres://u:p@46.225.216.222:5432/unbroken_staging?sslmode=${sslMode}`,
        ),
      ).toBe(false);
    }
    expect(isAllowedProductionDatabaseUrl("https://db.example/app")).toBe(
      false,
    );
  });

  it("requires HTTPS for production authentication", () => {
    expect(isSecureProductionAuthUrl("https://unbroken.example")).toBe(true);
    expect(isSecureProductionAuthUrl("http://localhost:3000")).toBe(false);
  });
});

describe("job lease policy", () => {
  it("does not recover a lease renewed between stale scan and update", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-0123456789-0123456789");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const { JOB_LEASE_RENEWAL_INTERVAL_MS, JOB_LEASE_TIMEOUT_MS, isJobLeaseExpired } = await import("@/server/jobs/queue");
    const now = new Date("2026-08-19T00:00:00.000Z");
    expect(JOB_LEASE_TIMEOUT_MS).toBeGreaterThan(11 * 60 * 1_000);
    expect(JOB_LEASE_RENEWAL_INTERVAL_MS).toBeLessThan(JOB_LEASE_TIMEOUT_MS);
    expect(isJobLeaseExpired(new Date(now.getTime() - JOB_LEASE_TIMEOUT_MS), now)).toBe(true);
    expect(isJobLeaseExpired(new Date(now.getTime() - JOB_LEASE_TIMEOUT_MS + 1), now)).toBe(false);
    const renewedLease = new Date(now.getTime() - JOB_LEASE_RENEWAL_INTERVAL_MS);
    expect(isJobLeaseExpired(renewedLease, now)).toBe(false);
    expect(isJobLeaseExpired(null, now)).toBe(false);
  });
});
