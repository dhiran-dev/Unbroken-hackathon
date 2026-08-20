import { sql as drizzleSql } from "drizzle-orm";

import type { NotificationRecipientResolver } from "@/domain/notifications/outbox";
import { db as applicationDatabase } from "@/server/db/client";

type Database = typeof applicationDatabase;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/u;

function validEmail(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 3 &&
    value.length <= 254 &&
    value === value.trim() &&
    EMAIL_PATTERN.test(value) &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

/** Resolve a recipient only at send time; this adapter never writes or logs it. */
export class PostgresNotificationRecipientResolver implements NotificationRecipientResolver {
  constructor(private readonly database: Database = applicationDatabase) {}

  async resolveRecipient(outboxId: string): Promise<string | null> {
    if (!UUID_PATTERN.test(outboxId)) return null;
    try {
      const rows = await this.database.execute(
        drizzleSql`
          select u.email as email
          from notification_outbox as o
          inner join commute_schedules as s on s.id = o.schedule_id
          inner join "user" as u on u.id = s.user_id
          where o.id = ${outboxId}
            and o.status = 'sending'
            and o.departure_at > clock_timestamp()
            and u.role = 'rider'
            and u.email_verified = true
            and u.banned = false
          limit 2
        `,
      );
      if (rows.length !== 1) return null;
      const email = (rows[0] as Record<string, unknown> | undefined)?.email;
      return validEmail(email) ? email : null;
    } catch {
      return null;
    }
  }
}
