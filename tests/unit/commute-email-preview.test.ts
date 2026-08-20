import { describe, expect, it, vi } from "vitest";

import {
  createCommuteEmailPreview,
  type CommuteEmailPreviewDependencies,
} from "@/server/commutes/email-preview";
import type { SavedCommute } from "@/domain/commute/service";
import type { JourneyPlan, JourneyPlanner } from "@/domain/journey/journey";

const schedule: SavedCommute = {
  id: "00000000-0000-4000-8000-000000000001",
  slot: "first",
  originPlaceId: "stop:origin",
  destinationPlaceId: "landmark:ferry-building",
  days: ["thursday"],
  departureTime: "08:30",
  timezone: "America/Los_Angeles",
  reminderMinutes: 30,
  paused: false,
  createdAt: "2026-08-19T12:00:00.000Z",
  updatedAt: "2026-08-19T12:00:00.000Z",
};

const plan: JourneyPlan = {
  status: "confirmed",
  title: "Step-free details confirmed",
  summary: "A step-free journey is available.",
  departureAt: "2026-08-20T15:30:00.000Z",
  arrivalAt: "2026-08-20T16:00:00.000Z",
  durationMinutes: 30,
  legs: [
    {
      type: "walk",
      from: "Origin",
      to: "Origin stop",
      startAt: "2026-08-20T15:30:00.000Z",
      endAt: "2026-08-20T15:35:00.000Z",
      durationMinutes: 5,
      instruction: "Follow signs to the accessible entrance.",
      geometry: {
        type: "LineString",
        coordinates: [
          [-122.42, 37.75],
          [-122.41, 37.76],
        ],
      },
      accessibility: { state: "confirmed", reasons: [] },
    },
  ],
  warnings: [],
  changes: [],
  sources: [
    {
      source: "schedule",
      checkedAt: "2026-08-20T15:00:00.000Z",
      sourceUpdatedAt: null,
      freshness: "current",
      sourceUrl: "https://511.org/open-data/transit",
    },
  ],
  map: {
    bounds: { west: -122.42, south: 37.75, east: -122.39, north: 37.8 },
    origin: { type: "Point", coordinates: [-122.42, 37.75] },
    destination: { type: "Point", coordinates: [-122.39, 37.8] },
    affectedStops: { type: "FeatureCollection", features: [] },
  },
};

const origin = {
  id: "stop:origin",
  type: "stop" as const,
  name: "24th Street Mission",
  description: "Origin stop",
  latitude: 37.75,
  longitude: -122.42,
  stopIds: ["origin"],
  routeNames: ["J Church"],
};
const destination = {
  id: "landmark:ferry-building",
  type: "landmark" as const,
  name: "Ferry Building",
  description: "Destination landmark",
  latitude: 37.8,
  longitude: -122.39,
  stopIds: [],
  routeNames: [],
};

function dependencies(
  overrides: Partial<CommuteEmailPreviewDependencies> = {},
): CommuteEmailPreviewDependencies {
  return {
    schedules: {
      listForRider: vi.fn(async () => [schedule]),
    },
    catalog: {
      getPlace: vi.fn(async ({ placeId }) => {
        if (placeId === origin.id) return origin;
        if (placeId === destination.id) return destination;
        return null;
      }),
    },
    planner: {
      plan: vi.fn(async () => plan),
    } satisfies JourneyPlanner,
    renderEmail: vi.fn((input) => ({
      subject: "Subject for " + input.schedule.departureLabel,
      html: "<html>same renderer</html>",
      text: "Text for " + input.schedule.originLabel,
    })),
    clock: () => new Date("2026-08-20T14:00:00.000Z"),
    appOrigin: "https://unbroken.test",
    ...overrides,
  };
}

