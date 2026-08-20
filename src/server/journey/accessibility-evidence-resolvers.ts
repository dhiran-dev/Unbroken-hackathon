import { createHash } from "node:crypto";
import type {
  ExactAccessibilityAdvisory,
  ExactStopRelocation,
} from "@/domain/journey/accessibility-evidence";
import type { AccessibilityAdvisoryView } from "@/server/transit/accessibility-advisories";
import type { StopRelocationView } from "@/server/transit/stop-relocations";

export type ActiveTransitEntities = {
  snapshotId: string;
  stops: Array<{ stopId: string; stopName: string }>;
  routeIds: string[];
};

export type ActiveTransitEntitiesReader =
  () => Promise<ActiveTransitEntities | null>;

export type ActiveTransitEntitiesStore = {
  getActiveSnapshotId(): Promise<string | null>;
  load(snapshotId: string): Promise<ActiveTransitEntities | null>;
};

function copyActive(value: ActiveTransitEntities): ActiveTransitEntities {
  return {
    snapshotId: value.snapshotId,
    stops: value.stops.map((stop) => ({ ...stop })),
    routeIds: [...value.routeIds],
  };
}

export function createActiveTransitEntitiesReader(
  store: ActiveTransitEntitiesStore,
): ActiveTransitEntitiesReader {
  let cache: ActiveTransitEntities | null = null;
  let loading: {
    snapshotId: string;
    promise: Promise<ActiveTransitEntities | null>;
  } | null = null;

  return async () => {
    const snapshotId = await store.getActiveSnapshotId();
    if (!snapshotId) return null;
    if (cache?.snapshotId === snapshotId) return copyActive(cache);
    if (!loading || loading.snapshotId !== snapshotId) {
      const promise = (async () => {
        const loaded = await store.load(snapshotId);
        if (!loaded || loaded.snapshotId !== snapshotId) return null;
        if ((await store.getActiveSnapshotId()) !== snapshotId) return null;
        cache = copyActive(loaded);
        return copyActive(cache);
      })();
      loading = { snapshotId, promise };
      const clear = () => {
        if (loading?.promise === promise) loading = null;
      };
      void promise.then(clear, clear);
    }
    const loaded = await loading.promise;
    return loaded ? copyActive(loaded) : null;
  };
}

const REVIEWED_ADVISORY_ROUTES: Readonly<Record<string, string>> = {
  "1 California": "1",
  "12 Folsom/Pacific": "12",
  "14 Mission": "14",
  "14R Mission Rapid": "14R",
  "15 Bayview Hunters Point Express": "15",
  "18 46th Avenue": "18",
  "19 Polk": "19",
  "1X California Express": "1X",
  "2 Sutter": "2",
  "22 Fillmore": "22",
  "23 Monterey": "23",
  "24 Divisadero": "24",
  "25 Treasure Island": "25",
  "27 Bryant": "27",
  "28R 19th Avenue Rapid": "28R",
  "29 Sunset": "29",
  "30 Stockton": "30",
  "30X Marina Express": "30X",
  "31 Balboa": "31",
  "33 Ashbury/18th Street": "33",
  "35 Eureka": "35",
  "36 Teresita": "36",
  "37 Corbett": "37",
  "38 Geary": "38",
  "38R Geary Rapid": "38R",
  "39 Coit": "39",
  "43 Masonic": "43",
  "44 O'Shaughnessy": "44",
  "45 Union/Stockton": "45",
  "48 Quintara/24th Street": "48",
  "49 Van Ness/Mission": "49",
  "5 Fulton": "5",
  "52 Excelsior": "52",
  "54 Felton": "54",
  "56 Rutland": "56",
  "57 Parkmerced": "57",
  "58 Lake Merced": "58",
  "5R Fulton Rapid": "5R",
  "6 Hayes/Parnassus": "6",
  "66 Quintara": "66",
  "7 Haight/Noriega": "7",
  "8 Bayshore": "8",
  "8AX Bayshore A Express": "8AX",
  "8BX Bayshore B Express": "8BX",
  "9 San Bruno": "9",
  "91 3rd Street/19th Avenue Owl": "91",
  "9R San Bruno Rapid": "9R",
  "California Cable Car": "CA",
  "Powell / Hyde Cable Car": "PH",
  "Powell / Mason Cable Car": "PM",
  "J Church": "J",
  "K Ingleside": "K",
  "L Taraval": "L",
  "M Ocean View": "M",
  "N Judah": "N",
  "S Shuttle": "S",
  "T Third Street": "T",
  "T Third Street Bus": "TBUS",
};

