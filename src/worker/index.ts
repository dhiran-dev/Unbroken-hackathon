import { hostname } from "node:os";

import { sql } from "@/server/db/client";

const heartbeatIntervalMs = 30_000;
const workerId = `${hostname()}:${process.pid}`;
const startedAt = new Date();
let stopping = false;

async function heartbeat() {
  await sql`
    insert into worker_heartbeats (
      worker_id,
      process_version,
      started_at,
      last_seen_at,
      metadata
    ) values (
      ${workerId},
      ${process.env.SOURCE_COMMIT ?? "local"},
      ${startedAt.toISOString()}::timestamptz,
      ${new Date().toISOString()}::timestamptz,
      ${JSON.stringify({ runtime: "bun", role: "worker" })}::jsonb
    )
    on conflict (worker_id) do update set
      process_version = excluded.process_version,
      started_at = excluded.started_at,
      last_seen_at = excluded.last_seen_at,
      metadata = excluded.metadata
  `;
}

async function stop(signal: string) {
  if (stopping) return;
  stopping = true;
  process.stdout.write(`Worker received ${signal}; closing database connection.\n`);
  await sql.end({ timeout: 5 });
  process.exit(0);
}

process.on("SIGINT", () => void stop("SIGINT"));
process.on("SIGTERM", () => void stop("SIGTERM"));

await heartbeat();
process.stdout.write(`Worker heartbeat active as ${workerId}.\n`);

setInterval(() => {
  void heartbeat().catch(() => {
    process.stderr.write("Worker heartbeat failed.\n");
  });
}, heartbeatIntervalMs);
