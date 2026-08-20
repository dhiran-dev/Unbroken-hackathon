import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { CitywideJourneyResult } from "@/components/citywide-journey-result";
import { presentJourneyResult } from "@/domain/journey/journey-result";

const sourceUrls = {
  schedule: "https://511.org/open-data/transit",
  arrivals: "https://511.org/open-data/transit",
  vehicles: "https://511.org/open-data/transit",
  service_changes:
    "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  stop_changes:
    "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  elevators:
    "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
  station_access:
    "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
} as const;

const plan = {
  status: "confirmed",
  title: "An arbitrary internal title that must not reach riders",
  summary: "Walk to the stop, then ride to the waterfront.",
  departureAt: "2026-08-20T19:00:00.000Z",
  arrivalAt: "2026-08-20T19:32:00.000Z",
  durationMinutes: 32,
  legs: [
    {
      type: "walk",
      from: "Market Street",
      to: "5 Fulton stop",
      startAt: "2026-08-20T19:00:00.000Z",
      endAt: "2026-08-20T19:05:00.000Z",
      durationMinutes: 5,
      instruction: "Walk to the boarding stop.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.41, 37.78],
          [-122.405, 37.782],
        ],
      },
      accessibility: {
        state: "unknown",
        reasons: ["STOP_ACCESS_UNKNOWN", "private internal reason"],
      },
    },
    {
      type: "ride",
      from: "5 Fulton stop",
      to: "Ferry Building",
      startAt: "2026-08-20T19:05:00.000Z",
      endAt: "2026-08-20T19:32:00.000Z",
      durationMinutes: 27,
      route: {
        id: "private-route-id",
        name: "5 Fulton",
        color: "#123456",
        destination: "Ferry Building",
      },
      instruction: "Ride the 5 Fulton toward the waterfront.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.405, 37.782],
          [-122.3937, 37.7955],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
  ],
  warnings: ["Some sidewalk details need checking."],
  changes: ["Board at the moved stop."],
  sources: [
    {
      source: "schedule",
      checkedAt: "2026-08-20T18:55:00.000Z",
      sourceUpdatedAt: "2026-08-20T18:30:00.000Z",
      freshness: "current",
      sourceUrl: sourceUrls.schedule,
    },
    {
      source: "arrivals",
      checkedAt: "2026-08-20T18:56:00.000Z",
      sourceUpdatedAt: null,
      freshness: "older",
      sourceUrl: sourceUrls.arrivals,
    },
    {
      source: "elevators",
      checkedAt: null,
      sourceUpdatedAt: null,
      freshness: "unavailable",
      sourceUrl: sourceUrls.elevators,
    },
  ],
  map: {
    bounds: { north: 37.8, south: 37.77, east: -122.39, west: -122.42 },
    origin: { type: "Point", coordinates: [-122.41, 37.78] },
    destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
  fingerprint: "private-fingerprint",
  geometry: "private-geometry",
};

