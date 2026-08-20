import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/server/db/schema";
import { PostgresRealtimeSnapshotStore } from "@/server/transit/realtime-store";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

function ensure(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

const namespace = `realtime_verify_${randomUUID().replaceAll("-", "")}`;
const quotedNamespace = `"${namespace}"`;
const admin = postgres(databaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
});
const workers: Array<ReturnType<typeof postgres>> = [];

try {
  await admin.unsafe(`create schema ${quotedNamespace}`);
  await admin.unsafe(`set search_path to ${quotedNamespace}`);
  const migration = readFileSync("drizzle/0002_citywide_transit.sql", "utf8")
    .replaceAll('"public".', `${quotedNamespace}.`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of migration) await admin.unsafe(statement);

  const baselineId = randomUUID();
  await admin`
    insert into transit_feed_snapshots (
      id, feed_hash, source_url, checked_at, accepted_at, status,
      validation_report, file_manifest, coverage
    ) values (
      ${baselineId}, ${"a".repeat(64)}, ${"https://511.org/open-data/transit"},
      clock_timestamp(), clock_timestamp(), 'active',
      ${admin.json({ accepted: true })}, ${admin.json({})},
      ${admin.json({ counts: {} })}
    )
  `;

  const startedAt = new Date();
  const stores: PostgresRealtimeSnapshotStore[] = [];
  for (let index = 0; index < 12; index += 1) {
    const connection = postgres(databaseUrl, {
      max: 1,
      prepare: false,
      connect_timeout: 10,
    });
    workers.push(connection);
    await connection.unsafe(`set search_path to ${quotedNamespace}`);
    stores.push(
      new PostgresRealtimeSnapshotStore(
        drizzle(connection, { schema }) as never,
      ),
    );
  }

  const claims = await Promise.all(
    Array.from({ length: 53 }, (_, index) =>
      stores[index % stores.length]!.claimPoll({
        feedType: "trip_updates",
        at: new Date("2099-01-01T00:00:00.000Z"),
        cadenceMs: 0,
      }),
    ),
  );
  ensure(
    claims.filter((claim) => claim.status === "claimed").length === 52,
    "The persistent ledger did not admit exactly 52 requests.",
  );
  ensure(
    claims.filter((claim) => claim.status === "deferred").length === 1,
    "The persistent ledger did not defer request 53.",
  );

  const statisticRows = await admin<
    Array<{ count: number; oldest: Date; newest: Date }>
  >`
    select
      count(*)::int as count,
      min(checked_at) as oldest,
      max(checked_at) as newest
    from realtime_feed_snapshots
    where validation_report->>'kind' = 'poll_claim'
  `;
  const statistics = statisticRows[0];
  ensure(statistics, "The persistent claim statistics are unavailable.");
  const { count, oldest, newest } = statistics;
  const finishedAt = new Date();
  ensure(count === 52, "The persistent claim row count is incorrect.");
  ensure(
    oldest >= new Date(startedAt.getTime() - 5_000) &&
      newest <= new Date(finishedAt.getTime() + 5_000),
    "Admission did not use the database clock.",
  );

  await Promise.all(workers.splice(0).map((connection) => connection.end()));
  const restartedConnection = postgres(databaseUrl, {
    max: 1,
    prepare: false,
    connect_timeout: 10,
  });
  workers.push(restartedConnection);
  await restartedConnection.unsafe(`set search_path to ${quotedNamespace}`);
  const restartedStore = new PostgresRealtimeSnapshotStore(
    drizzle(restartedConnection, { schema }) as never,
  );
  const afterRestart = await restartedStore.claimPoll({
    feedType: "vehicles",
    at: new Date("2000-01-01T00:00:00.000Z"),
    cadenceMs: 0,
  });
  ensure(
    afterRestart.status === "deferred",
    "The request ledger did not survive a connection restart.",
  );

  process.stdout.write(
    `${JSON.stringify({ concurrentClaims: count, request53: "deferred", restart: afterRestart.status, clock: "database" })}\n`,
  );
} finally {
  await Promise.all(workers.map((connection) => connection.end())).catch(
    () => undefined,
  );
  await admin.unsafe("set search_path to public").catch(() => undefined);
  await admin
    .unsafe(`drop schema if exists ${quotedNamespace} cascade`)
    .catch(() => undefined);
  await admin.end();
}
