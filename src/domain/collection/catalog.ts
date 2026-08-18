export const SFMTA_STATIONS = [
  { sourceName: "Embarcadero Station", slug: "embarcadero", displayName: "Embarcadero", corridorOrder: 1 },
  { sourceName: "Montgomery Station", slug: "montgomery", displayName: "Montgomery", corridorOrder: 2 },
  { sourceName: "Powell Station", slug: "powell", displayName: "Powell", corridorOrder: 3 },
  { sourceName: "Civic Center Station", slug: "civic-center", displayName: "Civic Center", corridorOrder: 4 },
  { sourceName: "Van Ness Station", slug: "van-ness", displayName: "Van Ness", corridorOrder: 5 },
  { sourceName: "Church Station", slug: "church", displayName: "Church", corridorOrder: 6 },
  { sourceName: "Castro Station", slug: "castro", displayName: "Castro", corridorOrder: 7 },
  { sourceName: "Forest Hill Station", slug: "forest-hill", displayName: "Forest Hill", corridorOrder: 8 },
  { sourceName: "Chinatown - Rose Pak Station", slug: "chinatown-rose-pak", displayName: "Chinatown – Rose Pak", corridorOrder: 9 },
  { sourceName: "Union Square / Market Street Station", slug: "union-square-market-street", displayName: "Union Square / Market Street", corridorOrder: 10 },
  { sourceName: "Yerba Buena / Moscone Station", slug: "yerba-buena-moscone", displayName: "Yerba Buena / Moscone", corridorOrder: 11 },
] as const;

export const SFMTA_STATION_NAMES = new Set<string>(
  SFMTA_STATIONS.map((station) => station.sourceName),
);

export function getStationDefinition(sourceName: string) {
  return SFMTA_STATIONS.find((station) => station.sourceName === sourceName);
}
