import {
  ADMISSION_MESSAGES as DOMAIN_ADMISSION_MESSAGES,
  normalizeAdmissionEmail,
  type AdmissionLifecyclePolicy,
  type AdmissionReservation,
  type AdmissionReservationLookup,
} from "@/domain/auth/admission";
import type {
  GenericEndpointContext,
  Session,
  User,
  ValidateUserInfoResult,
  ValidateUserInfoSource,
} from "better-auth";

export const ADMISSION_MESSAGES = {
  signupDisabled: "Google rider signup is currently unavailable.",
  full: DOMAIN_ADMISSION_MESSAGES.full,
  paused: DOMAIN_ADMISSION_MESSAGES.paused,
  unavailable: DOMAIN_ADMISSION_MESSAGES.unavailable,
  invalid: DOMAIN_ADMISSION_MESSAGES.invalid,
} as const;

export type AdmissionUser = {
  id: string;
  email: unknown;
  role: unknown;
};

export type AdmissionHooksOptions = {
  policy: AdmissionLifecyclePolicy;
  signupFlag: unknown;
  resolveUser: (userId: string) => Promise<AdmissionUser | null>;
};

export type AdmissionUserInfoGate = (
  data: {
    user: Partial<User> & Record<string, unknown>;
    source: ValidateUserInfoSource;
  },
  context: GenericEndpointContext,
) => Promise<void | ValidateUserInfoResult>;

export type AdmissionUserCreateAfter = (
  user: User & Record<string, unknown>,
  context: GenericEndpointContext | null,
) => Promise<void>;

export type AdmissionSessionCreateBefore = (
  session: Session & Record<string, unknown>,
  context: GenericEndpointContext | null,
) => Promise<boolean | void>;

export type AdmissionHooks = {
  validateUserInfo: AdmissionUserInfoGate;
  userCreateAfter: AdmissionUserCreateAfter;
  sessionCreateBefore: AdmissionSessionCreateBefore;
  databaseHooks: {
    user: { create: { after: AdmissionUserCreateAfter } };
    session: { create: { before: AdmissionSessionCreateBefore } };
  };
};

const SAFE_ID_MAX_LENGTH = 200;

function normalizedId(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > SAFE_ID_MAX_LENGTH ||
    value.trim() !== value ||
    /[<>\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function rejection(
  error: string,
  errorDescription: string,
): ValidateUserInfoResult {
  return { error, errorDescription };
}

function googleCreate(source: ValidateUserInfoSource) {
  return (
    source.action === "create-user" &&
    source.method === "oauth" &&
    source.oauth?.providerId === "google"
  );
}

function reserveFailure(
  value: AdmissionReservation,
): ValidateUserInfoResult | undefined {
  if (value.status === "allowed") {
    return normalizedId(value.reservationId)
      ? undefined
      : admissionUnavailable();
  }
  if (value.status === "full") {
    return rejection("rider_admission_full", ADMISSION_MESSAGES.full);
  }
  if (value.status === "paused") {
    return rejection("rider_admission_paused", ADMISSION_MESSAGES.paused);
  }
  if (value.status === "invalid") {
    return rejection("rider_admission_invalid", ADMISSION_MESSAGES.invalid);
  }
  return rejection(
    "rider_admission_unavailable",
    ADMISSION_MESSAGES.unavailable,
  );
}

function admissionUnavailable(): ValidateUserInfoResult {
  return rejection(
    "rider_admission_unavailable",
    ADMISSION_MESSAGES.unavailable,
  );
}

export function createAdmissionHooks(
  options: AdmissionHooksOptions,
): AdmissionHooks {
  const validateUserInfo: AdmissionUserInfoGate = async ({ user, source }) => {
    if (!googleCreate(source)) return undefined;

    if (options.signupFlag !== "true") {
      return rejection(
        "google_signup_disabled",
        ADMISSION_MESSAGES.signupDisabled,
      );
    }

    const email = normalizeAdmissionEmail(user.email);
    if (!email) {
      return rejection("rider_admission_invalid", ADMISSION_MESSAGES.invalid);
    }

    try {
      const result = await options.policy.reserveNewRider(email);
      return reserveFailure(result);
    } catch {
      return admissionUnavailable();
    }
  };

  const userCreateAfter: AdmissionUserCreateAfter = async (user) => {
    const email = normalizeAdmissionEmail(user.email);
    const userId = normalizedId(user.id);
    if (!email || !userId) return;
    if (
      user.role !== undefined &&
      user.role !== "rider" &&
      user.role !== null
    ) {
      return;
    }

    try {
      const reservation: AdmissionReservationLookup | null =
        await options.policy.findReservationByEmail(email);
      if (!reservation) return;
      const reservationId = normalizedId(reservation.reservationId);
      if (!reservationId) return;
      await options.policy.activateRider(reservationId, userId);
    } catch {
      // The session gate remains fail-closed if activation cannot be proven.
    }
  };

  const sessionCreateBefore: AdmissionSessionCreateBefore = async (session) => {
    const userId = normalizedId(session.userId);
    if (!userId) return false;

    let resolved: AdmissionUser | null;
    try {
      resolved = await options.resolveUser(userId);
    } catch {
      return false;
    }
    if (!resolved) return false;
    const resolvedId = normalizedId(resolved.id);
    if (!resolvedId || resolvedId !== userId) return false;

    if (resolved.role === "owner" || resolved.role === "admin") {
      return undefined;
    }
    if (resolved.role !== "rider") return false;

    const email = normalizeAdmissionEmail(resolved.email);
    if (!email) return false;

    try {
      const result = await options.policy.ensureAdmitted(userId, email);
      return result.status === "allowed" ? undefined : false;
    } catch {
      return false;
    }
  };

  return {
    validateUserInfo,
    userCreateAfter,
    sessionCreateBefore,
    databaseHooks: {
      user: { create: { after: userCreateAfter } },
      session: { create: { before: sessionCreateBefore } },
    },
  };
}
