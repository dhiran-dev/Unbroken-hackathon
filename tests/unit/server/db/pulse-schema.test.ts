import { readFileSync } from "node:fs";

import { type Table } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  pulseChangeEvents,
  pulseCollectionRuns,
  pulseCollectors,
  pulseFlavourObservations,
  pulseFlavours,
  pulseHealSessions,
  pulseIncidents,
  pulseLeaderboardEntries,
  pulseLeaderboardSnapshots,
  pulseProductAliases,
  pulseProductMediaPublications,
  pulseProductObservations,
  pulseProducts,
  pulseRawRecords,
  pulseSources,
  pulseVariantObservations,
  pulseVariants,
} from "@/server/db/schema/pulse";

const PULSE_TABLES: Record<string, Table> = {
  sources: pulseSources,
  collectors: pulseCollectors,
  collection_runs: pulseCollectionRuns,
  raw_records: pulseRawRecords,
  products: pulseProducts,
  product_aliases: pulseProductAliases,
  product_media_publications: pulseProductMediaPublications,
  product_observations: pulseProductObservations,
  variants: pulseVariants,
  variant_observations: pulseVariantObservations,
  flavours: pulseFlavours,
  flavour_observations: pulseFlavourObservations,
  change_events: pulseChangeEvents,
  leaderboard_snapshots: pulseLeaderboardSnapshots,
  leaderboard_entries: pulseLeaderboardEntries,
  incidents: pulseIncidents,
  heal_sessions: pulseHealSessions,
};

const SCHEMA_SOURCE = readFileSync(
  "src/server/db/schema/pulse.ts",
  "utf8",
);

function columnNames(table: Table): Set<string> {
  return new Set(
    getTableConfig(table).columns.map((column) => column.name),
  );
}

describe("isolated pulse schema", () => {
  it("exports exactly the 17 pulse tables in the pulse schema", () => {
    expect(Object.keys(PULSE_TABLES).sort()).toEqual(
      [
        "change_events",
        "collection_runs",
        "collectors",
        "flavour_observations",
        "flavours",
        "heal_sessions",
        "incidents",
        "leaderboard_entries",
        "leaderboard_snapshots",
        "product_aliases",
        "product_media_publications",
        "product_observations",
        "products",
        "raw_records",
        "sources",
        "variant_observations",
        "variants",
      ].sort(),
    );

    for (const [sqlName, table] of Object.entries(PULSE_TABLES)) {
      const config = getTableConfig(table);
      expect(config.schema, sqlName).toBe("pulse");
      expect(config.name, sqlName).toBe(sqlName);
    }
  });

  it("keeps every foreign key inside the pulse schema", () => {
    for (const [sqlName, table] of Object.entries(PULSE_TABLES)) {
      const { foreignKeys } = getTableConfig(table);
      for (const foreignKey of foreignKeys) {
        const { foreignTable } = foreignKey.reference();
        expect(getTableConfig(foreignTable).schema, sqlName).toBe("pulse");
      }
    }
  });

  it("constrains product_observations.status to the five lifecycle values as text", () => {
    const config = getTableConfig(pulseProductObservations);
    const status = config.columns.find((column) => column.name === "status");
    expect(status).toBeDefined();
    expect(status?.columnType).toBe("PgText");

    const checkNames = config.checks.map((check) => check.name);
    expect(checkNames).toContain("product_observations_status_ck");

    for (const value of [
      "candidate",
      "trusted",
      "quarantined",
      "rejected",
      "superseded",
    ]) {
      expect(SCHEMA_SOURCE).toContain(`'${value}'`);
    }
  });

  it("documents raw_records immutability by convention with a future trigger", () => {
    expect(SCHEMA_SOURCE).toMatch(/Immutable by convention/);
    expect(SCHEMA_SOURCE).toMatch(/trigger/);

    const rawColumns = [...columnNames(pulseRawRecords)];
    expect(rawColumns).toEqual(
      expect.arrayContaining(["payload", "page_fingerprint", "collector_id"]),
    );
  });

  it("gives leaderboard_snapshots an immutable rebuilt_at timeline", () => {
    const config = getTableConfig(pulseLeaderboardSnapshots);
    const rebuiltAt = config.columns.find(
      (column) => column.name === "rebuilt_at",
    );
    expect(rebuiltAt).toBeDefined();
    expect(rebuiltAt?.notNull).toBe(true);
    expect(columnNames(pulseLeaderboardSnapshots)).not.toContain("updated_at");
    expect(SCHEMA_SOURCE).toMatch(/Snapshots are append-only/);
  });

  it("dedupes product observations per source by time or fingerprint", () => {
    const config = getTableConfig(pulseProductObservations);
    const uniqueNames = config.indexes
      .filter((index) => index.config.unique)
      .map((index) => index.config.name);
    expect(uniqueNames).toEqual(
      expect.arrayContaining([
        "product_observations_source_slug_observed_uidx",
        "product_observations_source_fingerprint_uidx",
      ]),
    );
  });

  it("ships a migration that creates the pulse schema", () => {
    const migration = readFileSync(
      "drizzle/0005_pulserank_pulse_schema.sql",
      "utf8",
    );
    expect(migration).toContain('CREATE SCHEMA "pulse";');
    expect(migration).toMatch(/CREATE TABLE "pulse"\."product_observations"/);
    expect(migration).not.toMatch(/DROP TABLE/);
  });

  it("publishes legacy product images through exact evidence links without rewriting observations", () => {
    const authorizationMarker = readFileSync(
      "drizzle/0006_publish_pulserank_product_images.sql",
      "utf8",
    );
    const publicationMigration = readFileSync(
      "drizzle/0007_pulserank_media_publications.sql",
      "utf8",
    );
    const publicationConfig = getTableConfig(pulseProductMediaPublications);

    expect(publicationConfig.schema).toBe("pulse");
    expect([...columnNames(pulseProductMediaPublications)]).toEqual(
      expect.arrayContaining([
        "product_id",
        "product_observation_id",
        "raw_record_id",
        "image_url",
        "publication_state",
        "policy_version",
      ]),
    );
    expect(authorizationMarker).not.toMatch(/UPDATE\s+pulse\.product_observations/i);
    expect(publicationMigration).toContain(
      "raw.captured_at = observation.observed_at",
    );
    expect(publicationMigration).toContain(
      "^https://www\\.caffeineinformer\\.com/",
    );
    expect(publicationMigration).toMatch(
      /INSERT INTO pulse\.product_media_publications/,
    );
    expect(publicationMigration).not.toMatch(
      /UPDATE\s+pulse\.product_observations/i,
    );
    expect(publicationMigration).not.toMatch(/DROP (TABLE|SCHEMA)/i);
  });
});
