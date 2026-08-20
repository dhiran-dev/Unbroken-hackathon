import { describe, expect, it } from "vitest";

import {
  GOOGLE_SIGNUP_UNAVAILABLE_COPY,
  PUBLIC_RIDER_ADMISSION_FULL_COPY,
  projectPublicSignupAvailability,
  publicRiderAuthCallbackMessage,
} from "@/lib/public-signup-availability";

import {
  createPublicSignupAdmissionReader,
  projectPublicSignupCapacityRow,
  type PublicSignupCapacityRow,
} from "@/server/services/public-signup-availability";

function capacityRow(
  overrides: Partial<PublicSignupCapacityRow> = {},
): PublicSignupCapacityRow {
  return {
    maxAccounts: 40,
    activeAccounts: 10,
    reservedAccounts: 0,
    admissionState: "open",
    emailCircuitState: "closed",
    ...overrides,
  };
}

describe("public rider admission availability", () => {
  it("returns only the safe public fields when admission is open", () => {
    const view = projectPublicSignupAvailability({
      admissionState: "open",
      providerConfigured: true,
      publicSignupEnabled: true,
    });

    expect(view).toEqual({
      available: true,
      message: "Continue with Google to sign in or create a rider account.",
    });
    expect(Object.keys(view).sort()).toEqual(["available", "message"]);
  });

  it("uses the approved full copy only when admission is actually full", () => {
    expect(
      projectPublicSignupAvailability({
        admissionState: "full",
        providerConfigured: true,
        publicSignupEnabled: true,
      }),
    ).toEqual({
      available: false,
      message: PUBLIC_RIDER_ADMISSION_FULL_COPY,
    });
  });

  it("uses one generic safe copy for paused or unavailable admission", () => {
    for (const admissionState of ["paused", "unavailable"] as const) {
      expect(
        projectPublicSignupAvailability({
          admissionState,
          providerConfigured: true,
          publicSignupEnabled: true,
        }),
      ).toEqual({
        available: false,
        message:
          "Continue with Google if you already have an account. New rider signup is currently unavailable.",
      });
    }
  });

  it("lets the flag-off copy win even when capacity is full", () => {
    expect(
      projectPublicSignupAvailability({
        admissionState: "full",
        providerConfigured: true,
        publicSignupEnabled: false,
      }),
    ).toEqual({
      available: false,
      message:
        "Continue with Google if you already have an account. New rider signup is currently unavailable.",
    });
  });

  it("keeps the existing-rider path when the public signup flag is off", () => {
    expect(
      projectPublicSignupAvailability({
        admissionState: "open",
        providerConfigured: true,
        publicSignupEnabled: false,
      }),
    ).toEqual({
      available: false,
      message:
        "Continue with Google if you already have an account. New rider signup is currently unavailable.",
    });
  });

  it("fails closed with the provider copy when Google is not configured", () => {
    expect(
      projectPublicSignupAvailability({
        admissionState: "open",
        providerConfigured: false,
        publicSignupEnabled: true,
      }),
    ).toEqual({
      available: false,
      message: GOOGLE_SIGNUP_UNAVAILABLE_COPY,
    });
  });

  it("maps only the allowlisted callback error and ignores descriptions", () => {
    expect(publicRiderAuthCallbackMessage("rider_admission_full")).toBe(
      PUBLIC_RIDER_ADMISSION_FULL_COPY,
    );
    expect(publicRiderAuthCallbackMessage("unknown_code")).toBe(
      GOOGLE_SIGNUP_UNAVAILABLE_COPY,
    );
    expect(publicRiderAuthCallbackMessage(undefined)).toBeNull();
  });

  it("rejects missing or malformed capacity rows", () => {
    const malformedRows: Array<PublicSignupCapacityRow | null | undefined> = [
      null,
      undefined,
      capacityRow({ maxAccounts: 39 }),
      capacityRow({ activeAccounts: -1 }),
      capacityRow({ reservedAccounts: 41 }),
      capacityRow({ activeAccounts: 20, reservedAccounts: 21 }),
      capacityRow({ activeAccounts: 1.5 }),
    ];

    for (const row of malformedRows) {
      expect(projectPublicSignupCapacityRow(row)).toBe("unavailable");
    }
  });

  it("projects only validated rows into internal state", () => {
    expect(
      projectPublicSignupCapacityRow(capacityRow({ activeAccounts: 40 })),
    ).toBe("full");
    expect(projectPublicSignupCapacityRow(capacityRow())).toBe("open");
    expect(
      projectPublicSignupCapacityRow(capacityRow({ admissionState: "paused" })),
    ).toBe("paused");
    expect(
      projectPublicSignupCapacityRow(
        capacityRow({ emailCircuitState: "open" }),
      ),
    ).toBe("paused");
  });

  it("fails closed when the injected capacity reader throws", async () => {
    const read = createPublicSignupAdmissionReader(async () => {
      throw new Error("database read failed");
    });

    await expect(read()).resolves.toBe("unavailable");
  });
});
