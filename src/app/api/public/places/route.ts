import {
  isValidPlaceSearch,
  MAX_PLACES_PER_TYPE,
  type PlaceChoice,
  type PlaceSearch,
  type TransitCatalog,
} from "@/domain/transit/catalog";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const selectionMessage = "Choose a place from the list.";
const emptyGroups = () => [
  { id: "nearby_stops", label: "Nearby stops", places: [] as PlaceChoice[] },
  { id: "stations", label: "Stations", places: [] as PlaceChoice[] },
  { id: "places", label: "Places", places: [] as PlaceChoice[] },
];

type PlacesRouteDependencies = {
  getCatalog: () => TransitCatalog | Promise<TransitCatalog>;
  readPlannerFlag: () => string | undefined;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function unavailable() {
  return json(
    {
      available: false,
      code: "PLACE_SEARCH_UNAVAILABLE",
      message: "Place search is unavailable right now.",
    },
    503,
  );
}

function parseSearch(request: Request): PlaceSearch | null {
  const parameters = new URL(request.url).searchParams;
  const queries = parameters.getAll("q");
  const latitudes = parameters.getAll("latitude");
  const longitudes = parameters.getAll("longitude");
  if (queries.length !== 1 || latitudes.length > 1 || longitudes.length > 1) {
    return null;
  }
  const query = queries[0]?.trim() ?? "";
  const hasLatitude = latitudes.length === 1;
  const hasLongitude = longitudes.length === 1;
  if (hasLatitude !== hasLongitude) return null;
  const search: PlaceSearch = hasLatitude
    ? {
        query,
        latitude: Number(latitudes[0]),
        longitude: Number(longitudes[0]),
      }
    : { query };
  return isValidPlaceSearch(search) ? search : null;
}

export function createPlacesGet(dependencies: PlacesRouteDependencies) {
  return async function GET(request: Request) {
    if (dependencies.readPlannerFlag() !== "true") return unavailable();
    const search = parseSearch(request);
    if (!search) {
      return json(
        {
          groups: emptyGroups(),
          code: "PLACE_SEARCH_INVALID",
          message: selectionMessage,
        },
        400,
      );
    }
    try {
      const choices = await (
        await dependencies.getCatalog()
      ).searchPlaces(search);
      return json({
        groups: [
          {
            id: "nearby_stops",
            label: "Nearby stops",
            places: choices
              .filter((place) => place.type === "stop")
              .slice(0, MAX_PLACES_PER_TYPE),
          },
          {
            id: "stations",
            label: "Stations",
            places: choices
              .filter((place) => place.type === "station")
              .slice(0, MAX_PLACES_PER_TYPE),
          },
          {
            id: "places",
            label: "Places",
            places: choices
              .filter((place) => place.type === "landmark")
              .slice(0, MAX_PLACES_PER_TYPE),
          },
        ],
        message: selectionMessage,
      });
    } catch {
      return unavailable();
    }
  };
}

export const GET = createPlacesGet({
  getCatalog: async () =>
    (await import("@/server/transit/catalog")).getTransitCatalog(),
  readPlannerFlag: () => process.env.CITYWIDE_PLANNER_ENABLED,
});
