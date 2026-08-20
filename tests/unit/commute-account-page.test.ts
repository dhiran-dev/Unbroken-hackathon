import { describe, expect, it } from "vitest";

import {
  COMMUTE_ACCOUNT_SLOTS,
  createCommuteFormValue,
  createEmptyCommuteCards,
  formatCommuteDays,
  formatDepartureTime,
  normalizeCommutesPayload,
  normalizeEmailHistoryPayload,
  normalizePlaceSearchPayload,
  toCommuteDraft,
  type CommutePlaceChoice,
  type SavedCommuteCard,
} from "@/domain/commute/account-page";

const origin: CommutePlaceChoice = {
  id: "stop:origin",
  type: "stop",
  name: "Market Street stop",
  description: "Muni stop",
  latitude: 37.78,
  longitude: -122.41,
  stopIds: ["origin"],
  routeNames: ["5 Fulton"],
};

const destination: CommutePlaceChoice = {
  id: "landmark:ferry-building",
  type: "landmark",
  name: "Ferry Building",
  description: "Destination point",
  latitude: 37.7955,
  longitude: -122.3937,
  stopIds: [],
  routeNames: [],
};

const savedFirst = {
  id: "00000000-0000-4000-8000-000000000001",
  slot: "first" as const,
  originPlaceId: origin.id,
  destinationPlaceId: destination.id,
  days: ["monday", "friday"] as const,
  departureTime: "08:30",
  timezone: "America/Los_Angeles" as const,
  reminderMinutes: 30 as const,
  paused: false,
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

describe("My trips account seam", () => {
  it("keeps exactly first and return cards in stable order", () => {
    const cards = createEmptyCommuteCards([
      { ...savedFirst, slot: "return" as const },
      savedFirst,
    ]);

    expect(COMMUTE_ACCOUNT_SLOTS).toEqual(["first", "return"]);
    expect(cards.map((card) => card.slot)).toEqual(["first", "return"]);
    expect(cards[0]?.commute?.id).toBe(savedFirst.id);
    expect(cards[1]?.commute?.slot).toBe("return");
  });

  it("renders an empty card when a saved slot is absent", () => {
    const cards = createEmptyCommuteCards([savedFirst]);

    expect(cards[0]?.commute?.slot).toBe("first");
    expect(cards[1]).toEqual({ slot: "return", commute: null });
  });

  it("accepts only safe saved schedules and rejects duplicates or GPS places", () => {
    expect(normalizeCommutesPayload({ commutes: [savedFirst] })).toMatchObject([
      { slot: "first", originPlaceId: origin.id },
    ]);

    expect(
      normalizeCommutesPayload({
        commutes: [
          savedFirst,
          { ...savedFirst, id: "00000000-0000-4000-8000-000000000002" },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeCommutesPayload({
        commutes: [{ ...savedFirst, originPlaceId: "current_location" }],
      }),
    ).toBeNull();
    expect(normalizeCommutesPayload({ commutes: ["stop:origin"] })).toBeNull();
  });

  it("normalizes place choices from the existing grouped search response", () => {
    expect(
      normalizePlaceSearchPayload({
        groups: [
          { id: "nearby_stops", label: "Nearby stops", places: [origin] },
          { id: "stations", label: "Stations", places: [] },
          {
            id: "places",
            label: "Places",
            places: [destination],
          },
        ],
      }),
    ).toEqual([[origin], [], [destination]]);

    expect(
      normalizePlaceSearchPayload({
        groups: [
          { id: "nearby_stops", label: "Nearby stops", places: [origin] },
          { id: "nearby_stops", label: "Nearby stops", places: [origin] },
        ],
      }),
    ).toBeNull();
    expect(
      normalizePlaceSearchPayload({
        groups: [
          {
            id: "nearby_stops",
            label: "Nearby stops",
            places: [
              {
                ...origin,
                stopIds: Array.from(
                  { length: 65 },
                  (_, index) => `stop-${index}`,
                ),
              },
            ],
          },
          { id: "stations", label: "Stations", places: [] },
          { id: "places", label: "Places", places: [] },
        ],
      }),
    ).toBeNull();

    expect(
      normalizePlaceSearchPayload({
        groups: [
          {
            id: "nearby_stops",
            label: "Nearby stops",
            places: [{ ...origin, stopIds: ["origin", "origin"] }],
          },
          { id: "stations", label: "Stations", places: [] },
          { id: "places", label: "Places", places: [] },
        ],
      }),
    ).toBeNull();
    expect(
      normalizePlaceSearchPayload({
        groups: [
          {
            id: "nearby_stops",
            label: "Nearby stops",
            places: [{ ...origin, latitude: 0 }],
          },
          { id: "stations", label: "Stations", places: [] },
          { id: "places", label: "Places", places: [] },
        ],
      }),
    ).toBeNull();

    expect(
      normalizePlaceSearchPayload({
        groups: [
          { id: "stations", label: "Stations", places: [] },
          { id: "nearby_stops", label: "Nearby stops", places: [origin] },
          { id: "places", label: "Places", places: [] },
        ],
      }),
    ).toBeNull();
  });

  it("builds a saved draft only from selected catalog choices", () => {
    const card: SavedCommuteCard = {
      slot: "first",
      commute: savedFirst,
    };
    expect(
      toCommuteDraft({
        origin,
        destination,
        days: ["monday", "friday"],
        departureTime: "08:30",
        reminderMinutes: 30,
        paused: true,
      }),
    ).toEqual({
      originPlaceId: origin.id,
      destinationPlaceId: destination.id,
      days: ["monday", "friday"],
      departureTime: "08:30",
      reminderMinutes: 30,
      paused: true,
    });
    expect(
      toCommuteDraft({
        origin: null,
        destination,
        days: ["monday"],
        departureTime: "08:30",
        reminderMinutes: 30,
        paused: false,
      }),
    ).toBeNull();
    expect(
      toCommuteDraft({
        origin: { id: "stop:typed-by-rider" } as CommutePlaceChoice,
        destination,
        days: ["monday"],
        departureTime: "08:30",
        reminderMinutes: 30,
        paused: false,
      }),
    ).toBeNull();
    expect(card.commute?.originPlaceId).toBe(origin.id);
  });

  it("reloads exact catalog labels into the editor without turning IDs into text", () => {
    const form = createCommuteFormValue(savedFirst, [origin, destination]);
    expect(form.origin?.name).toBe("Market Street stop");
    expect(form.destination?.name).toBe("Ferry Building");
    expect(toCommuteDraft(form)).toMatchObject({
      originPlaceId: "stop:origin",
      destinationPlaceId: "landmark:ferry-building",
    });
  });

  it("rejects impossible timestamp values instead of trusting their shape", () => {
    expect(
      normalizeCommutesPayload({
        commutes: [
          {
            ...savedFirst,
            createdAt: "2026-02-30T12:00:00.000Z",
          },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeCommutesPayload({
        commutes: [
          {
            ...savedFirst,
            updatedAt: "2026-08-20T12:00:00+00:00",
          },
        ],
      }),
    ).toBeNull();
  });

  it("uses plain rider labels for days and Pacific departure time", () => {
    expect(formatCommuteDays(["monday", "wednesday", "friday"])).toBe(
      "Monday, Wednesday, Friday",
    );
    expect(formatCommuteDays([])).toBe("No days selected");
    expect(formatDepartureTime("08:30")).toBe("8:30 AM");
    expect(formatDepartureTime("17:05")).toBe("5:05 PM");
    expect(formatDepartureTime("bad")).toBe("Time unavailable");
  });

  it("keeps only bounded, owner-safe email history entries", () => {
    expect(
      normalizeEmailHistoryPayload({
        deliveries: [
          {
            serviceDate: "2026-08-20",
            slot: "first",
            status: "sent",
            providerId: "secret",
          },
        ],
      }),
    ).toEqual([{ serviceDate: "2026-08-20", slot: "first", status: "sent" }]);
    expect(
      normalizeEmailHistoryPayload({
        deliveries: [
          { serviceDate: "2026-02-30", slot: "first", status: "sent" },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeEmailHistoryPayload({
        deliveries: [
          { serviceDate: "2026-08-20", slot: "first", status: "sent" },
          { serviceDate: "2026-08-20", slot: "first", status: "failed" },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeEmailHistoryPayload({
        deliveries: [
          { serviceDate: "2026-08-20", slot: "first", status: "sent" },
          { serviceDate: "2026-08-20", slot: "return", status: "sent" },
        ],
      }),
    ).toHaveLength(2);
    expect(
      normalizeEmailHistoryPayload({
        deliveries: Array.from({ length: 21 }, (_, index) => ({
          serviceDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
          slot: "first",
          status: "sent",
        })),
      }),
    ).toBeNull();
  });
});
