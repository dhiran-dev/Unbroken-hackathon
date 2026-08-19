const FACILITY_KEYS = [
  "street",
  "platform",
  "eastbound",
  "westbound",
  "northbound",
  "southbound",
] as const;

export type TravelDirection =
  | "eastbound"
  | "westbound"
  | "northbound"
  | "southbound";

type FacilityGroup = {
  label: string;
  alternatives: readonly string[];
};

export type ReviewedStationTopology = {
  network: "market" | "central";
  street?: FacilityGroup;
  platform?: FacilityGroup;
  eastbound?: FacilityGroup;
  westbound?: FacilityGroup;
  northbound?: FacilityGroup;
  southbound?: FacilityGroup;
};

// Manually reviewed against the fixed SFMTA equipment catalog. These are exact
// stable equipment identities, never guesses derived from elevator-name words.
// SFMTA confirms the underground stations use street-to-concourse and
// concourse-to-platform elevators, Church/Castro have direction-specific
// platform elevators, Central Subway stations have redundant elevators, and
// Powell connects to Union Square / Market Street at concourse level.
export const TOPOLOGY_REVIEWED_AT = "2026-08-19";

export const REVIEWED_STATION_TOPOLOGY: Record<
  string,
  ReviewedStationTopology
> = {
  embarcadero: {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: ["sfmta:daa531d64a3870d252a77ea3071cf48e"],
    },
    platform: {
      label: "Platform access",
      alternatives: ["sfmta:262500989db4b37e5599c0646b3b1514"],
    },
  },
  montgomery: {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: ["sfmta:ad36806b15e83e02c44614b61db96a11"],
    },
    platform: {
      label: "Platform access",
      alternatives: ["sfmta:98fffe110ab693e3e61a450eb40cf195"],
    },
  },
  powell: {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: [
        "sfmta:155fa9cd88ca1b910f173175e6d47c76",
        "sfmta:c3c5a5304402993b7c0e65b129cc4425",
      ],
    },
    platform: {
      label: "Platform access",
      alternatives: ["sfmta:98a3cedeeef224f548f6dd9257fe9ab3"],
    },
  },
  "civic-center": {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: ["sfmta:62e4f585f7d59a2035b92e98abb0807e"],
    },
    platform: {
      label: "Platform access",
      alternatives: ["sfmta:9f61a44448f3f2e2d808c4d5486236f5"],
    },
  },
  "van-ness": {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: ["sfmta:4159f7727774a0032ab5de16548702be"],
    },
    platform: {
      label: "Platform access",
      alternatives: ["sfmta:d28ac57342538498807a20f59b431a30"],
    },
  },
  church: {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: ["sfmta:0154ad6b41748e64880991aa412ade28"],
    },
    eastbound: {
      label: "Eastbound platform",
      alternatives: ["sfmta:35427ea962ccd42a3ccc8f6ce0da9bb0"],
    },
    westbound: {
      label: "Westbound platform",
      alternatives: ["sfmta:e48d37881926844313cf06ad18295600"],
    },
  },
  castro: {
    network: "market",
    street: {
      label: "Street entrance",
      alternatives: ["sfmta:d31e13d067a18f69c86819e913f2569a"],
    },
    eastbound: {
      label: "Eastbound platform",
      alternatives: ["sfmta:6f443ccd5083cdfc296ce3844e3c957e"],
    },
    westbound: {
      label: "Westbound platform",
      alternatives: ["sfmta:f873f07fb9ffe8c6768f616446b98d38"],
    },
  },
  "forest-hill": {
    network: "market",
    eastbound: {
      label: "Eastbound platform",
      alternatives: [
        "sfmta:a108a24c1c9b2b365807dc46de976488",
        "sfmta:030e8147bb0f4e6b6dd60be515b1b225",
      ],
    },
    westbound: {
      label: "Westbound platform",
      alternatives: [
        "sfmta:b90dcce65c71eae07429aa4729398f97",
        "sfmta:1705865671168bc3a0e045304eeb6bf7",
      ],
    },
  },
  "chinatown-rose-pak": {
    network: "central",
    street: {
      label: "Street entrance",
      alternatives: [
        "sfmta:1e8b1ac4d58cacb01183fe2a78702ab1",
        "sfmta:8005ff125965a5f934f71bc2bd5a8c22",
      ],
    },
    platform: {
      label: "Platform access",
      alternatives: [
        "sfmta:0b2cd68a90ffa2afca2d1b5a2c492f5d",
        "sfmta:6d087c7a17e961bf3027b1d4306ebb68",
      ],
    },
  },
  "union-square-market-street": {
    network: "central",
    street: {
      label: "Street entrance",
      alternatives: [
        "sfmta:b7e0d164bd118c44d2a1badafae9fde2",
        "sfmta:6ee46f2bef048e0e2d45087e9eb3b455",
      ],
    },
    platform: {
      label: "Platform access",
      alternatives: [
        "sfmta:567243968db4bf595fa785c9da484c97",
        "sfmta:521f8a6b9051bc8122b15dee7ccd6079",
      ],
    },
  },
  "yerba-buena-moscone": {
    network: "central",
    street: {
      label: "Street entrance",
      alternatives: [
        "sfmta:f37d9a357fcda19c053387c8f7e223e8",
        "sfmta:5c666b27110ad8717617f6c7ffc71997",
      ],
    },
    platform: {
      label: "Platform access",
      alternatives: [
        "sfmta:9b7c2b032d3f9b79591ea2d8050f060d",
        "sfmta:998157ce124ce8ccb28de9a2340fd698",
      ],
    },
  },
};

export function getReviewedElevatorRole(
  stationSlug: string,
  sourceKey: string,
) {
  const topology = REVIEWED_STATION_TOPOLOGY[stationSlug];
  if (!topology) return null;

  for (const key of FACILITY_KEYS) {
    const group = topology[key];
    if (group?.alternatives.includes(sourceKey)) {
      return {
        label: group.label,
        alternatives: group.alternatives,
      };
    }
  }
  return null;
}
