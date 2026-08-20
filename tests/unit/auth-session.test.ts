import { describe, expect, it, vi } from "vitest";

const { getSession } = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/server/auth/index", () => ({
  auth: { api: { getSession } },
}));
vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

import { getOperatorSession, getRiderSession } from "@/server/auth/session";

describe("auth session role boundaries", () => {
  it("accepts a rider session only through the rider getter", async () => {
    getSession.mockResolvedValue({ user: { role: "rider" } });

    await expect(getRiderSession()).resolves.toMatchObject({
      user: { role: "rider" },
    });
    await expect(getOperatorSession()).resolves.toBeNull();
  });

  it("denies an operator session through the rider getter", async () => {
    getSession.mockResolvedValue({ user: { role: "admin" } });

    await expect(getOperatorSession()).resolves.toMatchObject({
      user: { role: "admin" },
    });
    await expect(getRiderSession()).resolves.toBeNull();
  });
});
