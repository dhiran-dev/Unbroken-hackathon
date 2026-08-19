import { notInArray } from "drizzle-orm";

import { db as applicationDatabase } from "@/server/db/client";
import { transitLandmarks } from "@/server/db/schema/transit";
import type {
  LandmarkSeedRow,
  LandmarkSeedStore,
} from "@/server/transit/landmark-seed";

type Database = typeof applicationDatabase;

export class PostgresLandmarkSeedStore implements LandmarkSeedStore {
  constructor(private readonly database: Database = applicationDatabase) {}

  async replaceReviewedLandmarks(rows: LandmarkSeedRow[]) {
    if (rows.length === 0) {
      throw new Error("The reviewed landmark set cannot be empty.");
    }
    await this.database.transaction(async (transaction) => {
      const reviewedIds = rows.map((row) => row.id);
      await transaction
        .update(transitLandmarks)
        .set({ active: false, updatedAt: rows[0]!.reviewedAt })
        .where(notInArray(transitLandmarks.id, reviewedIds));

      for (const row of rows) {
        await transaction
          .insert(transitLandmarks)
          .values({ ...row, updatedAt: row.reviewedAt })
          .onConflictDoUpdate({
            target: transitLandmarks.id,
            set: {
              name: row.name,
              description: row.description,
              latitude: row.latitude,
              longitude: row.longitude,
              aliases: row.aliases,
              stopIds: row.stopIds,
              active: row.active,
              evidenceUrl: row.evidenceUrl,
              reviewedAt: row.reviewedAt,
              updatedAt: row.reviewedAt,
            },
          });
      }
    });
  }
}
