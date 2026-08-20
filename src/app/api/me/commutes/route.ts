import type { CommuteService } from "@/domain/commute/service";
import type { CurrentRider } from "@/server/commutes/runtime";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

type CommuteRouteDependencies = {
  readRider: (request: Request) => Promise<CurrentRider | null>;
  service: CommuteService;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

export function createCommutesGet(dependencies: CommuteRouteDependencies) {
  return async function GET(request: Request) {
    const rider = await dependencies.readRider(request);
    if (!rider) {
      return json(
        {
          code: "COMMUTE_AUTH_REQUIRED",
          message: "Sign in with Google to manage your trips.",
        },
        401,
      );
    }
    try {
      return json({
        commutes: await dependencies.service.listForRider(rider.userId),
      });
    } catch {
      return json(
        {
          code: "COMMUTE_UNAVAILABLE",
          message: "Your trips are unavailable right now.",
        },
        503,
      );
    }
  };
}

export async function GET(request: Request) {
  const [{ readCurrentRider, getCommuteService }] = await Promise.all([
    import("@/server/commutes/runtime"),
  ]);
  return createCommutesGet({
    readRider: readCurrentRider,
    service: await getCommuteService(),
  })(request);
}
