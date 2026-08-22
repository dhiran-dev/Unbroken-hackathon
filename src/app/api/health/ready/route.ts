import { connection } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  await connection();

  const startedAt = performance.now();

  try {
    const { sql } = await import("@/server/db/client");
    await sql`select 1 as ready`;
    const latencyMs = Math.round(performance.now() - startedAt);
    const { warmExploreProductImage } = await import(
      "@/server/products/product-image-warmup"
    );
    await Promise.race([
      warmExploreProductImage(),
      new Promise<void>((resolve) => setTimeout(resolve, 3_500)),
    ]);

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
