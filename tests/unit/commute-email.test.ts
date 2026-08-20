import { describe, expect, it } from "vitest";

import type {
  SafeJourneyPlan,
  SafeJourneySource,
} from "@/domain/journey/citywide-journey-form";
import type { JourneyChangeSummary } from "@/domain/notifications/journey-changes";
import {
  buildCommuteEmail,
  type CommuteEmailInput,
} from "@/emails/commute-email";

const sourceUrls = {
  schedule: "https://511.org/open-data/transit",
  elevators:
    "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod",
} as const;

const source = (
  overrides: Partial<SafeJourneySource> = {},
): SafeJourneySource => ({
  source: "schedule",
  checkedAt: "2026-08-20T19:00:00.000Z",
  sourceUpdatedAt: "2026-08-20T18:45:00.000Z",
  freshness: "current",
  sourceUrl: sourceUrls.schedule,
  ...overrides,
});

const plan = (overrides: Partial<SafeJourneyPlan> = {}): SafeJourneyPlan => ({
  status: "confirmed",
  title: "Step-free trip",
  summary: "Step-free details are confirmed for this journey.",
  departureAt: "2026-08-21T15:30:00.000Z",
  arrivalAt: "2026-08-21T16:00:00.000Z",
  durationMinutes: 30,
  legs: [
    {
      type: "walk",
      from: "24th Street Mission",
      to: "24th Street Mission Station",
      startAt: "2026-08-21T15:30:00.000Z",
      endAt: "2026-08-21T15:35:00.000Z",
      durationMinutes: 5,
      instruction: "Follow signs to the accessible entrance.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.418, 37.752],
          [-122.418, 37.753],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
    {
      type: "ride",
      from: "24th Street Mission Station",
      to: "Embarcadero Station",
      startAt: "2026-08-21T15:35:00.000Z",
      endAt: "2026-08-21T15:55:00.000Z",
      durationMinutes: 20,
      route: {
        id: "J",
        name: "J Church",
        color: "#00a99d",
        destination: "Embarcadero",
      },
      instruction: "Ride the J Church toward Embarcadero.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.418, 37.753],
          [-122.397, 37.795],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
  ],
  warnings: [],
  changes: [],
  sources: [
    source({ sourceUpdatedAt: null }),
    source({
      source: "elevators",
      sourceUrl: sourceUrls.elevators,
    }),
  ],
  map: {
    bounds: { west: -122.42, south: 37.75, east: -122.39, north: 37.8 },
    origin: { type: "Point", coordinates: [-122.418, 37.752] },
    destination: { type: "Point", coordinates: [-122.397, 37.795] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
  ...overrides,
});

const changes = (
  changed: string[] = ["No changes to your journey."],
  working: string[] = ["Your step-free journey is still confirmed."],
  checking: string[] = [],
): JourneyChangeSummary => ({
  sections: [
    { title: "What changed", items: changed },
    { title: "What is working", items: working },
    { title: "What needs checking", items: checking },
  ],
});

const input = (
  overrides: Partial<CommuteEmailInput> = {},
): CommuteEmailInput => ({
  schedule: {
    originLabel: "24th Street Mission",
    destinationLabel: "Fisherman's Wharf",
    departureLabel: "8:30 AM",
    arrivalLabel: "9:00 AM",
  },
  plan: plan(),
  changes: changes(),
  manageUrl: "https://unbroken.example/rider/trips#first-trip",
  appOrigin: "https://unbroken.example",
  ...overrides,
});

function visibleText(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/giu, "")
    .replace(/<[^>]+>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/\s+/gu, " ")
    .trim();
}

describe("commute email renderer seam", () => {
  it("renders an unchanged trip in the approved order with matching text fallback", () => {
    const result = buildCommuteEmail(input());

    expect(result.subject).toBe("Your 8:30 AM trip is unchanged");
    expect(result.html).toContain("Trip summary");
    expect(result.html).toContain("What changed");
    expect(result.html).toContain("What is working");
    expect(result.html).toContain("What needs checking");
    expect(result.html).toContain("Journey steps");
    expect(result.html).toContain("Checked by UNBROKEN at");
    expect(result.html).toContain("SFMTA updated at");
    expect(result.html).toContain("Manage this trip");

    const order = [
      "Trip summary",
      "What changed",
      "What is working",
      "What needs checking",
      "Journey steps",
      "Checked by UNBROKEN at",
      "SFMTA updated at",
      "Manage this trip",
    ].map((label) => result.html.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((left, right) => left - right));

    expect(result.text).toContain("24th Street Mission");
    expect(result.text).toContain("Fisherman's Wharf");
    expect(result.text).toContain("What changed");
    expect(result.text).toContain("Journey steps");
    expect(result.text).toContain("Checked by UNBROKEN at");
    expect(result.text).toContain("SFMTA updated at");
    expect(result.text).toContain("Manage this trip");
    expect(visibleText(result.html)).toContain(
      "Ride the J Church toward Embarcadero.",
    );
  });

  it("distinguishes changed and unconfirmed trips in simple subjects", () => {
    expect(
      buildCommuteEmail(
        input({
          changes: changes(["Your Muni route changed."]),
        }),
      ).subject,
    ).toBe("Your 8:30 AM trip has one change");

    expect(
      buildCommuteEmail(
        input({
          plan: plan({ status: "check_details" }),
          changes: changes([], [], ["Some journey details need checking."]),
        }),
      ).subject,
    ).toBe("We couldn't confirm today's step-free route");
  });

  it("escapes bounded rider text and excludes internal jargon", () => {
    const result = buildCommuteEmail(
      input({
        schedule: {
          originLabel: '<img src=x onerror="alert(1)"> & start',
          destinationLabel: "A".repeat(500),
          departureLabel: "8:30 AM",
          arrivalLabel: "9:00 AM",
        },
        plan: plan({
          summary:
            "The fingerprint provider reason exposed operational queue details.",
          legs: [
            {
              ...plan().legs[0]!,
              instruction: "Use the collector worker token.",
            },
          ],
        }),
        changes: changes(["The provider fingerprint changed."]),
      }),
    );

    expect(result.html).not.toContain("<img");
    expect(result.html).toContain("&lt;img");
    expect(result.html).not.toMatch(
      /fingerprint|provider|collector|worker|token|operational|queue/iu,
    );
    expect(result.text).not.toMatch(
      /fingerprint|provider|collector|worker|token|operational|queue/iu,
    );
    expect(result.html.length).toBeLessThan(50_000);
    expect(result.text.length).toBeLessThan(20_000);
  });

  it("keeps only same-origin HTTPS manage links and allowlisted official sources", () => {
    const safe = buildCommuteEmail(input());
    expect(safe.html).toContain(
      'href="https://unbroken.example/rider/trips#first-trip"',
    );
    expect(safe.html).toContain(`href="${sourceUrls.schedule}"`);

    const unsafe = buildCommuteEmail(
      input({
        manageUrl: "https://evil.example/rider/trips/first",
        plan: plan({
          sources: [
            source({
              sourceUrl: "https://evil.example/source",
            }),
            source({
              source: "elevators",
              sourceUrl: sourceUrls.elevators,
              sourceUpdatedAt: null,
            }),
          ],
        }),
      }),
    );

    expect(unsafe.html).not.toContain("evil.example");
    expect(unsafe.html).not.toContain("javascript:");
    expect(unsafe.html).not.toContain(`href="${sourceUrls.elevators}"`);
    expect(unsafe.text).not.toContain("evil.example");
    expect(unsafe.html).toContain("Current updates are unavailable");
  });

  it("keeps HTML and plain text semantically aligned and supports dark clients", () => {
    const result = buildCommuteEmail(input());
    for (const phrase of [
      "Trip summary",
      "Step-free details are confirmed for this journey.",
      "What changed",
      "No changes to your journey.",
      "What is working",
      "Your step-free journey is still confirmed.",
      "What needs checking",
      "Journey steps",
      "Follow signs to the accessible entrance.",
      "Checked by UNBROKEN at",
      "SFMTA updated at",
      "Manage this trip",
    ]) {
      expect(visibleText(result.html)).toContain(phrase);
      expect(result.text).toContain(phrase);
    }
    expect(result.html).toContain("prefers-color-scheme: dark");
    expect(result.html).toContain("background-color:#ffffff");
    expect(result.html).toContain("color:#17202a");
  });

  it("rejects manage URLs with queries and dirty configured origins", () => {
    const withQuery = buildCommuteEmail(
      input({
        manageUrl: "https://unbroken.example/rider/trips?slot=first",
      }),
    );
    expect(withQuery.html).not.toContain('href="https://unbroken.example');
    expect(withQuery.text).not.toContain("?slot=first");

    const dirtyOrigin = buildCommuteEmail(
      input({
        appOrigin: "https://unbroken.example?next=https://evil.example",
      }),
    );
    expect(dirtyOrigin.html).not.toContain('href="https://unbroken.example');

    const nestedOrigin = buildCommuteEmail(
      input({ appOrigin: "https://unbroken.example/config" }),
    );
    expect(nestedOrigin.html).not.toContain('href="https://unbroken.example');
  });

  it.each([
    ["invalid plan status", { status: "secret" }],
    ["invalid leg type", { legs: [{ ...plan().legs[0]!, type: "<script>" }] }],
    [
      "invalid accessibility state",
      {
        legs: [
          {
            ...plan().legs[0]!,
            accessibility: { state: "<img>", reasons: [] },
          },
        ],
      },
    ],
    [
      "invalid source",
      {
        sources: [source({ sourceUrl: "https://evil.example/source" })],
      },
    ],
    [
      "prototype source",
      {
        sources: [
          source({
            source: "__proto__" as never,
            sourceUrl: "https://evil.example/source",
          }),
        ],
      },
    ],
    [
      "invalid timestamp",
      {
        sources: [source({ checkedAt: "2026-02-30T12:00:00.000Z" })],
      },
    ],
  ])("fails closed for %s in a runtime projection", (_name, patch) => {
    const result = buildCommuteEmail(
      input({ plan: { ...plan(), ...patch } as unknown as SafeJourneyPlan }),
    );
    expect(result.subject).toBe("We couldn't confirm today's step-free route");
    expect(result.html).toContain("Current updates are unavailable");
    expect(result.html).not.toMatch(
      /<script|<img|evil\.example|not-a-date|secret/iu,
    );
    expect(result.text).not.toMatch(
      /<script|<img|evil\.example|not-a-date|secret/iu,
    );
  });

  it("keeps bounded inputs below a safe email size without truncating markup", () => {
    const base = plan().legs[0]!;
    const result = buildCommuteEmail(
      input({
        plan: plan({
          legs: Array.from({ length: 12 }, (_, index) => ({
            ...base,
            from: `Start ${index} ${"x".repeat(160)}`,
            to: `End ${index} ${"y".repeat(160)}`,
            instruction: `Follow ${"z".repeat(160)} signs.`,
          })),
        }),
        changes: changes(
          Array.from(
            { length: 6 },
            (_, index) => `Change ${index} ${"c".repeat(160)}`,
          ),
          Array.from(
            { length: 6 },
            (_, index) => `Working ${index} ${"w".repeat(160)}`,
          ),
          Array.from(
            { length: 6 },
            (_, index) => `Check ${index} ${"q".repeat(160)}`,
          ),
        ),
      }),
    );
    expect(result.html.length).toBeLessThan(30_000);
    expect(result.text.length).toBeLessThan(15_000);
    expect(result.html).toContain("</html>");
    expect(result.html).toContain("</body>");
  });

  it("does not invent an SFMTA time when sources do not provide one", () => {
    const result = buildCommuteEmail(
      input({
        plan: plan({
          sources: [source({ sourceUpdatedAt: null })],
        }),
      }),
    );
    expect(result.html).toContain("Checked by UNBROKEN at");
    expect(result.html).not.toContain("SFMTA updated at");
    expect(result.text).not.toContain("SFMTA updated at");
  });
});
