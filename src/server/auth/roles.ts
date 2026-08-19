export const operatorRoles = ["owner", "admin"] as const;

export type UserRole = (typeof operatorRoles)[number];

export const operatorCapabilities = [
  "operate",
  "manage_accounts",
  "manage_security",
] as const;

export type OperatorCapability = (typeof operatorCapabilities)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && operatorRoles.includes(value as UserRole);
}

export function canManageAccounts(role: UserRole): boolean {
  return role === "owner";
}

export function canManageSecurity(role: UserRole): boolean {
  return role === "owner";
}

export function canPerformOperatorAction(
  role: UserRole,
  capability: OperatorCapability,
): boolean {
  if (capability === "operate") return true;
  if (capability === "manage_accounts") return canManageAccounts(role);
  return canManageSecurity(role);
}
