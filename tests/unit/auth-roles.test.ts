import { describe, expect, it } from "vitest";

import {
  canManageAccounts,
  canManageSecurity,
  canPerformOperatorAction,
  isOperatorRole,
  isUserRole,
} from "@/server/auth/roles";

describe("operator roles", () => {
  it("accepts only owner and admin", () => {
    expect(isUserRole("owner")).toBe(true);
    expect(isUserRole("admin")).toBe(true);
    expect(isUserRole("user")).toBe(false);
    expect(isUserRole(undefined)).toBe(false);
  });

  it("accepts riders as users without treating them as operators", () => {
    expect(isUserRole("rider")).toBe(true);
    expect(isOperatorRole("rider")).toBe(false);
    expect(canPerformOperatorAction("rider", "operate")).toBe(false);
  });

  it("reserves account management for the owner", () => {
    expect(canManageAccounts("owner")).toBe(true);
    expect(canManageAccounts("admin")).toBe(false);
  });

  it("keeps operator actions available to owners and admins", () => {
    expect(canPerformOperatorAction("owner", "operate")).toBe(true);
    expect(canPerformOperatorAction("admin", "operate")).toBe(true);
  });

  it("reserves accounts and security for the owner", () => {
    expect(canManageSecurity("owner")).toBe(true);
    expect(canManageSecurity("admin")).toBe(false);
    expect(canPerformOperatorAction("owner", "manage_accounts")).toBe(true);
    expect(canPerformOperatorAction("admin", "manage_accounts")).toBe(false);
    expect(canPerformOperatorAction("admin", "manage_security")).toBe(false);
  });
});
