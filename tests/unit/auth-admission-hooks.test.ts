import { describe, expect, it, vi } from "vitest";

import { type AdmissionLifecyclePolicy } from "@/domain/auth/admission";
import {
  ADMISSION_MESSAGES,
  createAdmissionHooks,
  type AdmissionUser,
} from "@/server/auth/admission-hooks";

const fullMessage =
  "UNBROKEN is full for now. If you already joined, you can still continue with Google.";

function source(
  overrides: Partial<{
    action: "create-user" | "link-account" | "sign-in";
    method: string;
    providerId: string;
  }> = {},
) {
  const {
    action = "create-user",
    method = "oauth",
    providerId = "google",
  } = overrides;
  return {
    action,
    method,
    oauth: method === "oauth" ? { providerId } : undefined,
  };
}

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "Rider@Example.COM",
    role: "rider",
    name: "Rider",
    emailVerified: true,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function session(userId: string) {
  return {
    id: "session-1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    expiresAt: new Date("2026-01-02T00:00:00.000Z"),
    token: "session-token",
    userId,
  };
}

function makePolicy(
  overrides: Partial<AdmissionLifecyclePolicy> = {},
): AdmissionLifecyclePolicy & {
  reserveNewRider: ReturnType<typeof vi.fn>;
  findReservationByEmail: ReturnType<typeof vi.fn>;
  activateRider: ReturnType<typeof vi.fn>;
  ensureAdmitted: ReturnType<typeof vi.fn>;
} {
  return {
    reserveNewRider: vi.fn().mockResolvedValue({
      status: "allowed",
      reservationId: "reservation-1",
      expiresAt: new Date("2026-01-01T00:10:00.000Z"),
    }),
    findReservationByEmail: vi.fn().mockResolvedValue({
      reservationId: "reservation-1",
    }),
    activateRider: vi.fn().mockResolvedValue(undefined),
    ensureAdmitted: vi.fn().mockResolvedValue({ status: "allowed" }),
    ...overrides,
  } as AdmissionLifecyclePolicy & {
    reserveNewRider: ReturnType<typeof vi.fn>;
    findReservationByEmail: ReturnType<typeof vi.fn>;
    activateRider: ReturnType<typeof vi.fn>;
    ensureAdmitted: ReturnType<typeof vi.fn>;
  };
}

function makeHooks(
  policy: AdmissionLifecyclePolicy,
  signupFlag: unknown = "true",
  resolveUser: (userId: string) => Promise<AdmissionUser | null> = async (
    userId,
  ) => ({
    id: userId,
    email: "Rider@Example.COM",
    role: "rider",
  }),
) {
  return createAdmissionHooks({ policy, signupFlag, resolveUser });
}

