/**
 * GET /api/public/live-data — REAL operational counters only (A8).
 *
 * Thin handler over `getLiveDataStats`: observation counts by pipeline status
 * (trusted / candidate / quarantined / rejected / superseded — plain database
 * COUNTs), the time of the most recent collection run, open incident count,
 * active collector ids, and the public schema version.
 *
 * Honesty contract: this endpoint contains NO derived or estimated numbers.
 * There is no confidence score anywhere in the pipeline; every figure here is
 * a count read straight from the pulse schema.
 */

import { getLiveDataStats } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const stats = await getLiveDataStats();
  return Response.json(stats, {
    status: 200,
    headers: { "Cache-Control": "public, s-maxage=60" },
  });
}
