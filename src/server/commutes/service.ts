import { and, asc, eq, sql } from "drizzle-orm";

import {
  normalizeStoredCommute,
  type CommuteScheduleStore,
  type StoredCommute,
} from "@/domain/commute/service";
import type { CommuteDraft, CommuteSlot } from "@/domain/commute/schedule";
import { commuteSchedules } from "@/server/db/schema/commute";

type Database = typeof import("@/server/db/client").db;

type CommuteRow = {
  id: string;
  userId: string;
  slot: string;
  originPlaceId: string;
  destinationPlaceId: string;
  days: unknown;
  departureTime: string;
  timezone: string;
  leadMinutes: number;
  paused: boolean;
  createdAt: Date;
  updatedAt: Date;
};

function asStoredCommute(row: CommuteRow): StoredCommute {
  const normalized = normalizeStoredCommute(row);
  if (!normalized) throw new Error("COMMUTE_STORE_INVALID");
  return normalized;
}

export class PostgresCommuteScheduleStore implements CommuteScheduleStore {
  constructor(private readonly database?: Database) {}

  private async getDatabase(): Promise<Database> {
    if (this.database) return this.database;
    const { db } = await import("@/server/db/client");
    return db;
  }

  async listForRider(userId: string): Promise<StoredCommute[]> {
    const database = await this.getDatabase();
    const rows = await database
      .select({
        id: commuteSchedules.id,
        userId: commuteSchedules.userId,
        slot: commuteSchedules.slot,
        originPlaceId: commuteSchedules.originPlaceId,
        destinationPlaceId: commuteSchedules.destinationPlaceId,
        days: commuteSchedules.days,
        departureTime: commuteSchedules.departureTime,
        timezone: commuteSchedules.timezone,
        leadMinutes: commuteSchedules.leadMinutes,
        paused: commuteSchedules.paused,
        createdAt: commuteSchedules.createdAt,
        updatedAt: commuteSchedules.updatedAt,
      })
      .from(commuteSchedules)
      .where(eq(commuteSchedules.userId, userId))
      .orderBy(
        sql`case when ${commuteSchedules.slot} = 'first' then 0 else 1 end`,
        asc(commuteSchedules.createdAt),
      );
    return rows.map((row) => {
      const normalized = asStoredCommute(row);
      if (normalized.userId !== userId)
        throw new Error("COMMUTE_STORE_INVALID");
      return normalized;
    });
  }

  async replaceForRider(
    userId: string,
    slot: CommuteSlot,
    draft: CommuteDraft,
  ): Promise<StoredCommute> {
    const database = await this.getDatabase();
    const rows = await database
      .insert(commuteSchedules)
      .values({
        userId,
        slot,
        originPlaceId: draft.originPlaceId,
        destinationPlaceId: draft.destinationPlaceId,
        days: draft.days,
        departureTime: draft.departureTime,
        timezone: draft.timezone,
        leadMinutes: draft.reminderMinutes,
        paused: draft.paused,
      })
      .onConflictDoUpdate({
        target: [commuteSchedules.userId, commuteSchedules.slot],
        set: {
          originPlaceId: draft.originPlaceId,
          destinationPlaceId: draft.destinationPlaceId,
          days: draft.days,
          departureTime: draft.departureTime,
          timezone: draft.timezone,
          leadMinutes: draft.reminderMinutes,
          paused: draft.paused,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        },
      })
      .returning({
        id: commuteSchedules.id,
        userId: commuteSchedules.userId,
        slot: commuteSchedules.slot,
        originPlaceId: commuteSchedules.originPlaceId,
        destinationPlaceId: commuteSchedules.destinationPlaceId,
        days: commuteSchedules.days,
        departureTime: commuteSchedules.departureTime,
        timezone: commuteSchedules.timezone,
        leadMinutes: commuteSchedules.leadMinutes,
        paused: commuteSchedules.paused,
        createdAt: commuteSchedules.createdAt,
        updatedAt: commuteSchedules.updatedAt,
      });
    const row = rows[0];
    if (!row) throw new Error("COMMUTE_WRITE_FAILED");
    return asStoredCommute(row);
  }

  async deleteForRider(userId: string, slot: CommuteSlot): Promise<void> {
    const database = await this.getDatabase();
    await database
      .delete(commuteSchedules)
      .where(
        and(
          eq(commuteSchedules.userId, userId),
          eq(commuteSchedules.slot, slot),
        ),
      );
  }
}
