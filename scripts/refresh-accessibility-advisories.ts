import { sql } from "@/server/db/client";
import { runConfiguredAccessibilityAdvisoryRefresh } from "@/server/transit/run-accessibility-advisory-refresh";

try {
  const result = await runConfiguredAccessibilityAdvisoryRefresh();
  process.stdout.write(
    JSON.stringify({
      status: result.status,
      snapshotId: result.activeSnapshot?.snapshotId ?? null,
      checkedAt: result.activeSnapshot?.checkedAt.toISOString() ?? null,
      sourceUpdatedAt:
        result.activeSnapshot?.sourceUpdatedAt?.toISOString() ?? null,
      advisoryCount: result.activeSnapshot?.advisories.length ?? 0,
    }) + "\n",
  );
} finally {
  await sql.end();
}
