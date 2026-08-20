export const RIDER_ACCOUNT_CAP = 40;
export const RESERVATION_TTL_MS = 10 * 60 * 1000;
export const MAX_ADMISSION_EMAIL_LENGTH = 254;

export const ADMISSION_MESSAGES = {
  allowed: "Continue with Google.",
  full: "UNBROKEN is full for now. If you already joined, you can still continue with Google.",
  paused:
    "New rider signups are paused for now. Existing riders can continue with Google.",
  invalid: "Google sign-in could not be started.",
  unavailable: "Google sign-in could not be started.",
} as const;

export const DOMAIN_ADMISSION_MESSAGES = ADMISSION_MESSAGES;

export type AdmissionStatus =
  "allowed" | "full" | "paused" | "invalid" | "unavailable";

export type AdmissionReservation =
  | {
      status: "allowed";
      reservationId: string;
      expiresAt: Date;
    }
  | {
      status: Exclude<AdmissionStatus, "allowed">;
    };

export type AdmissionActivation =
  { status: "allowed" } | { status: "invalid" | "unavailable" };

export type AdmissionEnsurement =
  | { status: "allowed"; reservationId?: string }
  | { status: Exclude<AdmissionStatus, "allowed"> };

export type AdmissionReconciliation = {
  expiredReservations: number;
  activeAccounts: number;
  reservedAccounts: number;
};

export type AdmissionCapacityRecord = {
  maxAccounts: number;
  activeAccounts: number;
  reservedAccounts: number;
  admissionState: string;
  emailCircuitState: string;
};

export type AdmissionReservationRecord = {
  id: string;
  email: string;
  status: "reserved" | "activated" | "released" | "expired";
  userId: string | null;
  expiresAt: Date;
};

export type AdmissionUserRecord = {
  id: string;
  email: string;
  role: string;
};

export type AdmissionReservationInput = {
  email: string;
  status: "reserved" | "activated";
  userId: string | null;
  expiresAt: Date;
};

export type AdmissionCountDelta = {
  activeAccounts: number;
  reservedAccounts: number;
};

export interface AdmissionTransaction {
  currentTime(): Promise<Date>;
  lockCapacity(): Promise<AdmissionCapacityRecord | null>;
  expireReservations(cutoff: Date): Promise<number>;
  findReservationByEmail(
    email: string,
  ): Promise<AdmissionReservationRecord | null>;
  findReservation(
    reservationId: string,
  ): Promise<AdmissionReservationRecord | null>;
  findUser(userId: string): Promise<AdmissionUserRecord | null>;
  hasRiderProfile(userId: string): Promise<boolean>;
  insertReservation(
    input: AdmissionReservationInput,
  ): Promise<AdmissionReservationRecord>;
  updateReservation(
    reservationId: string,
    input: { status: "activated"; userId: string },
  ): Promise<boolean>;
  createRiderProfile(userId: string): Promise<boolean>;
  adjustCounts(delta: AdmissionCountDelta): Promise<boolean>;
  reconcileCounts(): Promise<{
    activeAccounts: number;
    reservedAccounts: number;
  }>;
}

