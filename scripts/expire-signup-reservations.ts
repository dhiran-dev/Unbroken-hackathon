import { sql } from "@/server/db/client";
import { createPostgresAdmissionPolicy } from "@/server/auth/admission";

const policy = createPostgresAdmissionPolicy();

try {
  await policy.reconcileReservations(new Date());
  process.stdout.write("Signup admission cleanup completed.\n");
} catch {
  process.stderr.write("Signup admission cleanup was unavailable.\n");
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
