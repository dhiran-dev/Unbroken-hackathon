import { sql as drizzleSql } from "drizzle-orm";

import { db as applicationDatabase } from "@/server/db/client";
import {
  createAdmissionLifecyclePolicy,
  type AdmissionCapacityRecord,
  type AdmissionLifecyclePolicy,
  type AdmissionCountDelta,
  type AdmissionReservationInput,
  type AdmissionReservationRecord,
  type AdmissionStore,
  type AdmissionTransaction,
  type AdmissionUserRecord,
} from "@/domain/auth/admission";

type Database = typeof applicationDatabase;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type SqlRow = Record<string, unknown>;

function row(value: unknown): SqlRow | null {
  return value && typeof value === "object" ? (value as SqlRow) : null;
}

function finiteInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function safeDate(value: unknown) {
  const date =
    value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function capacityRecord(value: unknown): AdmissionCapacityRecord | null {
  const source = row(value);
  if (!source) return null;
  const maxAccounts = finiteInteger(source.maxAccounts);
  const activeAccounts = finiteInteger(source.activeAccounts);
  const reservedAccounts = finiteInteger(source.reservedAccounts);
  if (
    maxAccounts === null ||
    activeAccounts === null ||
    reservedAccounts === null
  ) {
    return null;
  }
  if (
    typeof source.admissionState !== "string" ||
    typeof source.emailCircuitState !== "string"
  ) {
    return null;
  }
  return {
    maxAccounts,
    activeAccounts,
    reservedAccounts,
    admissionState: source.admissionState,
    emailCircuitState: source.emailCircuitState,
  };
}

function reservationRecord(value: unknown): AdmissionReservationRecord | null {
  const source = row(value);
  if (
    !source ||
    typeof source.id !== "string" ||
    typeof source.email !== "string"
  ) {
    return null;
  }
  if (
    source.status !== "reserved" &&
    source.status !== "activated" &&
    source.status !== "released" &&
    source.status !== "expired"
  ) {
    return null;
  }
  if (source.userId !== null && typeof source.userId !== "string") return null;
  const expiresAt = safeDate(source.expiresAt);
  if (!expiresAt) return null;
  return {
    id: source.id,
    email: source.email,
    status: source.status,
    userId: source.userId as string | null,
    expiresAt,
  };
}

function userRecord(value: unknown): AdmissionUserRecord | null {
  const source = row(value);
  if (
    !source ||
    typeof source.id !== "string" ||
    typeof source.email !== "string" ||
    typeof source.role !== "string"
  ) {
    return null;
  }
  return { id: source.id, email: source.email, role: source.role };
}

class PostgresAdmissionTransaction implements AdmissionTransaction {
  constructor(private readonly transaction: Transaction) {}

  async currentTime() {
    const rows = await this.transaction.execute(
      drizzleSql`select clock_timestamp() as now`,
    );
    const current = safeDate(row(rows[0])?.now);
    if (!current) throw new Error("database clock unavailable");
    return current;
  }

  async lockCapacity() {
    const rows = await this.transaction.execute(
      drizzleSql`
        select
          max_accounts as "maxAccounts",
          active_accounts as "activeAccounts",
          reserved_accounts as "reservedAccounts",
          admission_state as "admissionState",
          email_circuit_state as "emailCircuitState"
        from signup_capacity
        where id = 1
        for update
      `,
    );
    return capacityRecord(rows[0]);
  }

  async expireReservations(_cutoff: Date) {
    void _cutoff;
    const expiredRows = await this.transaction.execute(
      drizzleSql`
        update signup_reservations
        set status = 'expired', updated_at = clock_timestamp()
        where capacity_id = 1
          and status = 'reserved'
          and expires_at <= clock_timestamp()
        returning id
      `,
    );
    const expiredCount = expiredRows.length;
    if (!Number.isSafeInteger(expiredCount) || expiredCount < 0) {
      throw new Error("expired reservation count was invalid");
    }
    if (expiredCount === 0) return 0;

    const lockedCapacityRows = await this.transaction.execute(
      drizzleSql`
        select reserved_accounts as "reservedAccounts"
        from signup_capacity
        where id = 1
        for update
      `,
    );
    const lockedReserved = finiteInteger(
      row(lockedCapacityRows[0])?.reservedAccounts,
    );
    if (lockedReserved === null || expiredCount > lockedReserved) {
      throw new Error("expired reservations exceed reserved count");
    }

    const capacityRows = await this.transaction.execute(
      drizzleSql`
        update signup_capacity
        set reserved_accounts = reserved_accounts - ${expiredCount},
            updated_at = clock_timestamp()
        where id = 1
          and reserved_accounts >= ${expiredCount}
        returning id
      `,
    );
    if (capacityRows.length !== 1) {
      throw new Error("reserved count could not be decremented");
    }
    return expiredCount;
  }

  async findReservationByEmail(email: string) {
    const rows = await this.transaction.execute(
      drizzleSql`
        select
          id::text as id,
          email,
          status,
          user_id as "userId",
          expires_at as "expiresAt"
        from signup_reservations
        where capacity_id = 1
          and email = ${email}
          and status in ('reserved', 'activated')
        order by (status = 'activated') desc, created_at desc
        limit 1
      `,
    );
    return reservationRecord(rows[0]);
  }

  async findReservation(reservationId: string) {
    const rows = await this.transaction.execute(
      drizzleSql`
        select
          id::text as id,
          email,
          status,
          user_id as "userId",
          expires_at as "expiresAt"
        from signup_reservations
        where id = ${reservationId}
          and capacity_id = 1
        for update
      `,
    );
    return reservationRecord(rows[0]);
  }

  async findUser(userId: string) {
    const rows = await this.transaction.execute(
      drizzleSql`
        select id, email, role
        from "user"
        where id = ${userId}
        limit 1
      `,
    );
    return userRecord(rows[0]);
  }

  async hasRiderProfile(userId: string) {
    const rows = await this.transaction.execute(
      drizzleSql`
        select user_id
        from rider_profiles
        where user_id = ${userId}
        limit 1
      `,
    );
    return rows.length === 1;
  }

  async insertReservation(input: AdmissionReservationInput) {
    const rows = await this.transaction.execute(
      drizzleSql`
        insert into signup_reservations
          (capacity_id, email, user_id, status, expires_at, created_at, updated_at)
        values
          (1, ${input.email}, ${input.userId}, ${input.status}, ${input.expiresAt}, clock_timestamp(), clock_timestamp())
        returning
          id::text as id,
          email,
          status,
          user_id as "userId",
          expires_at as "expiresAt"
      `,
    );
    const reservation = reservationRecord(rows[0]);
    if (!reservation) throw new Error("reservation could not be created");
    return reservation;
  }

  async updateReservation(
    reservationId: string,
    input: { status: "activated"; userId: string },
  ) {
    const rows = await this.transaction.execute(
      drizzleSql`
        update signup_reservations
        set status = ${input.status},
            user_id = ${input.userId},
            updated_at = clock_timestamp()
        where id = ${reservationId}
          and capacity_id = 1
          and status = 'reserved'
          and (user_id is null or user_id = ${input.userId})
        returning id
      `,
    );
    return rows.length === 1;
  }

  async createRiderProfile(userId: string) {
    const rows = await this.transaction.execute(
      drizzleSql`
        insert into rider_profiles (user_id, created_at, updated_at)
        values (${userId}, clock_timestamp(), clock_timestamp())
        on conflict (user_id) do nothing
        returning user_id
      `,
    );
    return rows.length === 1;
  }

  async adjustCounts(delta: AdmissionCountDelta) {
    if (
      !Number.isSafeInteger(delta.activeAccounts) ||
      !Number.isSafeInteger(delta.reservedAccounts) ||
      Math.abs(delta.activeAccounts) > 40 ||
      Math.abs(delta.reservedAccounts) > 40
    ) {
      return false;
    }
    const rows = await this.transaction.execute(
      drizzleSql`
        update signup_capacity
        set active_accounts = active_accounts + ${delta.activeAccounts},
            reserved_accounts = reserved_accounts + ${delta.reservedAccounts},
            updated_at = clock_timestamp()
        where id = 1
          and active_accounts + ${delta.activeAccounts} >= 0
          and reserved_accounts + ${delta.reservedAccounts} >= 0
          and active_accounts + reserved_accounts
              + ${delta.activeAccounts + delta.reservedAccounts} <= max_accounts
        returning id
      `,
    );
    return rows.length === 1;
  }

  async reconcileCounts() {
    const rows = await this.transaction.execute(
      drizzleSql`
        with counts as (
          select
            (select count(*)::int from rider_profiles) as active_accounts,
            (select count(*)::int
             from signup_reservations
             where capacity_id = 1 and status = 'reserved') as reserved_accounts
        )
        update signup_capacity as capacity
        set active_accounts = counts.active_accounts,
            reserved_accounts = counts.reserved_accounts,
            updated_at = clock_timestamp()
        from counts
        where capacity.id = 1
          and counts.active_accounts + counts.reserved_accounts <= capacity.max_accounts
        returning
          capacity.active_accounts as "activeAccounts",
          capacity.reserved_accounts as "reservedAccounts"
      `,
    );
    const result = row(rows[0]);
    const activeAccounts = finiteInteger(result?.activeAccounts);
    const reservedAccounts = finiteInteger(result?.reservedAccounts);
    if (activeAccounts === null || reservedAccounts === null) {
      throw new Error("counts could not be reconciled");
    }
    return { activeAccounts, reservedAccounts };
  }
}

export class PostgresAdmissionStore implements AdmissionStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  transaction<T>(callback: (transaction: AdmissionTransaction) => Promise<T>) {
    return this.database.transaction((transaction) =>
      callback(new PostgresAdmissionTransaction(transaction)),
    );
  }
}

export type PostgresAdmissionLifecyclePolicy = AdmissionLifecyclePolicy;

export function createPostgresAdmissionPolicy(
  database: Database = applicationDatabase,
) {
  return createPostgresAdmissionLifecyclePolicy(database);
}

export function createPostgresAdmissionLifecyclePolicy(
  database: Database = applicationDatabase,
): PostgresAdmissionLifecyclePolicy {
  return createAdmissionLifecyclePolicy(new PostgresAdmissionStore(database));
}
