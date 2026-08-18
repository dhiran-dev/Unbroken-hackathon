export const operatorRoles = ["owner", "admin"] as const;

export type UserRole = (typeof operatorRoles)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === "string" && operatorRoles.includes(value as UserRole);
}

export function canManageAccounts(role: UserRole): boolean {
  return role === "owner";
}