describe("journey result presenter seam", () => {
  it.each([
    ["confirmed", "Step-free details confirmed"],
    ["check_details", "Some details need checking"],
    ["unavailable", "No step-free route confirmed"],
    ["updates_unavailable", "Current updates are unavailable"],
  ] as const)("uses the approved %s rider state", (status, label) => {
    const result = presentJourneyResult({ ...plan, status });

    expect(result?.statusLabel).toBe(label);
    expect(result?.status).toBe(status);
  });

  it("presents ordered bounded legs and safe source provenance", () => {
    const result = presentJourneyResult(plan);

    expect(result).toMatchObject({
      departureAt: plan.departureAt,
      arrivalAt: plan.arrivalAt,
      durationMinutes: 32,
      legs: [
        {
          typeLabel: "Walk",
          from: "Market Street",
          to: "5 Fulton stop",
          instruction: "Walk to the boarding stop.",
          startAt: plan.legs[0]!.startAt,
          endAt: plan.legs[0]!.endAt,
          durationMinutes: 5,
          accessibilityLabel: "Some details need checking",
        },
        {
          typeLabel: "Ride",
          route: { name: "5 Fulton", destination: "Ferry Building" },
          accessibilityLabel: "Step-free details confirmed",
        },
      ],
      sources: [
        {
          sourceLabel: "Muni schedule",
          freshnessLabel: "Current",
          checkedAt: plan.sources[0]!.checkedAt,
          sourceUpdatedAt: plan.sources[0]!.sourceUpdatedAt,
          sourceUrl: sourceUrls.schedule,
        },
        {
          sourceLabel: "Arrival updates",
          freshnessLabel: "Older information",
          sourceUpdatedAt: null,
        },
        {
          sourceLabel: "Elevators",
          freshnessLabel: "Unavailable",
          checkedAt: null,
          sourceUpdatedAt: null,
        },
      ],
    });
    expect(result?.legs[0]).not.toHaveProperty("geometry");
    expect(result?.legs[0]).not.toHaveProperty("accessibility.state");
    expect(result?.legs[0]).not.toHaveProperty("accessibility.reasons");
    expect(result?.legs[1]?.route).not.toHaveProperty("id");
  });

  it("returns null for an invalid public plan and defensively copies collections", () => {
    expect(presentJourneyResult({ status: "confirmed" })).toBeNull();

    const result = presentJourneyResult(plan);
    expect(result).not.toBeNull();
    if (!result) return;

    result.warnings.push("local mutation");
    result.legs[0]!.from = "local mutation";
    result.sources[0]!.sourceUrl = "https://local.invalid";

    expect(plan.warnings).toEqual(["Some sidewalk details need checking."]);
    expect(plan.legs[0]!.from).toBe("Market Street");
    expect(plan.sources[0]!.sourceUrl).toBe(sourceUrls.schedule);
  });

  it("does not carry internal or implementation vocabulary into the rider view", () => {
    const serialized = JSON.stringify(presentJourneyResult(plan));

    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("STOP_ACCESS_UNKNOWN");
    expect(serialized).not.toContain("fingerprint");
    expect(serialized).not.toContain("geometry");
    expect(serialized).not.toMatch(
      /\b(?:GTFS|OTP|GraphQL|protobuf|job|queue|worker|collector|schema)\b/i,
    );
  });
});

describe("citywide journey result public seam", () => {
  it("renders prominent status, Pacific arrival, steps, caveat, sources, and duplicate text", () => {
    const duplicate = {
      ...plan,
      warnings: ["Check this detail", "Check this detail"],
      changes: ["Check this detail", "Check this detail"],
      legs: [
        {
          ...plan.legs[0],
          from: "A very long origin name that remains readable on a narrow phone",
          to: "A very long destination name that remains readable on a narrow phone",
        },
      ],
    };
    const html = renderToStaticMarkup(
      <CitywideJourneyResult plan={duplicate} />,
    );

    expect(html).toContain("Step-free details confirmed");
    expect(html).toContain("Estimated arrival");
    expect(html).toContain("Aug 20, 2026, 12:32 PM PDT");
    expect(html).toContain("Walk");
    expect(html).toContain(
      "This path avoids mapped stairs. Some sidewalk details may be missing.",
    );
    expect(html).toContain("Checked by UNBROKEN at");
    expect(html).toContain("SFMTA updated at");
    expect(html).toContain("Official source");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("Check this detail");
    expect(html).not.toContain("last updated");
    expect(html).not.toContain("wheelchair-safe");
  });

  it("renders every source freshness state with a distinguishable label", () => {
    const html = renderToStaticMarkup(<CitywideJourneyResult plan={plan} />);

    expect(html).toContain("Muni schedule");
    expect(html).toContain("Arrival updates");
    expect(html).toContain("Elevators");
    expect(html).toContain("Current");
    expect(html).toContain("Older information");
    expect(html).toContain("Unavailable");
  });

  it("renders no result for an invalid plan", () => {
    expect(
      renderToStaticMarkup(<CitywideJourneyResult plan={{ status: "bad" }} />),
    ).toBe("");
  });
});
