import { describe, expect, it, vi } from "vitest";

import {
  createCommuteDelete,
  createCommutePut,
} from "@/app/api/me/commutes/[slot]/route";
import { createCommutesGet } from "@/app/api/me/commutes/route";
import type { CommuteService, SavedCommute } from "@/domain/commute/service";

const saved: SavedCommute = {
  id: "schedule-a",
  slot: "first",
  originPlaceId: "stop:origin",
  destinationPlaceId: "landmark:ferry-building",
  days: ["monday", "friday"],
  departureTime: "08:30",
  timezone: "America/Los_Angeles",
  reminderMinutes: 30,
  paused: false,
  createdAt: "2026-08-20T12:00:00.000Z",
  updatedAt: "2026-08-20T12:00:00.000Z",
};

const rider = { userId: "rider-a", role: "rider" as const };

function sameOriginHeaders() {
  return {
    Origin: "https://unbroken.test",
    "Sec-Fetch-Site": "same-origin",
  };
}

function request(path: string, init: RequestInit = {}, withOrigin = false) {
  return new Request(`https://unbroken.test${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      ...(withOrigin ? sameOriginHeaders() : {}),
    },
  });
}

function service(overrides: Partial<CommuteService> = {}): CommuteService {
  return {
    listForRider: vi.fn(async () => [saved]),
    replaceForRider: vi.fn(async () => ({ ok: true as const, value: saved })),
    deleteForRider: vi.fn(async () => undefined),
    ...overrides,
  };
}

const readRider = vi.fn(async () => rider);

describe("GET /api/me/commutes", () => {
  it("returns only the authenticated rider's schedules", async () => {
    const commuteService = service();
    const get = createCommutesGet({ readRider, service: commuteService });

    const response = await get(request("/api/me/commutes"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ commutes: [saved] });
    expect(commuteService.listForRider).toHaveBeenCalledWith("rider-a");
  });

  it("does not expose schedules to an anonymous or operator session", async () => {
    const commuteService = service();
    const get = createCommutesGet({
      readRider: vi.fn(async () => null),
      service: commuteService,
    });

    const response = await get(request("/api/me/commutes"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      code: "COMMUTE_AUTH_REQUIRED",
      message: "Sign in with Google to manage your trips.",
    });
    expect(commuteService.listForRider).not.toHaveBeenCalled();
  });
});

describe("PUT /api/me/commutes/:slot", () => {
  it("replaces one fixed slot through a same-origin JSON request", async () => {
    const commuteService = service();
    const put = createCommutePut({ readRider, service: commuteService });
    const response = await put(
      request(
        "/api/me/commutes/return",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            originPlaceId: "stop:origin",
            destinationPlaceId: "landmark:ferry-building",
            days: ["monday"],
            departureTime: "17:05",
            reminderMinutes: 45,
            paused: true,
          }),
        },
        true,
      ),
      { params: Promise.resolve({ slot: "return" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ commute: saved });
    expect(commuteService.replaceForRider).toHaveBeenCalledWith(
      "rider-a",
      "return",
      {
        originPlaceId: "stop:origin",
        destinationPlaceId: "landmark:ferry-building",
        days: ["monday"],
        departureTime: "17:05",
        reminderMinutes: 45,
        paused: true,
      },
    );
  });

  it("rejects invalid JSON, invalid slots, and cross-site mutation before persistence", async () => {
    const replaceForRider = vi.fn(async () => ({
      ok: true as const,
      value: saved,
    }));
    const commuteService = service({ replaceForRider });
    const put = createCommutePut({ readRider, service: commuteService });
    const invalid = await put(
      request(
        "/api/me/commutes/first",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: "{not-json",
        },
        true,
      ),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      code: "COMMUTE_INVALID",
      message: "Check your trip details and try again.",
    });
    expect(replaceForRider).not.toHaveBeenCalled();

    const crossSite = await put(
      request(
        "/api/me/commutes/first",
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://evil.test",
          },
          body: JSON.stringify({
            originPlaceId: "stop:origin",
            destinationPlaceId: "landmark:ferry-building",
            days: ["monday"],
            departureTime: "08:30",
          }),
        },
        false,
      ),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(crossSite.status).toBe(403);
    await expect(crossSite.json()).resolves.toEqual({
      code: "COMMUTE_CSRF_FORBIDDEN",
      message: "This request could not be verified. Try again.",
    });

    const invalidSlot = await put(
      request(
        "/api/me/commutes/other",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
        true,
      ),
      { params: Promise.resolve({ slot: "other" }) },
    );
    expect(invalidSlot.status).toBe(400);
    await expect(invalidSlot.json()).resolves.toEqual({
      code: "COMMUTE_INVALID",
      message: "Check your trip details and try again.",
    });
    expect(replaceForRider).not.toHaveBeenCalled();
  });

  it("returns 400 for same-origin non-JSON and bodies over 64 KiB without Content-Length", async () => {
    const replaceForRider = vi.fn(async () => ({
      ok: true as const,
      value: saved,
    }));
    const commuteService = service({ replaceForRider });
    const put = createCommutePut({ readRider, service: commuteService });

    const nonJson = await put(
      request(
        "/api/me/commutes/first",
        {
          method: "PUT",
          headers: { "Content-Type": "text/plain" },
          body: "{}",
        },
        true,
      ),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(nonJson.status).toBe(400);

    const oversized = await put(
      request(
        "/api/me/commutes/first",
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ payload: "x".repeat(70 * 1024) }),
        },
        true,
      ),
      { params: Promise.resolve({ slot: "first" }) },
    );
    expect(oversized.status).toBe(400);
    await expect(oversized.json()).resolves.toEqual({
      code: "COMMUTE_INVALID",
      message: "Check your trip details and try again.",
    });
    expect(replaceForRider).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/me/commutes/:slot", () => {
  it("is idempotent and remains scoped to the current rider", async () => {
    const deleteForRider = vi.fn(async () => undefined);
    const commuteService = service({ deleteForRider });
    const remove = createCommuteDelete({ readRider, service: commuteService });

    const response = await remove(
      request("/api/me/commutes/return", { method: "DELETE" }, true),
      { params: Promise.resolve({ slot: "return" }) },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deleted: true,
      slot: "return",
    });
    expect(deleteForRider).toHaveBeenCalledWith("rider-a", "return");
  });
});
