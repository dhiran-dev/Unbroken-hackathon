import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/0003_rider_accounts.sql", "utf8");
const snapshot = readFileSync("drizzle/meta/0003_snapshot.json", "utf8");

describe("rider account migration seam", () => {
  it("adds the rider default without changing existing operator rows", () => {
    expect(migration).toContain(
      'ALTER TABLE "user" ALTER COLUMN "role" SET DEFAULT \'rider\'',
    );
  });

  it("creates the fixed-capacity policy and ten-minute reservation tables", () => {
    expect(migration).toContain('CREATE TABLE "rider_profiles"');
    expect(migration).toContain('CREATE TABLE "signup_capacity"');
    expect(migration).toContain('CREATE TABLE "signup_reservations"');
    expect(migration).toContain("DEFAULT 40");
    expect(migration).toContain("DEFAULT 'open'");
    expect(migration).toContain("email_circuit_state");
    expect(migration).toContain(
      `CHECK ("active_accounts" + "reserved_accounts" <= "max_accounts")`,
    );
    expect(snapshot).toContain("signup_capacity_within_cap_ck");
    expect(migration).toContain("INTERVAL '10 minutes'");
    expect(migration).toContain('CHECK ("id" = 1)');
  });

  it("keeps later admission foreign keys and expiry indexes safe", () => {
    expect(migration).toContain('REFERENCES "user"("id") ON DELETE CASCADE');
    expect(migration).toContain('REFERENCES "user"("id") ON DELETE SET NULL');
    expect(migration).toContain("signup_reservations_expiry_idx");
    expect(migration).toContain("signup_reservations_status_expiry_idx");
  });
});
