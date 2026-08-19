import type {
  PublicAccessibility,
  PublicElevator,
  PublicStation,
} from "./model";
import {
  REVIEWED_STATION_TOPOLOGY,
  type ReviewedStationTopology,
  type TravelDirection,
} from "./topology";

export type JourneyInstruction = {
  title: string;
  detail: string;
  elevators: string[];
};

export type JourneyAlternative = {
  title: string;
  detail: string;
  addedTime: string;
  originSlug: string;
  destinationSlug: string;
};

export type JourneyPlan = {
  available: boolean;
  title: string;
  summary: string;
  instructions: JourneyInstruction[];
  notices: string[];
  alternative?: JourneyAlternative;
};

type AccessSelection = {
  available: boolean;
  elevators: Array<{ stationName: string; elevator: PublicElevator }>;
  missing: string[];
  usedConnectedEntrance: boolean;
};

function travelDirection(
  network: ReviewedStationTopology["network"],
  fromOrder: number,
  toOrder: number,
): TravelDirection | null {
  if (fromOrder === toOrder) return null;
  if (network === "market") {
    return toOrder > fromOrder ? "westbound" : "eastbound";
  }
  return toOrder > fromOrder ? "southbound" : "northbound";
}

function workingAlternative(
  station: PublicStation,
  alternatives: readonly string[],
) {
  return alternatives
    .map((sourceKey) =>
      station.elevators.find((elevator) => elevator.sourceKey === sourceKey),
    )
    .find((elevator) => elevator?.state === "working");
}

function connectedEntranceSlug(slug: string) {
  if (slug === "powell") return "union-square-market-street";
  if (slug === "union-square-market-street") return "powell";
  return null;
}

function selectStationAccess(
  station: PublicStation,
  direction: TravelDirection | null,
  stationMap: Map<string, PublicStation>,
): AccessSelection {
  const topology = REVIEWED_STATION_TOPOLOGY[station.slug];
  if (
    !topology ||
    station.state === "unknown" ||
    station.state === "unavailable"
  ) {
    return {
      available: false,
      elevators: [],
      missing: ["Confirmed station access"],
      usedConnectedEntrance: false,
    };
  }

  const platformGroup =
    (direction ? topology[direction] : undefined) ?? topology.platform;
  const requiredGroups = [topology.street, platformGroup].filter(
    (group): group is NonNullable<typeof group> => Boolean(group),
  );
  const selected: AccessSelection["elevators"] = [];
  const missing: string[] = [];
  let usedConnectedEntrance = false;

  for (const group of requiredGroups) {
    const elevator = workingAlternative(station, group.alternatives);
    if (elevator) {
      selected.push({ stationName: station.name, elevator });
      continue;
    }

    if (group === topology.street) {
      const connectedSlug = connectedEntranceSlug(station.slug);
      const connectedStation = connectedSlug
        ? stationMap.get(connectedSlug)
        : undefined;
      const connectedStreet = connectedSlug
        ? REVIEWED_STATION_TOPOLOGY[connectedSlug]?.street
        : undefined;
      const connectedElevator =
        connectedStation && connectedStreet
          ? workingAlternative(connectedStation, connectedStreet.alternatives)
          : undefined;
      if (connectedStation && connectedElevator) {
        selected.push({
          stationName: connectedStation.name,
          elevator: connectedElevator,
        });
        usedConnectedEntrance = true;
        continue;
      }
    }

    missing.push(group.label);
  }

  return {
    available: requiredGroups.length > 0 && missing.length === 0,
    elevators: selected,
    missing,
    usedConnectedEntrance,
  };
}

function selectConnectionAccess(
  stationMap: Map<string, PublicStation>,
): AccessSelection {
  const selected: AccessSelection["elevators"] = [];
  const missing: string[] = [];

  for (const slug of ["powell", "union-square-market-street"] as const) {
    const station = stationMap.get(slug);
    const platformGroup = REVIEWED_STATION_TOPOLOGY[slug]?.platform;
    if (
      !station ||
      !platformGroup ||
      station.state === "unknown" ||
      station.state === "unavailable"
    ) {
      missing.push(
        slug === "powell"
          ? "Powell platform access"
          : "Union Square / Market Street platform access",
      );
      continue;
    }

    const elevator = workingAlternative(station, platformGroup.alternatives);
    if (!elevator) {
      missing.push(platformGroup.label);
      continue;
    }
    selected.push({ stationName: station.name, elevator });
  }

  return {
    available: missing.length === 0,
    elevators: selected,
    missing,
    usedConnectedEntrance: false,
  };
}

