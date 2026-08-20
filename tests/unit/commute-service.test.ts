import { describe, expect, it, vi } from "vitest";

import {
  createCommuteService,
  type CommutePlaceCatalog,
  type CommuteScheduleStore,
  type StoredCommute,
} from "@/domain/commute/service";
import type { CommuteDay } from "@/domain/commute/schedule";

const origin = { id: "stop:origin" };
const destination = { id: "landmark:ferry-building" };
const record: StoredCommute = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "rider-a",
  slot: "first",
  originPlaceId: origin.id,
  destinationPlaceId: destination.id,
  days: ["monday", "friday"],
  departureTime: "08:30",
  timezone: "America/Los_Angeles",
  reminderMinutes: 30,
  paused: false,
  createdAt: new Date("2026-08-20T12:00:00.000Z"),
  updatedAt: new Date("2026-08-20T12:00:00.000Z"),
};

function store(overrides: Partial<CommuteScheduleStore> = {}) {
  return {
    listForRider: vi.fn(async () => [record]),
    replaceForRider: vi.fn(async () => record),
    deleteForRider: vi.fn(async () => undefined),
    ...overrides,
  } satisfies CommuteScheduleStore;
}

function catalog(overrides: Partial<CommutePlaceCatalog> = {}) {
  return {
    getPlace: vi.fn(async ({ placeId }: { placeId: string }) => {
      if (placeId === origin.id) return origin;
      if (placeId === destination.id) return destination;
      return null;
    }),
    ...overrides,
  } satisfies CommutePlaceCatalog;
}

const validInput = {
  originPlaceId: origin.id,
  destinationPlaceId: destination.id,
  days: ["friday", "monday"],
  departureTime: "08:30",
  reminderMinutes: 30,
  paused: false,
};

describe("saved commute manager seam", () => {
  it("validates selected catalog places before one atomic replacement", async () => {
    const scheduleStore = store();
    const placeCatalog = catalog();
    const manager = createCommuteService(scheduleStore, placeCatalog);

    await expect(
      manager.replaceForRider("rider-a", "first", validInput),
    ).resolves.toEqual({
      ok: true,
      value: {
        id: record.id,
        slot: "first",
        originPlaceId: origin.id,
        destinationPlaceId: destination.id,
        days: ["monday", "friday"],
        departureTime: "08:30",
        timezone: "America/Los_Angeles",
        reminderMinutes: 30,
        paused: false,
        createdAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
    });
    expect(scheduleStore.replaceForRider).toHaveBeenCalledWith(
      "rider-a",
      "first",
      {
        ...validInput,
        days: ["monday", "friday"],
        timezone: "America/Los_Angeles",
      },
    );
  });

  it.each([
    ["current location", { ...validInput, originPlaceId: "current_location" }],
    ["unknown place", { ...validInput, originPlaceId: "stop:missing" }],
    ["invalid reminder", { ...validInput, reminderMinutes: 5 }],
  ])("rejects %s before writing any schedule", async (_name, input) => {
    const scheduleStore = store();
    const placeCatalog = catalog();
    const manager = createCommuteService(scheduleStore, placeCatalog);

    await expect(
      manager.replaceForRider("rider-a", "return", input),
    ).resolves.toEqual({ ok: false, code: "COMMUTE_INVALID" });
    expect(scheduleStore.replaceForRider).not.toHaveBeenCalled();
  });

  it("returns only the current rider's safe schedule projection", async () => {
    const manager = createCommuteService(store(), catalog());

    await expect(manager.listForRider("rider-a")).resolves.toEqual([
      {
        id: record.id,
        slot: "first",
        originPlaceId: origin.id,
        destinationPlaceId: destination.id,
        days: ["monday", "friday"],
        departureTime: "08:30",
        timezone: "America/Los_Angeles",
        reminderMinutes: 30,
        paused: false,
        createdAt: "2026-08-20T12:00:00.000Z",
        updatedAt: "2026-08-20T12:00:00.000Z",
      },
    ]);
  });

  it("fails the whole read for foreign, malformed, duplicate, or excess rows", async () => {
    const returnRecord = {
      ...record,
      id: "00000000-0000-4000-8000-000000000004",
      slot: "return" as const,
    };
    const foreign = {
      ...record,
      id: "00000000-0000-4000-8000-000000000002",
      userId: "rider-b",
    };
    const malformed = {
      ...record,
      id: "00000000-0000-4000-8000-000000000003",
      days: ["monday", "monday"] as never,
    };
    const duplicate = {
      ...record,
      id: "00000000-0000-4000-8000-000000000005",
    };
    const excess = {
      ...returnRecord,
      id: "00000000-0000-4000-8000-000000000006",
    };

    for (const rows of [
      [foreign, record],
      [malformed, record],
      [record, duplicate],
      [record, returnRecord, excess],
    ]) {
      const scheduleStore = store({
        listForRider: vi.fn(async () => rows),
      });
      const manager = createCommuteService(scheduleStore, catalog());
      await expect(manager.listForRider("rider-a")).rejects.toThrow(
        "COMMUTE_STORE_INVALID",
      );
    }
  });

  it("returns first then return in stable order and copies days defensively", async () => {
    const returnRecord = {
      ...record,
      id: "00000000-0000-4000-8000-000000000004",
      slot: "return" as const,
    };
    const scheduleStore = store({
      listForRider: vi.fn(async () => [returnRecord, record]),
    });
    const manager = createCommuteService(scheduleStore, catalog());

    const first = await manager.listForRider("rider-a");
    expect(first.map((commute) => commute.id)).toEqual([
      record.id,
      returnRecord.id,
    ]);
    (first[0]?.days as CommuteDay[] | undefined)?.push("tuesday");

    const second = await manager.listForRider("rider-a");
    expect(second[0]?.days).toEqual(["monday", "friday"]);
  });

  it("rejects a catalog response whose id does not exactly match the selected place", async () => {
    const scheduleStore = store();
    const placeCatalog = catalog({
      getPlace: vi.fn(async ({ placeId }) => ({
        id: placeId === origin.id ? "stop:another-place" : placeId,
      })),
    });
    const manager = createCommuteService(scheduleStore, placeCatalog);

    await expect(
      manager.replaceForRider("rider-a", "first", validInput),
    ).resolves.toEqual({ ok: false, code: "COMMUTE_INVALID" });
    expect(scheduleStore.replaceForRider).not.toHaveBeenCalled();
  });

  it("preserves a paused replacement and scopes deletes to the owner", async () => {
    const pausedRecord = { ...record, paused: true };
    const deleteForRider = vi.fn(async () => undefined);
    const scheduleStore = store({
      replaceForRider: vi.fn(async () => pausedRecord),
      deleteForRider,
    });
    const manager = createCommuteService(scheduleStore, catalog());

    await expect(
      manager.replaceForRider("rider-a", "first", {
        ...validInput,
        paused: true,
      }),
    ).resolves.toMatchObject({ ok: true, value: { paused: true } });
    await manager.deleteForRider("rider-a", "return");
    expect(deleteForRider).toHaveBeenCalledWith("rider-a", "return");
  });

  it("fails closed when persistence returns another rider's replacement", async () => {
    const scheduleStore = store({
      replaceForRider: vi.fn(async () => ({
        ...record,
        userId: "rider-b",
      })),
    });
    const manager = createCommuteService(scheduleStore, catalog());

    await expect(
      manager.replaceForRider("rider-a", "first", validInput),
    ).rejects.toThrow("COMMUTE_STORE_INVALID");
  });
});
