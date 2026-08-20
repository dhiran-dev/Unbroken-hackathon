import { randomUUID } from "node:crypto";

import {
  createAdmissionLifecyclePolicy,
  RESERVATION_TTL_MS,
  RIDER_ACCOUNT_CAP,
  type AdmissionCapacityRecord,
  type AdmissionPolicy,
  type AdmissionReservationInput,
  type AdmissionReservationRecord,
  type AdmissionStore,
  type AdmissionTransaction,
  type AdmissionUserRecord,
} from "@/domain/auth/admission";

type InMemoryState = {
  now: Date;
  capacity: AdmissionCapacityRecord;
  users: Map<string, AdmissionUserRecord>;
  profiles: Set<string>;
  reservations: Map<string, AdmissionReservationRecord>;
};

function cloneState(state: InMemoryState): InMemoryState {
  return {
    now: new Date(state.now),
    capacity: { ...state.capacity },
    users: new Map([...state.users].map(([id, user]) => [id, { ...user }])),
    profiles: new Set(state.profiles),
    reservations: new Map(
      [...state.reservations].map(([id, reservation]) => [
        id,
        {
          ...reservation,
          expiresAt: new Date(reservation.expiresAt),
        },
      ]),
    ),
  };
}

function cloneReservation(
  reservation: AdmissionReservationRecord,
): AdmissionReservationRecord {
  return { ...reservation, expiresAt: new Date(reservation.expiresAt) };
}

function validDelta(value: number) {
  return Number.isSafeInteger(value) && Math.abs(value) <= RIDER_ACCOUNT_CAP;
}

class InMemoryAdmissionStore implements AdmissionStore {
  private state: InMemoryState;
  private queue = Promise.resolve();
  private failNext = false;

  constructor(state: InMemoryState) {
    this.state = state;
  }

  failNextOperation() {
    this.failNext = true;
  }

