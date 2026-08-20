import { describe, expect, it } from "vitest";

import {
  createActiveTransitEntitiesReader,
  createExactAccessibilityResolvers,
  type ActiveTransitEntities,
} from "../../src/server/journey/accessibility-evidence-resolvers";
import {
  createTrustedAccessibilityEvidenceSource,
  type TrustedAccessibilityReadDependencies,
} from "../../src/server/journey/accessibility-evidence-source";
import type { AccessibilityAdvisoryView } from "../../src/server/transit/accessibility-advisories";
import type { StopRelocationView } from "../../src/server/transit/stop-relocations";
import { EVALUATED_AT } from "../support/accessibility-evidence";

const active: ActiveTransitEntities = {
  snapshotId: "snapshot-1",
  stops: [
    { stopId: "15417", stopName: "Powell Street" },
    { stopId: "16994", stopName: "Montgomery Street" },
  ],
  routeIds: ["N", "49"],
};
const advisory = (
  overrides: Partial<AccessibilityAdvisoryView["advisories"][number]> = {},
): AccessibilityAdvisoryView["advisories"][number] => ({
  advisoryId: "advisory-1",
  title: "source title",
  description: "source description",
  affectedStops: ["Powell Street (#15417)"],
  affectedRoutes: ["N Judah"],
  startsAt: new Date("2026-08-20T12:00:00.000Z"),
  endsAt: new Date("2026-08-20T13:00:00.000Z"),
  publicUrl: "https://www.sfmta.com/travel-updates/example",
  ...overrides,
});
const advisoryView = (
  advisories: AccessibilityAdvisoryView["advisories"],
): AccessibilityAdvisoryView => ({
  state: "current",
  checkedAt: EVALUATED_AT,
  sourceUpdatedAt: null,
  sourceUrl:
    "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility",
  advisories,
});
const relocationView = (
  relocations: StopRelocationView["relocations"],
): StopRelocationView => ({
  state: "current",
  checkedAt: EVALUATED_AT,
  sourceUpdatedAt: EVALUATED_AT,
  sourceUrl: "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  relocations,
});
const relocation = (
  temporaryStop: string,
): StopRelocationView["relocations"][number] => ({
  stopId: "15417",
  stopName: "Powell Street",
  routeNames: ["Inbound N"],
  temporaryStop,
  scheduleText: "daily",
  startsAt: new Date("2026-08-20T12:00:00.000Z"),
  endsAt: new Date("2026-08-20T13:00:00.000Z"),
  latitude: null,
  longitude: null,
  publicUrl: "https://www.sfmta.com/travel-updates/temporary-stop-relocations",
  boardingInstruction: "source wording",
});

