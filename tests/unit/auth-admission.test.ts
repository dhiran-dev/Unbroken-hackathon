import { beforeEach, describe, expect, it } from "vitest";

import {
  ADMISSION_MESSAGES,
  normalizeAdmissionEmail,
  RESERVATION_TTL_MS,
} from "@/domain/auth/admission";
import { createInMemoryAdmissionHarness } from "@/../tests/support/auth-admission";

describe("admission email seam", () => {
  it("normalizes only with NFKC, trim, and lowercase", () => {
    expect(normalizeAdmissionEmail("  Ｒider＠Example．COM  ")).toBe(
      "rider@example.com",
    );
  });

  it.each([
    "",
    "not-an-email",
    "rider@example",
    "rider @example.com",
    "rider<safe>@example.com",
    "rider\u0000@example.com",
    "\uD800rider@example.com",
    "rider@" + "a".repeat(250) + ".com",
  ])("rejects bounded-invalid email input %s", (email) => {
    expect(normalizeAdmissionEmail(email)).toBeNull();
  });

  it("keeps public admission messages fixed and free of input data", () => {
    expect(ADMISSION_MESSAGES).toEqual({
      allowed: "Continue with Google.",
      full: "UNBROKEN is full for now. If you already joined, you can still continue with Google.",
      paused:
        "New rider signups are paused for now. Existing riders can continue with Google.",
      invalid: "Google sign-in could not be started.",
      unavailable: "Google sign-in could not be started.",
    });
  });
});

