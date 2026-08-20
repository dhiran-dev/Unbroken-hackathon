export const userRoles = ["owner", "admin", "rider"] as const;

export type UserRole = (typeof userRoles)[number];

export const operatorRoles = ["owner", "admin"] as const;

export type OperatorRole = (typeof operatorRoles)[number];

export const operatorCapabilities = [
  "operate",
  "manage_accounts",
  "manage_security",
] as const;

export type OperatorCapability = (typeof operatorCapabilities)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && userRoles.includes(value as UserRole);
}

export function isOperatorRole(value: unknown): value is OperatorRole {
  return (
    typeof value === "string" && operatorRoles.includes(value as OperatorRole)
  );
}

export function isRiderRole(value: unknown): value is "rider" {
  return value === "rider";
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
  if (!isOperatorRole(role)) return false;
  if (capability === "operate") return true;
  if (capability === "manage_accounts") return canManageAccounts(role);
  return canManageSecurity(role);
}
