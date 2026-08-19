import { describe, expect, it } from "vitest";

import {
  deriveRiderStationState,
  type PublicAccessibility,
  type PublicStation,
} from "@/domain/accessibility/model";
import { planJourney } from "@/domain/accessibility/planner";

const now = new Date("2026-08-19T00:00:00.000Z");

function accessibilityWith(stations: PublicStation[]): PublicAccessibility {
  return {
    trust: {
      state: "current",
      sourceValidAt: now,
      ageSeconds: 0,
    },
    counts: { accessible: stations.length, limited: 0, unavailable: 0, unknown: 0 },
    stations,
  };
}

describe("public accessibility semantics", () => {
  it("never turns unknown station evidence into an all-clear", () => {
    expect(deriveRiderStationState("unknown", ["working"])).toBe("unknown");
    expect(deriveRiderStationState("accessible", ["working", "unknown"])).toBe(
      "limited",
    );
  });

  it("uses reviewed redundant elevators without selecting a broken one", () => {
    const powell: PublicStation = {
      slug: "powell",
      name: "Powell",
      corridorOrder: 3,
      state: "limited",
      elevators: [
        {
          sourceKey: "sfmta:155fa9cd88ca1b910f173175e6d47c76",
          name: "Hallidie Plaza - Street Elevator",
          state: "out_of_service",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:c3c5a5304402993b7c0e65b129cc4425",
          name: "Market & Ellis - Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
          name: "Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const forestHill: PublicStation = {
      slug: "forest-hill",
      name: "Forest Hill",
      corridorOrder: 8,
      state: "limited",
      elevators: [
        {
          sourceKey: "sfmta:b90dcce65c71eae07429aa4729398f97",
          name: "Platform Elevator - Westbound Left",
          state: "out_of_service",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:1705865671168bc3a0e045304eeb6bf7",
          name: "Platform Elevator - Westbound Right",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };

    const plan = planJourney(
      "powell",
      "forest-hill",
      accessibilityWith([powell, forestHill]),
    );

    expect(plan.available).toBe(true);
    expect(JSON.stringify(plan)).toContain("Market & Ellis");
    expect(JSON.stringify(plan)).toContain("Westbound Right");
    expect(JSON.stringify(plan)).not.toContain("Hallidie Plaza");
    expect(JSON.stringify(plan)).not.toContain("Westbound Left");
  });

  it("refuses a trip when a required reviewed elevator group has no working option", () => {
    const church: PublicStation = {
      slug: "church",
      name: "Church",
      corridorOrder: 6,
      state: "unavailable",
      elevators: [
        {
          sourceKey: "sfmta:0154ad6b41748e64880991aa412ade28",
          name: "Market & Church - Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:35427ea962ccd42a3ccc8f6ce0da9bb0",
          name: "Platform Elevator - Eastbound",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const embarcadero: PublicStation = {
      slug: "embarcadero",
      name: "Embarcadero",
      corridorOrder: 1,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:daa531d64a3870d252a77ea3071cf48e",
          name: "Market & Drumm - Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:262500989db4b37e5599c0646b3b1514",
          name: "Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const vanNess: PublicStation = {
      slug: "van-ness",
      name: "Van Ness",
      corridorOrder: 5,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:4159f7727774a0032ab5de16548702be",
          name: "Van Ness & Market - Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:d28ac57342538498807a20f59b431a30",
          name: "Van Ness Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };

    const plan = planJourney(
      "church",
      "embarcadero",
      accessibilityWith([church, vanNess, embarcadero]),
    );
    expect(plan.available).toBe(false);
    expect(plan.title).toBe("No confirmed step-free trip right now");
    expect(plan.alternative).toMatchObject({
      title: "Try starting at Van Ness",
      originSlug: "van-ness",
      destinationSlug: "embarcadero",
    });
    expect(plan.alternative?.addedTime).toContain("not estimated");
  });

  it("verifies both transfer platforms before offering a cross-network trip", () => {
    const embarcadero: PublicStation = {
      slug: "embarcadero",
      name: "Embarcadero",
      corridorOrder: 1,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:daa531d64a3870d252a77ea3071cf48e",
          name: "Market & Drumm - Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:262500989db4b37e5599c0646b3b1514",
          name: "Embarcadero Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const powell: PublicStation = {
      slug: "powell",
      name: "Powell",
      corridorOrder: 3,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
          name: "Powell Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const unionSquare: PublicStation = {
      slug: "union-square-market-street",
      name: "Union Square / Market Street",
      corridorOrder: 10,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:567243968db4bf595fa785c9da484c97",
          name: "Union Square Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const chinatown: PublicStation = {
      slug: "chinatown-rose-pak",
      name: "Chinatown – Rose Pak",
      corridorOrder: 9,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:1e8b1ac4d58cacb01183fe2a78702ab1",
          name: "Chinatown Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:0b2cd68a90ffa2afca2d1b5a2c492f5d",
          name: "Chinatown Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };

    const current = accessibilityWith([
      embarcadero,
      powell,
      unionSquare,
      chinatown,
    ]);
    const available = planJourney(
      "embarcadero",
      "chinatown-rose-pak",
      current,
    );
    expect(available.available).toBe(true);
    expect(JSON.stringify(available)).toContain("Powell Platform Elevator");
    expect(JSON.stringify(available)).toContain(
      "Union Square Platform Elevator",
    );

    const unavailable = planJourney(
      "embarcadero",
      "chinatown-rose-pak",
      accessibilityWith([
        embarcadero,
        powell,
        {
          ...unionSquare,
          state: "limited",
          elevators: unionSquare.elevators.map((elevator) => ({
            ...elevator,
            state: "out_of_service" as const,
          })),
        },
        chinatown,
      ]),
    );
    expect(unavailable.available).toBe(false);
    expect(unavailable.summary).toContain("Powell–Union Square connection");
  });

  it("does not claim a route when the trusted update is stale", () => {
    const powell: PublicStation = {
      slug: "powell",
      name: "Powell",
      corridorOrder: 3,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:155fa9cd88ca1b910f173175e6d47c76",
          name: "Market & Ellis - Street Elevator",
          state: "working",
          lastChangedAt: now,
        },
        {
          sourceKey: "sfmta:98a3cedeeef224f548f6dd9257fe9ab3",
          name: "Platform Elevator",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const forestHill: PublicStation = {
      slug: "forest-hill",
      name: "Forest Hill",
      corridorOrder: 8,
      state: "accessible",
      elevators: [
        {
          sourceKey: "sfmta:1705865671168bc3a0e045304eeb6bf7",
          name: "Platform Elevator - Westbound Right",
          state: "working",
          lastChangedAt: now,
        },
      ],
    };
    const stale = accessibilityWith([powell, forestHill]);
    stale.trust = { ...stale.trust, state: "older", ageSeconds: 901 };

    const plan = planJourney("powell", "forest-hill", stale);

    expect(plan.available).toBe(false);
    expect(plan.title).toBe("We can’t confirm this trip right now");
    expect(plan.instructions).toEqual([]);
    expect(plan.notices[0]).toContain("Check SFMTA");
  });
});
