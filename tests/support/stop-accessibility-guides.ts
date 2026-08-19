export const STOP_ACCESSIBILITY_SOURCE_URL =
  "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops";

export const UNDERGROUND_GUIDANCE =
  "All Muni Metro underground stations (Embarcadero, Montgomery, Powell, Civic Center, Van Ness, Church Street, Castro Street, Forest Hill, Chinatown-Rose-Pak and Union Square-Market Street) are accessible via street-to-concourse elevators and concourse-to-platform elevators.";

export const SURFACE_OVERVIEW =
  "The surface portion of the following Metro lines are accessible at the following wayside platforms and surface-level stations: J Church, K Ingleside, L Taraval, M Ocean View, N Judah. The T Third is fully accessible. This information is also available as a map of accessible stops.";

const SECTIONS = [
  {
    heading: "J CHURCH ACCESSIBILITY:",
    route: "J",
    routeTuples: [["J", "N"], ["J"], ["J"], ["J"], ["J"], ["J"], ["J", "K"]],
    names: [
      "San Jose and Randall streets",
      "Church and 30th streets",
      "Church and 29th streets",
      "Church and 27th streets",
      "Church and 24th streets",
      "Church and 22nd streets",
      "Church and 18th streets",
    ],
  },
  {
    heading: "K INGLESIDE ACCESSIBILITY:",
    route: "K",
    routeTuples: [
      ["K", "L", "M"],
      ["K", "M"],
      ["K"],
      ["K"],
      ["K"],
      ["K"],
      ["K"],
      ["J", "K"],
    ],
    names: [
      "West Portal Station",
      "Ocean and Lee avenues",
      "Ocean and Miramar avenues",
      "Ocean and Dorado Terrace",
      "Ocean and Jules avenues",
      "Ocean and Victoria Street",
      "Ocean and San Leandro Way",
      "Balboa Park Station",
    ],
  },
  {
    heading: "L TARAVAL ACCESSIBILITY:",
    route: "L",
    routeTuples: [["K", "L", "M"], ["L"], ["L"], ["L"], ["L"], ["L"]],
    names: [
      "West Portal Station",
      "Ulloa Street and 15th Avenue",
      "Taraval Street and 19th Avenue",
      "Taraval Street and 22nd Avenue",
      "Taraval Street and 30th Avenue",
      "Taraval Street and 46th Avenue",
    ],
  },
  {
    heading: "M OCEAN VIEW ACCESSIBILITY:",
    route: "M",
    routeTuples: [
      ["K", "L", "M"],
      ["K", "M"],
      ["M"],
      ["M"],
      ["M"],
      ["M"],
      ["M"],
    ],
    names: [
      "West Portal Station",
      "Stonestown Station",
      "SF State Station",
      "19th Avenue and Holloway Avenue",
      "19th Avenue and Randolph Street",
      "Broad Street and Plymouth Avenue",
      "San Jose and Geneva avenues",
    ],
  },
  {
    heading: "N JUDAH ACCESSIBILITY:",
    route: "N",
    routeTuples: [
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
    ],
    names: [
      "Duboce Avenue and Church Street",
      "Carl and Cole streets",
      "Carl Street and Stanyan Street",
      "Irving Street and 5th Avenue",
      "Irving Street and 9th Avenue",
      "Judah Street and 19th Avenue",
      "Judah Street and 23rd Avenue",
      "Judah Street and 28th Avenue",
      "Judah Street and 31st Avenue",
      "Judah Street and 34th Avenue",
      "Judah Street and 40th Avenue",
      "Judah Street and 46th Avenue",
      "Judah Street and La Playa Street",
    ],
  },
] as const;

export function officialAccessibilityContent() {
  const lines = [UNDERGROUND_GUIDANCE, SURFACE_OVERVIEW];
  for (const section of SECTIONS) {
    lines.push(section.heading);
    lines.push(
      ...section.names.map(
        (name, index) => `${name} (${section.routeTuples[index]!.join(", ")})`,
      ),
    );
  }
  lines.push("T THIRD ACCESSIBILITY:");
  lines.push(
    "All stops on the T Third between Chinatown and Sunnydale are accessible.",
  );
  return lines.join("\n");
}

export function stopAccessibilityEnvelope(
  overrides: Record<string, unknown> = {},
) {
  return {
    accessibility_content: officialAccessibilityContent(),
    input: { url: STOP_ACCESSIBILITY_SOURCE_URL },
    page_title: "Muni Metro Accessible Stops",
    product_page_url: STOP_ACCESSIBILITY_SOURCE_URL,
    scraped_at: "2026-08-20T00:30:00.000Z",
    source_url: STOP_ACCESSIBILITY_SOURCE_URL,
    ...overrides,
  };
}
