import { ACCESSIBILITY_ADVISORY_SOURCE_URL } from "@/server/transit/accessibility-advisories";
import { STOP_ACCESSIBILITY_GUIDE_SOURCE_URL } from "@/server/transit/stop-accessibility-guides";
import { STOP_RELOCATION_SOURCE_URL } from "@/server/transit/stop-relocations";
import {
  ELEVATOR_SOURCE_URL,
  REALTIME_SOURCE_URL,
  createPublicCitywideStatus,
  type PublicCitywideStatus,
  type PublicCitywideStatusReads,
  type PublicCitywideStatusView,
  type PublicStatusSection,
  type PublicStatusState,
  type PublicCitywideStatusFilter,
} from "./public-citywide-status";

const EMPTY_SUMMARY = "No current changes.";
const OLDER_SUMMARY = "Older information is shown.";
const UNAVAILABLE_SUMMARY = "Current information is unavailable.";

function safeQuery(value: string) {
  return value.trim().slice(0, 80).toLocaleLowerCase();
}

/** Shared bounded query/filter projection for the API and server page. */
export function filterPublicCitywideStatus(
  view: PublicCitywideStatusView,
  filter: PublicCitywideStatusFilter,
): PublicCitywideStatusView {
  const query = safeQuery(filter.query);
  const selected = (name: PublicCitywideStatusFilter["type"]) =>
    filter.type === "all" || filter.type === name;
  const sourceStateMatches = (source: PublicStatusState) =>
    filter.state === "all" || source === filter.state;
  const matches = (value: string) =>
    query.length === 0 || value.toLocaleLowerCase().includes(query);

  const stations =
    selected("elevators") && sourceStateMatches(view.elevators.state)
      ? view.elevators.stations
          .filter(
            (station) =>
              matches(station.name) ||
              station.elevators.some((elevator) => matches(elevator.name)),
          )
          .map((station) => {
            const stationNameMatches = matches(station.name);
            return {
              ...station,
              elevators:
                query.length === 0 || stationNameMatches
                  ? station.elevators
                  : station.elevators.filter((elevator) =>
                      matches(elevator.name),
                    ),
            };
          })
      : [];
  const counts = { accessible: 0, limited: 0, unavailable: 0, unknown: 0 };
  for (const station of stations) counts[station.state] += 1;

  function sectionItems<T extends Record<string, unknown>>(
    name: Exclude<PublicCitywideStatusFilter["type"], "all" | "elevators">,
    section: PublicStatusSection<T>,
    haystack: (item: T) => string,
  ): PublicStatusSection<T> {
    const items =
      selected(name) && sourceStateMatches(section.state)
        ? section.items.filter((item) => matches(haystack(item)))
        : [];
    return {
      ...section,
      count: items.length,
      summary:
        section.state === "unavailable"
          ? UNAVAILABLE_SUMMARY
          : section.state === "older"
            ? OLDER_SUMMARY
            : items.length === 0
              ? EMPTY_SUMMARY
              : section.summary,
      items,
    };
  }

  return {
    elevators: {
      ...view.elevators,
      stations,
      count: stations.length,
      counts,
      summary:
        view.elevators.state === "unavailable"
          ? UNAVAILABLE_SUMMARY
          : view.elevators.state === "older"
            ? OLDER_SUMMARY
            : stations.length === 0
              ? EMPTY_SUMMARY
              : view.elevators.summary,
    },
    advisories: sectionItems(
      "advisories",
      view.advisories,
      (item) =>
        `${item.title} ${item.affectedRoutes.join(" ")} ${item.affectedStops.join(" ")}`,
    ),
    relocations: sectionItems(
      "relocations",
      view.relocations,
      (item) =>
        `${item.stopName} ${item.routeNames.join(" ")} ${item.temporaryStop} ${item.scheduleText} ${item.boardingInstruction}`,
    ),
    guides: sectionItems(
      "guides",
      view.guides,
      (item) =>
        `${item.stationName} ${item.routeNames.join(" ")} ${item.guidance}`,
    ),
    alerts: sectionItems(
      "alerts",
      view.alerts,
      (item) =>
        `${item.header} ${item.effect ?? ""} ${item.routeIds.join(" ")} ${item.stopIds.join(" ")}`,
    ),
  };
}

let configuredStatus: PublicCitywideStatus | undefined;
let statusLoading: Promise<PublicCitywideStatus> | undefined;

/** Lazily wires trusted read adapters; it never starts a collector or poll. */
export async function getPublicCitywideStatus(): Promise<PublicCitywideStatus> {
  if (configuredStatus) return configuredStatus;
  statusLoading ??= Promise.all([
    import("@/server/journey/accessibility-evidence-production"),
    import("@/server/transit/accessibility-advisory-store"),
    import("@/server/transit/accessibility-advisories"),
    import("@/server/transit/stop-relocation-store"),
    import("@/server/transit/stop-relocations"),
    import("@/server/transit/stop-accessibility-guide-store"),
    import("@/server/transit/stop-accessibility-guides"),
    import("@/server/transit/realtime-store"),
  ])
    .then(
      async ([
        elevatorModule,
        advisoryStoreModule,
        advisoryModule,
        relocationStoreModule,
        relocationModule,
        guideStoreModule,
        guideModule,
        realtimeStoreModule,
      ]) => {
        const advisoryStore =
          new advisoryStoreModule.PostgresAccessibilityAdvisoryStore();
        const relocationStore =
          new relocationStoreModule.PostgresStopRelocationStore();
        const guideStore =
          new guideStoreModule.PostgresStopAccessibilityGuideStore();
        const realtimeStore =
          new realtimeStoreModule.PostgresRealtimeSnapshotStore();
        const dependencies: PublicCitywideStatusReads = {
          readElevators: elevatorModule.readAccessibilityElevators,
          readAdvisories: (at) =>
            advisoryModule.readAccessibilityAdvisories(
              { at },
              { store: advisoryStore },
            ),
          readRelocations: (at) =>
            relocationModule.readStopRelocations(
              { at },
              { store: relocationStore },
            ),
          readGuides: (at) =>
            guideModule.readStopAccessibilityGuides(
              { at },
              { store: guideStore },
            ),
          readRealtimeAlerts: async (at) => {
            const snapshot = await realtimeStore.getTrustedSnapshot(
              "alerts",
              at,
            );
            if (!snapshot) {
              return {
                state: "unavailable",
                checkedAt: null,
                sourceUpdatedAt: null,
                sourceUrl: REALTIME_SOURCE_URL,
                alerts: [],
              };
            }
            return {
              state: "current",
              checkedAt: snapshot.checkedAt,
              sourceUpdatedAt: snapshot.sourceUpdatedAt,
              sourceUrl: REALTIME_SOURCE_URL,
              alerts: snapshot.alerts,
            };
          },
        };
        return createPublicCitywideStatus(dependencies);
      },
    )
    .then((status) => {
      configuredStatus = status;
      return status;
    })
    .catch((error: unknown) => {
      statusLoading = undefined;
      throw error;
    });
  return statusLoading;
}

export {
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  STOP_RELOCATION_SOURCE_URL,
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  ELEVATOR_SOURCE_URL,
  REALTIME_SOURCE_URL,
};
