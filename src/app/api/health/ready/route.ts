import { sql } from "@/server/db/client";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();

  try {
    await sql`select 1 as ready`;
    const latencyMs = Math.round(performance.now() - startedAt);

    return Response.json(
      {
        status: "ready",
        checkedAt: new Date().toISOString(),
        checks: {
          database: {
            status: "operational",
            latencyMs,
          },
        },
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        status: "not_ready",
        checkedAt: new Date().toISOString(),
        checks: {
          database: {
            status: "outage",
          },
        },
      },
      {
        status: 503,
        headers: { "cache-control": "no-store" },
      },
    );
  }
}
