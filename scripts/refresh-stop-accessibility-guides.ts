import { sql } from "@/server/db/client";
import { runConfiguredStopAccessibilityGuideRefresh } from "@/server/transit/run-stop-accessibility-guide-refresh";

try {
  const result = await runConfiguredStopAccessibilityGuideRefresh();
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      snapshotId: result.activeSnapshot?.snapshotId ?? null,
      checkedAt: result.activeSnapshot?.checkedAt.toISOString() ?? null,
      sourceUpdatedAt: null,
      guideCount: result.activeSnapshot?.guides.length ?? 0,
    }) + "\n",
  );
} finally {
  await sql.end();
}