  async transaction<T>(
    callback: (transaction: AdmissionTransaction) => Promise<T>,
  ): Promise<T> {
    let release!: () => void;
    const previous = this.queue;
    this.queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    try {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("in-memory store unavailable");
      }

      const draft = cloneState(this.state);
      const transaction: AdmissionTransaction = {
        currentTime: async () => new Date(draft.now),
        lockCapacity: async () => ({ ...draft.capacity }),
        expireReservations: async (cutoff) => {
          let expired = 0;
          for (const reservation of draft.reservations.values()) {
            if (
              reservation.status === "reserved" &&
              reservation.expiresAt <= cutoff
            ) {
              reservation.status = "expired";
              expired += 1;
            }
          }
          if (draft.capacity.reservedAccounts < expired) {
            throw new Error("reserved count underflow");
          }
          draft.capacity.reservedAccounts -= expired;
          return expired;
        },
        findReservationByEmail: async (email) => {
          const matches = [...draft.reservations.values()].filter(
            (reservation) =>
              reservation.email === email &&
              (reservation.status === "reserved" ||
                reservation.status === "activated"),
          );
          const activated = matches.find(
            (reservation) => reservation.status === "activated",
          );
          const reservation = activated ?? matches[0];
          return reservation ? cloneReservation(reservation) : null;
        },
        findReservation: async (reservationId) => {
          const reservation = draft.reservations.get(reservationId);
          return reservation ? cloneReservation(reservation) : null;
        },
        findUser: async (userId) => {
          const user = draft.users.get(userId);
          return user ? { ...user } : null;
        },
        hasRiderProfile: async (userId) => draft.profiles.has(userId),
        insertReservation: async (input: AdmissionReservationInput) => {
          const id = randomUUID();
          const reservation: AdmissionReservationRecord = {
            id,
            email: input.email,
            status: input.status,
            userId: input.userId,
            expiresAt: new Date(input.expiresAt),
          };
          draft.reservations.set(id, reservation);
          return cloneReservation(reservation);
        },
        updateReservation: async (reservationId, input) => {
          const reservation = draft.reservations.get(reservationId);
          if (
            !reservation ||
            reservation.status !== "reserved" ||
            (reservation.userId !== null && reservation.userId !== input.userId)
          ) {
            return false;
          }
          reservation.status = input.status;
          reservation.userId = input.userId;
          return true;
        },
        createRiderProfile: async (userId) => {
          if (draft.profiles.has(userId)) return false;
          draft.profiles.add(userId);
          return true;
        },
        adjustCounts: async ({ activeAccounts, reservedAccounts }) => {
          if (!validDelta(activeAccounts) || !validDelta(reservedAccounts)) {
            return false;
          }
          const nextActive = draft.capacity.activeAccounts + activeAccounts;
          const nextReserved =
            draft.capacity.reservedAccounts + reservedAccounts;
          if (
            nextActive < 0 ||
            nextReserved < 0 ||
            nextActive + nextReserved > draft.capacity.maxAccounts
          ) {
            return false;
          }
          draft.capacity.activeAccounts = nextActive;
          draft.capacity.reservedAccounts = nextReserved;
          return true;
        },
        reconcileCounts: async () => {
          const activeAccounts = draft.profiles.size;
          const reservedAccounts = [...draft.reservations.values()].filter(
            (reservation) => reservation.status === "reserved",
          ).length;
          if (activeAccounts + reservedAccounts > draft.capacity.maxAccounts) {
            throw new Error("reconciled counts exceed cap");
          }
          draft.capacity.activeAccounts = activeAccounts;
          draft.capacity.reservedAccounts = reservedAccounts;
          return { activeAccounts, reservedAccounts };
        },
      };

      const result = await callback(transaction);
      this.state = draft;
      return result;
    } finally {
      release();
    }
  }

  snapshot() {
    return cloneState(this.state);
  }

  setNow(now: Date) {
    this.state.now = new Date(now);
  }

  setAdmissionState(value: string) {
    this.state.capacity.admissionState = value;
  }

  setEmailCircuitState(value: string) {
    this.state.capacity.emailCircuitState = value;
  }

  seedUser(id: string, email: string, role = "rider") {
    this.state.users.set(id, { id, email, role });
  }

  seedRider(id: string, email: string) {
    this.seedUser(id, email, "rider");
    if (this.state.profiles.has(id)) return;
    if (this.state.capacity.activeAccounts >= RIDER_ACCOUNT_CAP) {
      throw new Error("in-memory fixture exceeds rider cap");
    }
    this.state.profiles.add(id);
    this.state.capacity.activeAccounts += 1;
  }

  seedActivatedReservation(
    reservationId: string,
    userId: string,
    email: string,
    withProfile = false,
  ) {
    this.seedUser(userId, email, "rider");
    if (withProfile) {
      this.seedRider(userId, email);
    } else {
      this.state.capacity.activeAccounts += 1;
    }
    this.state.reservations.set(reservationId, {
      id: reservationId,
      email,
      status: "activated",
      userId,
      expiresAt: new Date(this.state.now),
    });
  }

  seedActiveUsers(count: number) {
    for (let index = 0; index < count; index += 1) {
      const id = `seed-active-${index}`;
      if (this.state.profiles.has(id)) continue;
      this.seedRider(id, `${id}@example.com`);
    }
  }

  advancePastReservationTtl() {
    const latestExpiry = [...this.state.reservations.values()]
      .map((reservation) => reservation.expiresAt.getTime())
      .reduce(
        (latest, expiry) => Math.max(latest, expiry),
        this.state.now.getTime() + RESERVATION_TTL_MS,
      );
    this.state.now = new Date(latestExpiry + 1);
  }
}

export function createInMemoryAdmissionHarness() {
  const store = new InMemoryAdmissionStore({
    now: new Date("2026-01-01T00:00:00.000Z"),
    capacity: {
      maxAccounts: RIDER_ACCOUNT_CAP,
      activeAccounts: 0,
      reservedAccounts: 0,
      admissionState: "open",
      emailCircuitState: "closed",
    },
    users: new Map(),
    profiles: new Set(),
    reservations: new Map(),
  });
  const policy = createAdmissionLifecyclePolicy(store);

  return {
    policy,
    seedActiveUsers: (count: number) => store.seedActiveUsers(count),
    seedUser: (id: string, email: string, role?: string) =>
      store.seedUser(id, email, role),
    seedRider: (id: string, email: string) => store.seedRider(id, email),
    seedActivatedReservation: (
      reservationId: string,
      userId: string,
      email: string,
      withProfile?: boolean,
    ) =>
      store.seedActivatedReservation(reservationId, userId, email, withProfile),
    setAdmissionState: (value: string) => store.setAdmissionState(value),
    setEmailCircuitState: (value: string) => store.setEmailCircuitState(value),
    advancePastReservationTtl: () => store.advancePastReservationTtl(),
    now: () => new Date(store.snapshot().now),
    failNextOperation: () => store.failNextOperation(),
    snapshot: () => store.snapshot(),
    setNow: (now: Date) => store.setNow(now),
  };
}

export type InMemoryAdmissionHarness = ReturnType<
  typeof createInMemoryAdmissionHarness
>;

export type InMemoryAdmissionPolicy = AdmissionPolicy &
  ReturnType<typeof createAdmissionLifecyclePolicy>;
