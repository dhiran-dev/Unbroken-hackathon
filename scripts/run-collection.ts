import { sql } from "@/server/db/client";
import { runCollection } from "@/server/services/collection";

try {
  const result = await runCollection("manual_cli");
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "accepted") process.exitCode = 2;
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown collection failure";
  process.stderr.write(`Collection failed safely: ${message}\n`);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
