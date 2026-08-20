import type { CommuteService } from "@/domain/commute/service";
import { isRiderRole } from "@/server/auth/roles";

export type CurrentRider = { userId: string; role: "rider" };

function isSafeSessionUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 255 &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

export async function readCurrentRider(
  request: Request,
): Promise<CurrentRider | null> {
  try {
    const { auth } = await import("@/server/auth");
    const session = await auth.api.getSession({ headers: request.headers });
    if (
      !session ||
      !isRiderRole(session.user.role) ||
      !isSafeSessionUserId(session.user.id)
    ) {
      return null;
    }
    return { userId: session.user.id, role: "rider" };
  } catch {
    return null;
  }
}

let service: CommuteService | null = null;

export async function getCommuteService(): Promise<CommuteService> {
  if (service) return service;
  const [
    { getTransitCatalog },
    { createCommuteService },
    { PostgresCommuteScheduleStore },
  ] = await Promise.all([
    import("@/server/transit/catalog"),
    import("@/domain/commute/service"),
    import("@/server/commutes/service"),
  ]);
  service = createCommuteService(
    new PostgresCommuteScheduleStore(),
    getTransitCatalog(),
  );
  return service;
}