function routeSegments(origin: PublicStation, destination: PublicStation) {
  const originTopology = REVIEWED_STATION_TOPOLOGY[origin.slug];
  const destinationTopology = REVIEWED_STATION_TOPOLOGY[destination.slug];
  if (!originTopology || !destinationTopology) return null;

  if (originTopology.network === destinationTopology.network) {
    const direction = travelDirection(
      originTopology.network,
      origin.corridorOrder,
      destination.corridorOrder,
    );
    return {
      originDirection: direction,
      requiresConnection: false,
      destinationDirection: direction,
      instructions: direction
        ? [
            originTopology.network === "central"
              ? `Take a ${direction} T Third train.`
              : `Take a ${direction} Muni Metro train.`,
          ]
        : [],
    };
  }

  if (originTopology.network === "market") {
    return {
      requiresConnection: true,
      originDirection: travelDirection(
        "market",
        origin.corridorOrder,
        3,
      ),
      destinationDirection: travelDirection(
        "central",
        10,
        destination.corridorOrder,
      ),
      instructions: [
        "Take Muni Metro to Powell Station.",
        "Follow the step-free underground connection to Union Square / Market Street.",
        "Continue on the T Third toward your destination.",
      ],
    };
  }

  return {
    requiresConnection: true,
    originDirection: travelDirection("central", origin.corridorOrder, 10),
    destinationDirection: travelDirection(
      "market",
      3,
      destination.corridorOrder,
    ),
    instructions: [
      "Take the T Third to Union Square / Market Street.",
      "Follow the step-free underground connection to Powell Station.",
      "Continue on Muni Metro toward your destination.",
    ],
  };
}

function journeyEndpointsAreVerified(
  origin: PublicStation,
  destination: PublicStation,
  stationMap: Map<string, PublicStation>,
) {
  const segments = routeSegments(origin, destination);
  if (!segments) return false;
  const originAccess = selectStationAccess(
    origin,
    segments.originDirection,
    stationMap,
  );
  const destinationAccess = selectStationAccess(
    destination,
    segments.destinationDirection,
    stationMap,
  );
  const connectionAccess = segments.requiresConnection
    ? selectConnectionAccess(stationMap)
    : null;
  return (
    originAccess.available &&
    destinationAccess.available &&
    (!connectionAccess || connectionAccess.available)
  );
}

function findEndpointAlternative(
  origin: PublicStation,
  destination: PublicStation,
  stationMap: Map<string, PublicStation>,
  replace: "origin" | "destination",
): JourneyAlternative | undefined {
  const endpoint = replace === "origin" ? origin : destination;
  const endpointNetwork = REVIEWED_STATION_TOPOLOGY[endpoint.slug]?.network;
  if (!endpointNetwork) return undefined;

  const candidates = [...stationMap.values()]
    .filter((candidate) => {
      if (candidate.slug === origin.slug || candidate.slug === destination.slug) {
        return false;
      }
      if (
        candidate.state === "unknown" ||
        candidate.state === "unavailable"
      ) {
        return false;
      }
      return (
        REVIEWED_STATION_TOPOLOGY[candidate.slug]?.network === endpointNetwork
      );
    })
    .sort(
      (a, b) =>
        Math.abs(a.corridorOrder - endpoint.corridorOrder) -
        Math.abs(b.corridorOrder - endpoint.corridorOrder),
    );

  for (const candidate of candidates) {
    const alternativeOrigin = replace === "origin" ? candidate : origin;
    const alternativeDestination =
      replace === "destination" ? candidate : destination;
    if (
      !journeyEndpointsAreVerified(
        alternativeOrigin,
        alternativeDestination,
        stationMap,
      )
    ) {
      continue;
    }

    const stationsAway = Math.abs(
      candidate.corridorOrder - endpoint.corridorOrder,
    );
    return {
      title:
        replace === "origin"
          ? `Try starting at ${candidate.name}`
          : `Try ending at ${candidate.name}`,
      detail: `${candidate.name} is ${stationsAway} station${stationsAway === 1 ? "" : "s"} away on the same subway corridor and has a verified step-free station path.`,
      addedTime:
        "Allow extra time to reach the alternative station; walking time is not estimated.",
      originSlug: alternativeOrigin.slug,
      destinationSlug: alternativeDestination.slug,
    };
  }

  return undefined;
}

