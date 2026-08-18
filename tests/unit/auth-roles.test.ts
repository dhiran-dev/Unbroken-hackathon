import { describe, expect, it } from "vitest";

import { canManageAccounts, isUserRole } from "@/server/auth/roles";

describe("operator roles", () => {
  it("accepts only owner and admin", () => {
    expect(isUserRole("owner")).toBe(true);
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("user")).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
  });

  it("reserves account management for the owner", () => {
    expect(canManageAccounts("owner")).toBe(true);
    expect(canManageAccounts("admin")).toBe(false);
  });
});