describe("exact accessibility evidence resolvers", () => {
  it("loads active transit entities once per snapshot and reloads after promotion", async () => {
    let activeSnapshotId: string | null = "snapshot-1";
    let loadCount = 0;
    const readActive = createActiveTransitEntitiesReader({
      async getActiveSnapshotId() {
        return activeSnapshotId;
      },
      async load(snapshotId) {
        loadCount += 1;
        return { ...active, snapshotId };
      },
    });

    const first = await Promise.all([readActive(), readActive(), readActive()]);
    expect(first.map((result) => result?.snapshotId)).toEqual([
      "snapshot-1",
      "snapshot-1",
      "snapshot-1",
    ]);
    await expect(readActive()).resolves.toMatchObject({
      snapshotId: "snapshot-1",
    });
    expect(loadCount).toBe(1);

    activeSnapshotId = "snapshot-2";
    await expect(readActive()).resolves.toMatchObject({
      snapshotId: "snapshot-2",
    });
    expect(loadCount).toBe(2);
  });

  it("resolves only exact active stop labels and the reviewed exact route map", async () => {
    const resolvers = createExactAccessibilityResolvers(async () => active);
    await expect(
      resolvers.resolveAdvisories(advisoryView([advisory()])),
    ).resolves.toEqual([
      {
        advisoryId: "advisory-1",
        stopIds: ["15417"],
        routeIds: ["N"],
        startsAt: new Date("2026-08-20T12:00:00.000Z"),
        endsAt: new Date("2026-08-20T13:00:00.000Z"),
      },
    ]);
    await expect(
      resolvers.resolveAdvisories(
        advisoryView([advisory({ affectedRoutes: ["49 Van Ness/Mission"] })]),
      ),
    ).resolves.toMatchObject([{ routeIds: ["49"] }]);
  });

  it.each([
    ["changed stop name", { affectedStops: ["Powell (#15417)"] }],
    ["unverified stop ID", { affectedStops: ["Powell Street (#99999)"] }],
    [
      "changed route punctuation",
      { affectedRoutes: ["49 Van Ness - Mission"] },
    ],
    ["unknown future route", { affectedRoutes: ["Q Future"] }],
  ])("fails closed for %s", async (_name, overrides) => {
    const resolvers = createExactAccessibilityResolvers(async () => active);
    await expect(
      resolvers.resolveAdvisories(advisoryView([advisory(overrides)])),
    ).resolves.toBeNull();
  });

  it("keeps every advisory one-to-one with exact original periods", async () => {
    const resolvers = createExactAccessibilityResolvers(async () => active);
    const second = advisory({
      advisoryId: "advisory-2",
      startsAt: null,
      endsAt: null,
      affectedStops: ["Montgomery Street (#16994)"],
      affectedRoutes: [],
    });
    const resolved = await resolvers.resolveAdvisories(
      advisoryView([advisory(), second]),
    );
    expect(resolved).toHaveLength(2);
    expect(resolved?.[1]).toEqual({
      advisoryId: "advisory-2",
      stopIds: ["16994"],
      routeIds: [],
      startsAt: null,
      endsAt: null,
    });
  });

  it("resolves relocations by exact active route labels and preserves distinct rows", async () => {
    const resolvers = createExactAccessibilityResolvers(async () => active);
    const resolved = await resolvers.resolveRelocations(
      relocationView([
        relocation("First location"),
        relocation("Second location"),
      ]),
    );
    expect(resolved).toHaveLength(2);
    expect(resolved?.[0]).toMatchObject({
      stopId: "15417",
      routeIds: ["N"],
      temporaryStop: "First location",
      boardingInstruction: "source wording",
    });
    expect(resolved?.[0]?.relocationId).not.toBe(resolved?.[1]?.relocationId);
    expect(resolved?.[0]?.relocationId).toMatch(/^relocation:[a-f0-9]{64}$/u);
  });

  it.each([["Inbound: N"], ["Inbound Q"], ["N"]])(
    "fails closed for unresolved relocation label %s",
    async (routeName) => {
      const resolvers = createExactAccessibilityResolvers(async () => active);
      await expect(
        resolvers.resolveRelocations(
          relocationView([{ ...relocation("place"), routeNames: [routeName] }]),
        ),
      ).resolves.toBeNull();
    },
  );

  it("rejects duplicate relocation identities", async () => {
    const resolvers = createExactAccessibilityResolvers(async () => active);
    const row = relocation("same place");
    await expect(
      resolvers.resolveRelocations(relocationView([row, { ...row }])),
    ).resolves.toBeNull();
  });
});

function adapterDependencies(
  view: AccessibilityAdvisoryView,
): TrustedAccessibilityReadDependencies {
  return {
    readElevators: async () => null,
    readAdvisories: async () => view,
    readRelocations: async () => ({
      ...relocationView([]),
      state: "unavailable",
    }),
    readGuides: async () => ({
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl:
        "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops",
      guides: [],
    }),
    realtimeStore: { getTrustedSnapshot: async () => null },
  };
}

describe("advisory adapter completeness", () => {
  it.each([
    ["partial", () => []],
    [
      "invented",
      () => [
        {
          advisoryId: "invented",
          stopIds: ["15417"],
          routeIds: [],
          startsAt: null,
          endsAt: null,
        },
      ],
    ],
    [
      "changed time",
      () => [
        {
          advisoryId: "advisory-1",
          stopIds: ["15417"],
          routeIds: [],
          startsAt: null,
          endsAt: null,
        },
      ],
    ],
    [
      "empty entity",
      () => [
        {
          advisoryId: "advisory-1",
          stopIds: [],
          routeIds: [],
          startsAt: new Date("2026-08-20T12:00:00.000Z"),
          endsAt: new Date("2026-08-20T13:00:00.000Z"),
        },
      ],
    ],
  ])("marks %s resolver output unavailable", async (_name, output) => {
    const view = advisoryView([advisory()]);
    const dependencies = adapterDependencies(view);
    dependencies.resolveAdvisories = async () => output();
    const snapshot =
      await createTrustedAccessibilityEvidenceSource(dependencies).read(
        EVALUATED_AT,
      );
    expect(snapshot.advisories).toMatchObject({
      state: "unavailable",
      advisories: [],
    });
  });
});