const exactStopLabel = /^(.*) \(#([A-Za-z0-9][A-Za-z0-9:._-]{0,127})\)$/u;
const exactRelocationRoute =
  /^(?:Inbound|Outbound) ([A-Za-z0-9][A-Za-z0-9:._-]{0,127})$/u;

function unique(values: string[]) {
  return [...new Set(values)].sort();
}

function sameDate(left: Date | null, right: Date | null) {
  return left === null
    ? right === null
    : right !== null && left.getTime() === right.getTime();
}

function relocationIdentity(row: StopRelocationView["relocations"][number]) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        row.stopId,
        row.routeNames,
        row.temporaryStop,
        row.startsAt.toISOString(),
        row.endsAt.toISOString(),
      ]),
    )
    .digest("hex");
}

export function createExactAccessibilityResolvers(
  readActive: ActiveTransitEntitiesReader,
) {
  return {
    async resolveAdvisories(
      view: AccessibilityAdvisoryView,
    ): Promise<ExactAccessibilityAdvisory[] | null> {
      const active = await readActive();
      if (!active) return null;
      const routes = new Set(active.routeIds);
      const stops = new Map(
        active.stops.map((stop) => [stop.stopId, stop.stopName]),
      );
      const advisoryIds = new Set<string>();
      const resolved: ExactAccessibilityAdvisory[] = [];
      for (const advisory of view.advisories) {
        if (advisoryIds.has(advisory.advisoryId)) return null;
        advisoryIds.add(advisory.advisoryId);
        const stopIds: string[] = [];
        for (const label of advisory.affectedStops) {
          const match = exactStopLabel.exec(label);
          const stopName = match?.[1];
          const stopId = match?.[2];
          if (!stopName || !stopId || stops.get(stopId) !== stopName)
            return null;
          stopIds.push(stopId);
        }
        const routeIds: string[] = [];
        for (const label of advisory.affectedRoutes) {
          const routeId = REVIEWED_ADVISORY_ROUTES[label];
          if (!routeId) return null;
          if (routes.has(routeId)) routeIds.push(routeId);
        }
        if (stopIds.length === 0 && routeIds.length === 0) return null;
        resolved.push({
          advisoryId: advisory.advisoryId,
          stopIds: unique(stopIds),
          routeIds: unique(routeIds),
          startsAt: advisory.startsAt ? new Date(advisory.startsAt) : null,
          endsAt: advisory.endsAt ? new Date(advisory.endsAt) : null,
        });
      }
      return resolved;
    },

    async resolveRelocations(
      view: StopRelocationView,
    ): Promise<ExactStopRelocation[] | null> {
      const active = await readActive();
      if (!active) return null;
      const routes = new Set(active.routeIds);
      const stops = new Set(active.stops.map((stop) => stop.stopId));
      const identities = new Set<string>();
      const resolved: ExactStopRelocation[] = [];
      for (const relocation of view.relocations) {
        if (!stops.has(relocation.stopId)) return null;
        const routeIds: string[] = [];
        for (const label of relocation.routeNames) {
          const match = exactRelocationRoute.exec(label);
          const routeId = match?.[1];
          if (!routeId || !routes.has(routeId)) return null;
          routeIds.push(routeId);
        }
        if (routeIds.length === 0) return null;
        const identity = relocationIdentity(relocation);
        if (identities.has(identity)) return null;
        identities.add(identity);
        resolved.push({
          relocationId: `relocation:${identity}`,
          stopId: relocation.stopId,
          routeIds: unique(routeIds),
          startsAt: new Date(relocation.startsAt),
          endsAt: new Date(relocation.endsAt),
        });
      }
      return resolved;
    },
  };
}

export { REVIEWED_ADVISORY_ROUTES, sameDate };
