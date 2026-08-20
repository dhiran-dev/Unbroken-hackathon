import { sql as drizzleSql } from "drizzle-orm";

import { isCommuteSlot, type CommuteSlot } from "@/domain/commute/schedule";

export const MAX_EMAIL_HISTORY = 20 as const;

export type EmailHistoryStatus = "sent" | "failed" | "pending" | "suppressed";

export type EmailHistoryDelivery = {
  serviceDate: string;
  slot: CommuteSlot;
  status: EmailHistoryStatus;
};

export type EmailHistoryStore = {
  listForRider(userId: string): Promise<readonly unknown[]>;
};

export type EmailHistoryReader = {
  listForRider(userId: string): Promise<EmailHistoryDelivery[]>;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const SAFE_USER_ID = /^[^<>\u0000-\u001f\u007f]{1,255}$/u;
const STATUS_VALUES = new Set<EmailHistoryStatus>([
  "sent",
  "failed",
  "pending",
  "suppressed",
]);

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return (
    Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function validUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    SAFE_USER_ID.test(value)
  );
}

function normalizedStatus(value: unknown): EmailHistoryStatus | null {
  if (value === "sending") return "pending";
  return typeof value === "string" &&
    STATUS_VALUES.has(value as EmailHistoryStatus)
    ? (value as EmailHistoryStatus)
    : null;
}

function normalizeRow(value: unknown): EmailHistoryDelivery | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const status = normalizedStatus(row.status);
  if (!validDate(row.serviceDate) || !isCommuteSlot(row.slot) || !status) {
    return null;
  }
  return {
    serviceDate: row.serviceDate,
    slot: row.slot,
    status,
  };
}

/**
 * Validate, project, sort, and bound persisted delivery rows at one deep
 * seam. A duplicate schedule/date row is an invalid persistence result,
 * because retries are represented by one outbox row and its latest status.
 */
export function normalizeEmailHistoryRows(
  value: unknown,
): EmailHistoryDelivery[] | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map(normalizeRow);
  if (rows.some((row) => row === null)) return null;
  const entries = rows as EmailHistoryDelivery[];
  const keys = new Set<string>();
  for (const entry of entries) {
    const key = entry.serviceDate + ":" + entry.slot;
    if (keys.has(key)) return null;
    keys.add(key);
  }
  return [...entries]
    .sort(
      (left, right) =>
        right.serviceDate.localeCompare(left.serviceDate) ||
        (left.slot === right.slot ? 0 : left.slot === "first" ? -1 : 1),
    )
    .slice(0, MAX_EMAIL_HISTORY);
}

export function createEmailHistoryReader(
  store: EmailHistoryStore,
): EmailHistoryReader {
  return {
    async listForRider(userId) {
      if (!validUserId(userId)) throw new Error("EMAIL_HISTORY_OWNER_INVALID");
      const rows = await store.listForRider(userId);
      const normalized = normalizeEmailHistoryRows(rows);
      if (!normalized) throw new Error("EMAIL_HISTORY_STORE_INVALID");
      return normalized;
    },
  };
}

type Database = typeof import("@/server/db/client").db;

/**
 * Production read adapter. The user ID is the only rider identity supplied
 * to SQL, and the join is owner-scoped before rows enter the projection seam.
 */
export class PostgresEmailHistoryStore implements EmailHistoryStore {
  constructor(private readonly database?: Database) {}

  private async getDatabase(): Promise<Database> {
    if (this.database) return this.database;
    const { db } = await import("@/server/db/client");
    return db;
  }

  async listForRider(userId: string): Promise<readonly unknown[]> {
    if (!validUserId(userId)) return [];
    const database = await this.getDatabase();
    const rows = await database.execute(
      drizzleSql`
        select
          outbox.service_date::text as "serviceDate",
          schedule.slot as slot,
          case
            when outbox.status = 'sent' then 'sent'
            when outbox.departure_at <= clock_timestamp()
              and outbox.status <> 'sent' then 'suppressed'
            when outbox.status = 'suppressed' then 'suppressed'
            when outbox.status in ('pending', 'sending') then 'pending'
            when outbox.status = 'failed'
              and outbox.next_attempt_at is not null then 'pending'
            when outbox.status = 'failed' then 'failed'
            else outbox.status
          end as status
        from notification_outbox as outbox
        inner join commute_schedules as schedule
          on schedule.id = outbox.schedule_id
        where schedule.user_id = ${userId}
        order by
          outbox.service_date desc,
          case when schedule.slot = 'first' then 0 else 1 end,
          outbox.updated_at desc,
          outbox.id asc
        limit ${MAX_EMAIL_HISTORY}
      `,
    );
    return rows as unknown as readonly unknown[];
  }
}