export interface AdmissionStore {
  transaction<T>(
    callback: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface AdmissionPolicy {
  reserveNewRider(email: string): Promise<AdmissionReservation>;
  activateRider(reservationId: string, userId: string): Promise<void>;
  releaseExpiredReservations(now: Date): Promise<number>;
}

export type AdmissionReservationLookup = { reservationId: string };

export type AdmissionLifecyclePolicy = AdmissionPolicy & {
  findReservationByEmail(
    email: string,
  ): Promise<AdmissionReservationLookup | null>;
  ensureAdmitted(userId: string, email: string): Promise<AdmissionEnsurement>;
  reconcileReservations(now: Date): Promise<AdmissionReconciliation>;
};

const EMAIL_PATTERN = /^[^@\s]+@[^@\s.]+(?:\.[^@\s.]+)+$/u;

export function normalizeAdmissionEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;

  let normalized: string;
  try {
    normalized = value.normalize("NFKC").trim().toLowerCase();
  } catch {
    return null;
  }

  if (
    normalized.length < 3 ||
    normalized.length > MAX_ADMISSION_EMAIL_LENGTH ||
    /[<>\u0000-\u001f\u007f]/u.test(normalized) ||
    /[\uD800-\uDFFF]/u.test(normalized) ||
    !EMAIL_PATTERN.test(normalized)
  ) {
    return null;
  }

  return normalized;
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 191 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function usableCapacity(
  capacity: AdmissionCapacityRecord | null,
): capacity is AdmissionCapacityRecord {
  return (
    capacity !== null &&
    capacity.maxAccounts === RIDER_ACCOUNT_CAP &&
    Number.isSafeInteger(capacity.activeAccounts) &&
    Number.isSafeInteger(capacity.reservedAccounts) &&
    capacity.activeAccounts >= 0 &&
    capacity.reservedAccounts >= 0 &&
    capacity.activeAccounts + capacity.reservedAccounts <= capacity.maxAccounts
  );
}

function availableCapacity(capacity: AdmissionCapacityRecord) {
  return (
    capacity.activeAccounts + capacity.reservedAccounts < capacity.maxAccounts
  );
}

function allowedReservation(
  reservation: AdmissionReservationRecord,
  expectedEmail?: string,
): AdmissionReservation | null {
  const reservationEmail = normalizeAdmissionEmail(reservation.email);
  if (
    !validIdentifier(reservation.id) ||
    !safeDate(reservation.expiresAt) ||
    !reservationEmail ||
    (expectedEmail !== undefined && reservationEmail !== expectedEmail)
  ) {
    return null;
  }
  return {
    status: "allowed",
    reservationId: reservation.id,
    expiresAt: new Date(reservation.expiresAt),
  };
}

function safeDate(value: Date) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

async function safeTransaction<T>(
  store: AdmissionStore,
  fallback: T,
  callback: (transaction: AdmissionTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await store.transaction(callback);
  } catch {
    return fallback;
  }
}

async function activateCurrentReservation(
  transaction: AdmissionTransaction,
  reservation: AdmissionReservationRecord,
  user: AdmissionUserRecord,
  userId: string,
  now: Date,
): Promise<AdmissionActivation> {
  if (user.role !== "rider") return { status: "unavailable" };
  if (!validIdentifier(reservation.id) || !safeDate(reservation.expiresAt)) {
    return { status: "unavailable" };
  }
  const reservationEmail = normalizeAdmissionEmail(reservation.email);
  if (!reservationEmail) return { status: "unavailable" };
  if (reservation.userId !== null && reservation.userId !== userId) {
    return { status: "unavailable" };
  }
  const storedEmail = normalizeAdmissionEmail(user.email);
  if (!storedEmail || storedEmail !== reservationEmail) {
    return { status: "unavailable" };
  }

  const hasProfile = await transaction.hasRiderProfile(userId);
  if (reservation.status === "activated") {
    if (reservation.userId !== userId) return { status: "unavailable" };
    if (!hasProfile) return { status: "unavailable" };
    return { status: "allowed" };
  }

  if (
    reservation.status !== "reserved" ||
    !safeDate(reservation.expiresAt) ||
    reservation.expiresAt <= now
  ) {
    return { status: "unavailable" };
  }

  if (
    !(await transaction.updateReservation(reservation.id, {
      status: "activated",
      userId,
    }))
  ) {
    throw new Error("reservation could not be activated");
  }

  if (!hasProfile) {
    if (!(await transaction.createRiderProfile(userId))) {
      throw new Error("rider profile could not be created");
    }
  }

  if (
    !(await transaction.adjustCounts({
      activeAccounts: hasProfile ? 0 : 1,
      reservedAccounts: -1,
    }))
  ) {
    throw new Error("capacity could not be adjusted");
  }

  return { status: "allowed" };
}

export function createAdmissionPolicy(
  store: AdmissionStore,
): AdmissionPolicy & {
  ensureAdmitted(userId: string, email: string): Promise<AdmissionEnsurement>;
  reconcileReservations(now: Date): Promise<AdmissionReconciliation>;
} {
  const reserveNewRider = (email: string) => {
    const normalizedEmail = normalizeAdmissionEmail(email);
    if (!normalizedEmail) {
      return Promise.resolve({ status: "invalid" as const });
    }

    return safeTransaction<AdmissionReservation>(
      store,
      { status: "unavailable" },
      async (transaction) => {
        const now = await transaction.currentTime();
        if (!safeDate(now)) return { status: "unavailable" };

        let capacity = await transaction.lockCapacity();
        if (!usableCapacity(capacity)) return { status: "unavailable" };

        await transaction.expireReservations(now);
        capacity = await transaction.lockCapacity();
        if (!usableCapacity(capacity)) return { status: "unavailable" };
        const existing =
          await transaction.findReservationByEmail(normalizedEmail);
        if (existing?.status === "activated") {
          if (!validIdentifier(existing.userId)) {
            return { status: "unavailable" };
          }
          const existingUser = await transaction.findUser(existing.userId);
          if (
            !existingUser ||
            existingUser.role !== "rider" ||
            normalizeAdmissionEmail(existingUser.email) !== normalizedEmail ||
            !(await transaction.hasRiderProfile(existing.userId))
          ) {
            return { status: "unavailable" };
          }
          return (
            allowedReservation(existing, normalizedEmail) ?? {
              status: "unavailable",
            }
          );
        }
        if (
          existing?.status === "reserved" &&
          existing.userId === null &&
          safeDate(existing.expiresAt) &&
          existing.expiresAt > now
        ) {
          return (
            allowedReservation(existing, normalizedEmail) ?? {
              status: "unavailable",
            }
          );
        }

        if (
          capacity.admissionState !== "open" ||
          capacity.emailCircuitState !== "closed"
        ) {
          return { status: "paused" };
        }
        if (!availableCapacity(capacity)) return { status: "full" };

        const reservation = await transaction.insertReservation({
          email: normalizedEmail,
          status: "reserved",
          userId: null,
          expiresAt: new Date(now.getTime() + RESERVATION_TTL_MS),
        });
        if (
          reservation.status !== "reserved" ||
          reservation.userId !== null ||
          !safeDate(reservation.expiresAt) ||
          reservation.expiresAt <= now ||
          reservation.expiresAt.getTime() >
            now.getTime() + RESERVATION_TTL_MS ||
          !normalizeAdmissionEmail(reservation.email) ||
          normalizeAdmissionEmail(reservation.email) !== normalizedEmail
        ) {
          throw new Error("reservation result was invalid");
        }
        if (
          !(await transaction.adjustCounts({
            activeAccounts: 0,
            reservedAccounts: 1,
          }))
        ) {
          throw new Error("capacity could not be adjusted");
        }
        return (
          allowedReservation(reservation, normalizedEmail) ?? {
            status: "unavailable",
          }
        );
      },
    );
  };

  const activateRider = (reservationId: string, userId: string) => {
    if (!validIdentifier(reservationId) || !validIdentifier(userId)) {
      return Promise.resolve();
    }

    return safeTransaction<void>(store, undefined, async (transaction) => {
      const now = await transaction.currentTime();
      if (!safeDate(now)) return;

      let capacity = await transaction.lockCapacity();
      if (!usableCapacity(capacity)) return;

      await transaction.expireReservations(now);
      capacity = await transaction.lockCapacity();
      if (!usableCapacity(capacity)) return;
      const reservation = await transaction.findReservation(reservationId);
      const user = await transaction.findUser(userId);
      if (!reservation || !user) return;

      await activateCurrentReservation(
        transaction,
        reservation,
        user,
        userId,
        now,
      );
    });
  };

  const releaseExpiredReservations = (now: Date) => {
    if (!safeDate(now)) return Promise.resolve(0);

    return safeTransaction(store, 0, async (transaction) => {
      const databaseNow = await transaction.currentTime();
      if (!safeDate(databaseNow)) return 0;
      const capacity = await transaction.lockCapacity();
      if (!usableCapacity(capacity)) return 0;
      return transaction.expireReservations(databaseNow);
    });
  };

  const ensureAdmitted = (userId: string, email: string) => {
    if (!validIdentifier(userId)) {
      return Promise.resolve({ status: "invalid" as const });
    }

    return safeTransaction<AdmissionEnsurement>(
      store,
      { status: "unavailable" },
      async (transaction) => {
        const now = await transaction.currentTime();
        if (!safeDate(now)) return { status: "unavailable" };

        let capacity = await transaction.lockCapacity();
        if (!usableCapacity(capacity)) return { status: "unavailable" };

        await transaction.expireReservations(now);
        capacity = await transaction.lockCapacity();
        if (!usableCapacity(capacity)) return { status: "unavailable" };
        const user = await transaction.findUser(userId);
        if (!user || user.role !== "rider") return { status: "unavailable" };

        const hasProfile = await transaction.hasRiderProfile(userId);
        if (hasProfile) {
          const storedEmail = normalizeAdmissionEmail(user.email);
          if (storedEmail) {
            const profileReservation =
              await transaction.findReservationByEmail(storedEmail);
            if (
              profileReservation &&
              ((profileReservation.status === "activated" &&
                profileReservation.userId === userId) ||
                (profileReservation.status === "reserved" &&
                  profileReservation.expiresAt > now &&
                  (profileReservation.userId === null ||
                    profileReservation.userId === userId)))
            ) {
              const activation = await activateCurrentReservation(
                transaction,
                profileReservation,
                user,
                userId,
                now,
              );
              return activation.status === "allowed"
                ? { status: "allowed", reservationId: profileReservation.id }
                : activation;
            }
            if (
              profileReservation &&
              profileReservation.userId !== null &&
              profileReservation.userId !== userId
            ) {
              return { status: "unavailable" };
            }
          }
          return { status: "allowed" };
        }

        const normalizedEmail = normalizeAdmissionEmail(email);
        if (!normalizedEmail) return { status: "invalid" };
        const storedEmail = normalizeAdmissionEmail(user.email);
        if (!storedEmail || storedEmail !== normalizedEmail) {
          return { status: "unavailable" };
        }

        const existing =
          await transaction.findReservationByEmail(normalizedEmail);
        if (existing) {
          if (existing.status === "activated") {
            if (existing.userId !== userId) return { status: "unavailable" };
            const activation = await activateCurrentReservation(
              transaction,
              existing,
              user,
              userId,
              now,
            );
            return activation.status === "allowed"
              ? { status: "allowed", reservationId: existing.id }
              : activation;
          }
          if (
            existing.status === "reserved" &&
            existing.expiresAt > now &&
            (existing.userId === null || existing.userId === userId)
          ) {
            const activation = await activateCurrentReservation(
              transaction,
              existing,
              user,
              userId,
              now,
            );
            return activation.status === "allowed"
              ? { status: "allowed", reservationId: existing.id }
              : activation;
          }
          if (existing.userId !== null && existing.userId !== userId) {
            return { status: "unavailable" };
          }
        }

        if (
          capacity.admissionState !== "open" ||
          capacity.emailCircuitState !== "closed"
        ) {
          return { status: "paused" };
        }
        if (!availableCapacity(capacity)) return { status: "full" };

        const reservation = await transaction.insertReservation({
          email: normalizedEmail,
          status: "activated",
          userId,
          expiresAt: now,
        });
        if (
          reservation.status !== "activated" ||
          reservation.userId !== userId ||
          !validIdentifier(reservation.id) ||
          !safeDate(reservation.expiresAt) ||
          !normalizeAdmissionEmail(reservation.email) ||
          normalizeAdmissionEmail(reservation.email) !== normalizedEmail
        ) {
          throw new Error("reservation result was invalid");
        }
        if (!(await transaction.createRiderProfile(userId))) {
          throw new Error("rider profile could not be created");
        }
        if (
          !(await transaction.adjustCounts({
            activeAccounts: 1,
            reservedAccounts: 0,
          }))
        ) {
          throw new Error("capacity could not be adjusted");
        }
        return { status: "allowed", reservationId: reservation.id };
      },
    );
  };

  const reconcileReservations = (now: Date) => {
    if (!safeDate(now)) {
      return Promise.resolve({
        expiredReservations: 0,
        activeAccounts: 0,
        reservedAccounts: 0,
      });
    }

    return safeTransaction<AdmissionReconciliation>(
      store,
      {
        expiredReservations: 0,
        activeAccounts: 0,
        reservedAccounts: 0,
      },
      async (transaction) => {
        const capacity = await transaction.lockCapacity();
        if (!usableCapacity(capacity)) {
          throw new Error("capacity is unavailable");
        }
        const databaseNow = await transaction.currentTime();
        if (!safeDate(databaseNow))
          throw new Error("database clock unavailable");
        const expiredReservations =
          await transaction.expireReservations(databaseNow);
        const counts = await transaction.reconcileCounts();
        return { expiredReservations, ...counts };
      },
    );
  };

  return {
    reserveNewRider,
    activateRider,
    releaseExpiredReservations,
    ensureAdmitted,
    reconcileReservations,
  };
}

export function createAdmissionLifecyclePolicy(
  store: AdmissionStore,
): AdmissionLifecyclePolicy {
  const policy = createAdmissionPolicy(store);
  const findReservationByEmail = (email: string) => {
    const normalizedEmail = normalizeAdmissionEmail(email);
    if (!normalizedEmail) return Promise.resolve(null);

    return safeTransaction<AdmissionReservationLookup | null>(
      store,
      null,
      async (transaction) => {
        const now = await transaction.currentTime();
        if (!safeDate(now)) return null;
        const capacity = await transaction.lockCapacity();
        if (!usableCapacity(capacity)) return null;
        await transaction.expireReservations(now);
        const reservation =
          await transaction.findReservationByEmail(normalizedEmail);
        if (
          !reservation ||
          !validIdentifier(reservation.id) ||
          !safeDate(reservation.expiresAt) ||
          normalizeAdmissionEmail(reservation.email) !== normalizedEmail ||
          (reservation.status === "reserved" && reservation.expiresAt <= now) ||
          (reservation.status !== "reserved" &&
            reservation.status !== "activated")
        ) {
          return null;
        }
        return { reservationId: reservation.id };
      },
    );
  };

  return { ...policy, findReservationByEmail };
}