describe("rider admission policy public seam", () => {
  let harness: ReturnType<typeof createInMemoryAdmissionHarness>;

  beforeEach(() => {
    harness = createInMemoryAdmissionHarness();
  });

  it("reserves one place and makes a repeated same-email request idempotent", async () => {
    const first = await harness.policy.reserveNewRider("  rider@example.com  ");
    const repeated = await harness.policy.reserveNewRider("RIDER@EXAMPLE.COM");

    expect(first.status).toBe("allowed");
    expect(repeated).toEqual(first);
    expect(JSON.stringify(first)).not.toContain("rider@example.com");
  });

  it("exposes only the reservation id through the lifecycle lookup seam", async () => {
    const reservation =
      await harness.policy.reserveNewRider("lookup@example.com");
    if (reservation.status !== "allowed")
      throw new Error("expected reservation");

    await expect(
      harness.policy.findReservationByEmail(" LOOKUP@EXAMPLE.COM "),
    ).resolves.toEqual({ reservationId: reservation.reservationId });
    await expect(
      harness.policy.findReservationByEmail("not-an-email"),
    ).resolves.toBeNull();
  });

  it("returns invalid without disclosing malformed email input", async () => {
    const result = await harness.policy.reserveNewRider(
      "private-not-an-email@example",
    );

    expect(result).toEqual({ status: "invalid" });
    expect(JSON.stringify(result)).not.toContain("private-not-an-email");
  });

  it("admits the thirty-ninth and fortieth rider, then returns full", async () => {
    harness.seedActiveUsers(38);

    expect(
      (await harness.policy.reserveNewRider("rider39@example.com")).status,
    ).toBe("allowed");
    expect(
      (await harness.policy.reserveNewRider("rider40@example.com")).status,
    ).toBe("allowed");
    expect(
      (await harness.policy.reserveNewRider("rider41@example.com")).status,
    ).toBe("full");
  });

  it("releases all abandoned places before deciding the next request", async () => {
    for (let index = 0; index < 40; index += 1) {
      await expect(
        harness.policy.reserveNewRider(`abandoned-${index}@example.com`),
      ).resolves.toMatchObject({ status: "allowed" });
    }

    harness.advancePastReservationTtl();
    await expect(
      harness.policy.reserveNewRider("new@example.com"),
    ).resolves.toMatchObject({ status: "allowed" });
    expect(harness.snapshot().capacity).toMatchObject({
      activeAccounts: 0,
      reservedAccounts: 1,
    });
  });

  it("does not activate a reservation for a rider with a mismatched stored email", async () => {
    harness.seedUser("rider-1", "different@example.com");
    const reservation = await harness.policy.reserveNewRider(
      "reserved@example.com",
    );
    if (reservation.status !== "allowed")
      throw new Error("expected reservation");
    const before = harness.snapshot();

    await expect(
      harness.policy.activateRider(reservation.reservationId, "rider-1"),
    ).resolves.toBeUndefined();

    const after = harness.snapshot();
    expect(after.capacity).toEqual(before.capacity);
    expect(after.reservations).toEqual(before.reservations);
  });

  it("fails closed for an activated reservation whose profile is missing", async () => {
    harness.seedActivatedReservation(
      "activated-without-profile",
      "rider-1",
      "rider@example.com",
    );
    const before = harness.snapshot();

    await expect(
      harness.policy.activateRider("activated-without-profile", "rider-1"),
    ).resolves.toBeUndefined();
    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toEqual({ status: "unavailable" });

    const after = harness.snapshot();
    expect(after.capacity).toEqual(before.capacity);
    expect(after.profiles).toEqual(before.profiles);
  });

  it("has exactly one winner for the final place across parallel requests", async () => {
    harness.seedActiveUsers(39);

    const results = await Promise.all([
      harness.policy.reserveNewRider("one@example.com"),
      harness.policy.reserveNewRider("two@example.com"),
    ]);

    expect(
      results.filter((result) => result.status === "allowed"),
    ).toHaveLength(1);
    expect(results.filter((result) => result.status === "full")).toHaveLength(
      1,
    );
  });

  it("lets an admitted rider continue while capacity is full", async () => {
    harness.seedRider("rider-1", "rider@example.com");
    harness.seedActiveUsers(39);

    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("expires abandoned reservations without deleting their identity", async () => {
    const reservation = await harness.policy.reserveNewRider(
      "abandoned@example.com",
    );
    expect(reservation.status).toBe("allowed");

    harness.advancePastReservationTtl();
    await expect(
      harness.policy.releaseExpiredReservations(harness.now()),
    ).resolves.toBe(1);

    if (reservation.status !== "allowed")
      throw new Error("expected reservation");
    await expect(
      harness.policy.activateRider(reservation.reservationId, "missing-user"),
    ).resolves.toBeUndefined();
    expect(
      (await harness.policy.reserveNewRider("abandoned@example.com")).status,
    ).toBe("allowed");
  });

  it("activates a current reservation and remains idempotent", async () => {
    harness.seedUser("rider-1", "rider@example.com");
    const reservation =
      await harness.policy.reserveNewRider("rider@example.com");
    if (reservation.status !== "allowed")
      throw new Error("expected reservation");

    await expect(
      harness.policy.activateRider(reservation.reservationId, "rider-1"),
    ).resolves.toBeUndefined();
    await expect(
      harness.policy.activateRider(reservation.reservationId, "rider-1"),
    ).resolves.toBeUndefined();
    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("activates a leftover reservation when the rider profile already exists", async () => {
    harness.seedRider("rider-1", "rider@example.com");
    const reservation =
      await harness.policy.reserveNewRider("rider@example.com");
    if (reservation.status !== "allowed")
      throw new Error("expected reservation");

    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toMatchObject({
      status: "allowed",
      reservationId: reservation.reservationId,
    });
    expect(harness.snapshot().capacity).toMatchObject({
      activeAccounts: 1,
      reservedAccounts: 0,
    });
  });

  it("atomically reserves and activates an orphan rider when capacity is open", async () => {
    harness.seedUser("rider-1", "rider@example.com");

    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toMatchObject({ status: "allowed" });
    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("leaves a reservation untouched when activation has no rider user", async () => {
    const reservation = await harness.policy.reserveNewRider(
      "callback@example.com",
    );
    if (reservation.status !== "allowed")
      throw new Error("expected reservation");

    await expect(
      harness.policy.activateRider(reservation.reservationId, "missing-user"),
    ).resolves.toBeUndefined();
    await expect(
      harness.policy.reserveNewRider("callback@example.com"),
    ).resolves.toEqual(reservation);
  });

  it("pauses new admission for a paused state or open email circuit", async () => {
    harness.setAdmissionState("paused");
    await expect(
      harness.policy.reserveNewRider("paused@example.com"),
    ).resolves.toEqual({ status: "paused" });

    harness.setAdmissionState("open");
    harness.setEmailCircuitState("open");
    await expect(
      harness.policy.reserveNewRider("circuit@example.com"),
    ).resolves.toEqual({ status: "paused" });
  });

  it("keeps an existing profile admissible while new admission is paused", async () => {
    harness.seedRider("rider-1", "rider@example.com");
    harness.setAdmissionState("paused");

    await expect(
      harness.policy.ensureAdmitted("rider-1", "rider@example.com"),
    ).resolves.toMatchObject({ status: "allowed" });
  });

  it("rejects an operator identity without attempting provider attachment", async () => {
    harness.seedUser("operator-1", "owner@example.com", "owner");

    await expect(
      harness.policy.ensureAdmitted("operator-1", "owner@example.com"),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("uses database time instead of trusting a future cleanup argument", async () => {
    await harness.policy.reserveNewRider("clock@example.com");

    await expect(
      harness.policy.releaseExpiredReservations(
        new Date(harness.now().getTime() + RESERVATION_TTL_MS * 100),
      ),
    ).resolves.toBe(0);

    harness.advancePastReservationTtl();
    await expect(
      harness.policy.releaseExpiredReservations(new Date(0)),
    ).resolves.toBe(1);
  });

  it("reconciles expired reservations and remains idempotent", async () => {
    await harness.policy.reserveNewRider("one@example.com");
    await harness.policy.reserveNewRider("two@example.com");
    harness.advancePastReservationTtl();

    await expect(
      harness.policy.reconcileReservations(harness.now()),
    ).resolves.toMatchObject({
      expiredReservations: 2,
      activeAccounts: 0,
      reservedAccounts: 0,
    });
    await expect(
      harness.policy.reconcileReservations(harness.now()),
    ).resolves.toMatchObject({
      expiredReservations: 0,
      activeAccounts: 0,
      reservedAccounts: 0,
    });
  });

  it("fails closed when the store is unavailable without leaking email", async () => {
    harness.failNextOperation();
    const result = await harness.policy.reserveNewRider("secret@example.com");

    expect(result).toEqual({ status: "unavailable" });
    expect(JSON.stringify(result)).not.toContain("secret@example.com");
  });
});