describe("Better Auth admission lifecycle adapter", () => {
  it("reserves a normalized email for a first Google user creation", async () => {
    const policy = makePolicy();
    const hooks = makeHooks(policy);

    await expect(
      hooks.validateUserInfo(
        {
          user: user(),
          source: source(),
        },
        undefined as never,
      ),
    ).resolves.toBeUndefined();

    expect(policy.reserveNewRider).toHaveBeenCalledTimes(1);
    expect(policy.reserveNewRider).toHaveBeenCalledWith("rider@example.com");
  });

  it("checks the exact signup flag before reading or reserving a new Google user", async () => {
    const policy = makePolicy();
    const hooks = makeHooks(policy, "TRUE");

    const result = await hooks.validateUserInfo(
      { user: { email: "not-an-email" }, source: source() },
      undefined as never,
    );

    expect(result).toEqual({
      error: "google_signup_disabled",
      errorDescription: ADMISSION_MESSAGES.signupDisabled,
    });
    expect(policy.reserveNewRider).not.toHaveBeenCalled();
  });

  it.each([
    ["non-Google create", { action: "create-user", providerId: "github" }],
    ["link", { action: "link-account", providerId: "google" }],
    ["Google sign-in", { action: "sign-in", providerId: "google" }],
    [
      "admin create",
      { action: "create-user", method: "admin", providerId: "" },
    ],
    [
      "password create",
      { action: "create-user", method: "email-password", providerId: "" },
    ],
  ] as const)("does not reserve on %s", async (_label, overrides) => {
    const policy = makePolicy();
    const hooks = makeHooks(policy, "false");

    await expect(
      hooks.validateUserInfo(
        { user: user(), source: source(overrides) },
        undefined as never,
      ),
    ).resolves.toBeUndefined();

    expect(policy.reserveNewRider).not.toHaveBeenCalled();
  });

  it("maps a full reservation to the exact safe public copy", async () => {
    const policy = makePolicy({
      reserveNewRider: vi.fn().mockResolvedValue({ status: "full" }),
    });
    const hooks = makeHooks(policy);

    await expect(
      hooks.validateUserInfo(
        { user: user(), source: source() },
        undefined as never,
      ),
    ).resolves.toEqual({
      error: "rider_admission_full",
      errorDescription: fullMessage,
    });
  });

  it.each([
    ["paused", ADMISSION_MESSAGES.paused],
    ["unavailable", ADMISSION_MESSAGES.unavailable],
    ["invalid", ADMISSION_MESSAGES.invalid],
  ] as const)("maps %s to fixed nontechnical copy", async (status, message) => {
    const policy = makePolicy({
      reserveNewRider: vi.fn().mockResolvedValue({ status }),
    });
    const hooks = makeHooks(policy);

    const result = await hooks.validateUserInfo(
      { user: user(), source: source() },
      undefined as never,
    );

    expect(result).toEqual({
      error: `rider_admission_${status}`,
      errorDescription: message,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /count|capacity|database|error details/i,
    );
  });

  it("fails safely when reservation cannot be evaluated", async () => {
    const policy = makePolicy({
      reserveNewRider: vi
        .fn()
        .mockRejectedValue(new Error("private database detail")),
    });
    const hooks = makeHooks(policy);

    await expect(
      hooks.validateUserInfo(
        { user: user(), source: source() },
        undefined as never,
      ),
    ).resolves.toEqual({
      error: "rider_admission_unavailable",
      errorDescription: ADMISSION_MESSAGES.unavailable,
    });
  });

  it("activates only a matching reservation after Better Auth creates the user", async () => {
    const policy = makePolicy();
    const hooks = makeHooks(policy);

    await hooks.databaseHooks.user.create.after(user(), null);

    expect(policy.findReservationByEmail).toHaveBeenCalledWith(
      "rider@example.com",
    );
    expect(policy.activateRider).toHaveBeenCalledWith(
      "reservation-1",
      "user-1",
    );
  });

  it("does not activate an orphan user without a matching reservation", async () => {
    const policy = makePolicy({
      findReservationByEmail: vi.fn().mockResolvedValue(null),
    });
    const hooks = makeHooks(policy);

    await expect(
      hooks.databaseHooks.user.create.after(user(), null),
    ).resolves.toBeUndefined();
    expect(policy.activateRider).not.toHaveBeenCalled();
  });

  it("swallows after-hook policy failures without exposing details", async () => {
    const policy = makePolicy({
      findReservationByEmail: vi.fn().mockRejectedValue(new Error("secret")),
    });
    const hooks = makeHooks(policy);

    await expect(
      hooks.databaseHooks.user.create.after(user(), null),
    ).resolves.toBeUndefined();
    expect(policy.activateRider).not.toHaveBeenCalled();
  });

  it("swallows an activation failure after the user row is created", async () => {
    const policy = makePolicy({
      activateRider: vi
        .fn()
        .mockRejectedValue(new Error("private activation detail")),
    });
    const hooks = makeHooks(policy);

    await expect(
      hooks.databaseHooks.user.create.after(user(), null),
    ).resolves.toBeUndefined();
    expect(policy.findReservationByEmail).toHaveBeenCalledWith(
      "rider@example.com",
    );
  });

  it("allows an admitted rider session even when capacity is full", async () => {
    const policy = makePolicy({
      ensureAdmitted: vi.fn().mockResolvedValue({ status: "allowed" }),
    });
    const hooks = makeHooks(policy, "false");

    await expect(
      hooks.databaseHooks.session.create.before(session("user-1"), null),
    ).resolves.toBeUndefined();
    expect(policy.ensureAdmitted).toHaveBeenCalledWith(
      "user-1",
      "rider@example.com",
    );
  });

  it("fails closed when admission reports full", async () => {
    const policy = makePolicy({
      ensureAdmitted: vi.fn().mockResolvedValue({ status: "full" }),
    });
    const hooks = makeHooks(policy, "false");

    await expect(
      hooks.databaseHooks.session.create.before(session("user-1"), null),
    ).resolves.toBe(false);
  });

  it("fails closed for an unactivated rider and resolver/policy exceptions", async () => {
    const policy = makePolicy({
      ensureAdmitted: vi.fn().mockResolvedValue({ status: "unavailable" }),
    });
    const hooks = makeHooks(policy, "true");
    await expect(
      hooks.databaseHooks.session.create.before(session("orphan"), null),
    ).resolves.toBe(false);

    const failingResolver = makeHooks(makePolicy(), "true", async () => {
      throw new Error("private lookup detail");
    });
    await expect(
      failingResolver.databaseHooks.session.create.before(
        session("user-1"),
        null,
      ),
    ).resolves.toBe(false);

    const failingPolicy = makePolicy({
      ensureAdmitted: vi
        .fn()
        .mockRejectedValue(new Error("private policy detail")),
    });
    const failingEnsure = makeHooks(failingPolicy);
    await expect(
      failingEnsure.databaseHooks.session.create.before(
        session("user-1"),
        null,
      ),
    ).resolves.toBe(false);
  });

  it("rejects a resolved user whose identity does not match the session", async () => {
    const policy = makePolicy();
    const hooks = makeHooks(policy, "true", async () => ({
      id: "another-user",
      email: "rider@example.com",
      role: "rider",
    }));

    await expect(
      hooks.databaseHooks.session.create.before(session("user-1"), null),
    ).resolves.toBe(false);
    expect(policy.ensureAdmitted).not.toHaveBeenCalled();
  });

  it.each(["owner", "admin"] as const)(
    "leaves %s sessions unaffected by rider admission",
    async (role) => {
      const policy = makePolicy();
      const hooks = makeHooks(policy, "false", async (userId) => ({
        id: userId,
        email: "operator@example.com",
        role,
      }));

      await expect(
        hooks.databaseHooks.session.create.before(session(`${role}-1`), null),
      ).resolves.toBeUndefined();
      expect(policy.ensureAdmitted).not.toHaveBeenCalled();
    },
  );

  it("does not emit logs while handling private admission failures", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const policy = makePolicy({
      reserveNewRider: vi.fn().mockRejectedValue(new Error("email and count")),
    });
    const hooks = makeHooks(policy);

    await hooks.validateUserInfo(
      { user: user(), source: source() },
      undefined as never,
    );

    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