export function planJourney(
  originSlug: string,
  destinationSlug: string,
  accessibility: PublicAccessibility,
): JourneyPlan {
  const stationMap = new Map(
    accessibility.stations.map((station) => [station.slug, station]),
  );
  const origin = stationMap.get(originSlug);
  const destination = stationMap.get(destinationSlug);

  if (!origin || !destination) {
    return {
      available: false,
      title: "Choose both stations",
      summary: "Select a starting station and destination to see a step-free plan.",
      instructions: [],
      notices: [],
    };
  }
  if (origin.slug === destination.slug) {
    return {
      available: false,
      title: "Choose two different stations",
      summary: "Your starting station and destination need to be different.",
      instructions: [],
      notices: [],
    };
  }

  if (accessibility.trust.state === "older") {
    return {
      available: false,
      title: "We can’t confirm this trip right now",
      summary:
        "The latest verified elevator update is not current, so we cannot safely confirm a step-free route.",
      instructions: [],
      notices: [
        "Check SFMTA before travelling or try again after the next update.",
      ],
    };
  }

  const segments = routeSegments(origin, destination);
  if (!segments) {
    return {
      available: false,
      title: "We can’t confirm this trip",
      summary: "A reviewed step-free connection is not available for these stations.",
      instructions: [],
      notices: [],
    };
  }

  const originAccess = selectStationAccess(
    origin,
    segments.originDirection,
    stationMap,
  );
  const destinationAccess = selectStationAccess(
    destination,
    segments.destinationDirection,
    stationMap,
  );
  const connectionAccess = segments.requiresConnection
    ? selectConnectionAccess(stationMap)
    : null;
  const available =
    originAccess.available &&
    destinationAccess.available &&
    (!connectionAccess || connectionAccess.available);

  if (!available) {
    const unavailableAt = [
      !originAccess.available ? origin.name : null,
      !destinationAccess.available ? destination.name : null,
      connectionAccess && !connectionAccess.available
        ? "the Powell–Union Square connection"
        : null,
    ].filter((name): name is string => Boolean(name));
    const alternative =
      !originAccess.available && destinationAccess.available &&
      (!connectionAccess || connectionAccess.available)
        ? findEndpointAlternative(origin, destination, stationMap, "origin")
        : originAccess.available && !destinationAccess.available &&
            (!connectionAccess || connectionAccess.available)
          ? findEndpointAlternative(
              origin,
              destination,
              stationMap,
              "destination",
            )
          : undefined;
    return {
      available: false,
      title: "No confirmed step-free trip right now",
      summary: `Required elevator access is not confirmed at ${unavailableAt.join(" and ")}.`,
      instructions: [],
      notices: ["Check SFMTA before travelling or choose another station."],
      alternative,
    };
  }

  const notices: string[] = [];
  if (
    originAccess.usedConnectedEntrance ||
    destinationAccess.usedConnectedEntrance
  ) {
    notices.push(
      "Powell and Union Square / Market Street share a step-free underground connection, so a working entrance at either station can be used.",
    );
  }

  return {
    available: true,
    title: "A step-free station path is available",
    summary: `${origin.name} to ${destination.name}`,
    instructions: [
      {
        title: `Enter at ${origin.name}`,
        detail: "Use these working elevators to reach the platform.",
        elevators: originAccess.elevators.map(
          ({ stationName, elevator }) =>
            `${elevator.name}${stationName === origin.name ? "" : ` at ${stationName}`}`,
        ),
      },
      ...segments.instructions.map((detail, index) => ({
        title:
          index === 1 && segments.instructions.length === 3
            ? "Make the connection"
            : "Ride Muni",
        detail,
        elevators:
          index === 1 && connectionAccess
            ? connectionAccess.elevators.map(
                ({ stationName, elevator }) =>
                  `${elevator.name} at ${stationName}`,
              )
            : [],
      })),
      {
        title: `Exit at ${destination.name}`,
        detail: "Use these working elevators to reach street level.",
        elevators: destinationAccess.elevators.map(
          ({ stationName, elevator }) =>
            `${elevator.name}${stationName === destination.name ? "" : ` at ${stationName}`}`,
        ),
      },
    ],
    notices,
  };
}