describe("authenticated commute email preview module", () => {
  it("plans the saved commute with exact catalog references and renders one full message", async () => {
    const deps = dependencies();
    const preview = createCommuteEmailPreview(deps);

    await expect(preview.previewForRider("rider-a", "first")).resolves.toEqual({
      subject: "Subject for 8:30 AM",
      html: "<html>same renderer</html>",
      text: "Text for 24th Street Mission",
    });

    expect(deps.schedules.listForRider).toHaveBeenCalledWith("rider-a");
    expect(deps.catalog.getPlace).toHaveBeenNthCalledWith(1, {
      placeId: "stop:origin",
    });
    expect(deps.catalog.getPlace).toHaveBeenNthCalledWith(2, {
      placeId: "landmark:ferry-building",
    });
    expect(deps.planner.plan).toHaveBeenCalledWith({
      origin: { type: "catalog", placeId: "stop:origin" },
      destination: {
        type: "catalog",
        placeId: "landmark:ferry-building",
      },
      departureAt: "2026-08-20T15:30:00.000Z",
    });
    expect(deps.renderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        schedule: {
          originLabel: "24th Street Mission",
          destinationLabel: "Ferry Building",
          departureLabel: "8:30 AM",
          arrivalLabel: "Aug 20, 2026, 9:00 AM PDT",
        },
        plan,
        manageUrl: "https://unbroken.test/rider/trips",
        appOrigin: "https://unbroken.test",
      }),
    );
  });

  it("does not plan a missing slot and resolves the next matching saved day", async () => {
    const missing = dependencies({
      schedules: { listForRider: vi.fn(async () => []) },
    });
    const preview = createCommuteEmailPreview(missing);
    await expect(preview.previewForRider("rider-a", "return")).resolves.toBe(
      null,
    );
    expect(missing.planner.plan).not.toHaveBeenCalled();

    const nextWeek = dependencies({
      schedules: {
        listForRider: vi.fn(async () => [
          {
            ...schedule,
            days: ["friday"] as const,
            slot: "return" as const,
          },
        ]),
      },
      planner: {
        plan: vi.fn(async (request) => ({
          ...plan,
          departureAt: request.departureAt,
        })),
      } satisfies JourneyPlanner,
      clock: () => new Date("2026-08-20T16:00:00.000Z"),
    });
    const nextPreview = createCommuteEmailPreview(nextWeek);
    await nextPreview.previewForRider("rider-a", "return");
    expect(nextWeek.planner.plan).toHaveBeenCalledWith(
      expect.objectContaining({ departureAt: "2026-08-21T15:30:00.000Z" }),
    );
  });

  it("rejects unsafe subject output from the preview renderer", async () => {
    for (const subject of [" Preview ", "Preview\t", "<Preview>"]) {
      const deps = dependencies({
        renderEmail: vi.fn(() => ({
          subject,
          html: "<p>safe</p>",
          text: "Safe preview",
        })),
      });
      await expect(
        createCommuteEmailPreview(deps).previewForRider("rider-a", "first"),
      ).rejects.toThrow("COMMUTE_EMAIL_INVALID");
    }
  });

  it("rejects a planner result for a different departure", async () => {
    const deps = dependencies({
      planner: {
        plan: vi.fn(async () => ({
          ...plan,
          departureAt: "2026-08-20T16:00:00.000Z",
        })),
      } satisfies JourneyPlanner,
    });
    await expect(
      createCommuteEmailPreview(deps).previewForRider("rider-a", "first"),
    ).rejects.toThrow("COMMUTE_PLAN_INVALID");
    expect(deps.renderEmail).not.toHaveBeenCalled();
  });

  it("rejects unsafe owner IDs and duplicate commute days before planning", async () => {
    const ownerStore = vi.fn(async () => [schedule]);
    const ownerPreview = createCommuteEmailPreview(
      dependencies({ schedules: { listForRider: ownerStore } }),
    );
    await expect(
      ownerPreview.previewForRider(" rider-a", "first"),
    ).rejects.toThrow("COMMUTE_PREVIEW_OWNER_INVALID");
    expect(ownerStore).not.toHaveBeenCalled();

    const unsafeOrigin = dependencies({ appOrigin: "http://unbroken.test" });
    await expect(
      createCommuteEmailPreview(unsafeOrigin).previewForRider(
        "rider-a",
        "first",
      ),
    ).rejects.toThrow("COMMUTE_PREVIEW_ORIGIN_INVALID");
    expect(unsafeOrigin.schedules.listForRider).not.toHaveBeenCalled();

    const duplicateStore = vi.fn(async () => [
      { ...schedule, days: ["thursday", "thursday"] as const },
    ]);
    const duplicateDeps = dependencies({
      schedules: { listForRider: duplicateStore },
    });
    const duplicatePreview = createCommuteEmailPreview(duplicateDeps);
    await expect(
      duplicatePreview.previewForRider("rider-a", "first"),
    ).rejects.toThrow("COMMUTE_STORE_INVALID");
    expect(duplicateDeps.catalog.getPlace).not.toHaveBeenCalled();
  });
});
