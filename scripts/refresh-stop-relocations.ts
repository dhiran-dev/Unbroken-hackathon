import { sql } from "@/server/db/client";
import { runConfiguredStopRelocationRefresh } from "@/server/transit/run-stop-relocation-refresh";

try {
  const result = await runConfiguredStopRelocationRefresh();
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      snapshotId: result.activeSnapshot?.snapshotId ?? null,
      checkedAt: result.activeSnapshot?.checkedAt.toISOString() ?? null,
      sourceUpdatedAt:
        result.activeSnapshot?.sourceUpdatedAt.toISOString() ?? null,
      relocationCount: result.activeSnapshot?.relocations.length ?? 0,
    }) + "\n",
  );
} finally {
  await sql.end();
}
