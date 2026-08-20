import {
  getPublicCitywideStatus,
  filterPublicCitywideStatus,
} from "@/server/citywide-status/status-runtime";
import type {
  PublicCitywideStatus,
  PublicCitywideStatusFilter,
  PublicCitywideStatusView,
  PublicStatusState,
} from "@/server/citywide-status/public-citywide-status";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const unavailableResponse = {
  available: false,
  code: "PUBLIC_STATUS_UNAVAILABLE",
  message: "Current status information is unavailable right now.",
} as const;
const statusTypes = new Set<PublicCitywideStatusFilter["type"]>([
  "all",
  "elevators",
  "advisories",
  "relocations",
  "guides",
  "alerts",
]);
const statusStates = new Set<PublicStatusState | "all">([
  "all",
  "current",
  "older",
  "unavailable",
]);

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function boundedSingleParameter(parameters: URLSearchParams, name: string) {
  const values = parameters.getAll(name);
  return values.length === 1 ? values[0]!.slice(0, 80) : "";
}

export function parsePublicStatusFilter(
  request: Request,
): PublicCitywideStatusFilter {
  const parameters = new URL(request.url).searchParams;
  const rawQuery = boundedSingleParameter(parameters, "q");
  const rawType = boundedSingleParameter(parameters, "type");
  const rawState = boundedSingleParameter(parameters, "state");
  return {
    query: rawQuery.trim(),
    type: statusTypes.has(rawType as PublicCitywideStatusFilter["type"])
      ? (rawType as PublicCitywideStatusFilter["type"])
      : "all",
    state: statusStates.has(rawState as PublicStatusState | "all")
      ? (rawState as PublicStatusState | "all")
      : "all",
  };
}

type PublicStatusRouteDependencies = {
  getStatus: () => PublicCitywideStatus | Promise<PublicCitywideStatus>;
  readPlannerFlag: () => string | undefined;
  clock?: () => Date;
};

export function createPublicStatusGet(
  dependencies: PublicStatusRouteDependencies,
) {
  return async function GET(request: Request) {
    try {
      if (dependencies.readPlannerFlag() !== "true")
        return json(unavailableResponse, 503);
      const status = await dependencies.getStatus();
      const now = dependencies.clock?.() ?? new Date();
      const view: PublicCitywideStatusView = await status.read(now);
      const filtered = filterPublicCitywideStatus(
        view,
        parsePublicStatusFilter(request),
      );
      return json({ available: true, ...filtered });
    } catch {
      return json(unavailableResponse, 503);
    }
  };
}

export const GET = createPublicStatusGet({
  getStatus: getPublicCitywideStatus,
  readPlannerFlag: () => process.env.CITYWIDE_PLANNER_ENABLED,
});
