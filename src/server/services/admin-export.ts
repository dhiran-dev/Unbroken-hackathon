import { NextResponse } from "next/server";

import { toCsv } from "./admin-data";

export function adminExportResponse(
  request: Request,
  filename: string,
  result: {
    rows: ReadonlyArray<Record<string, unknown>>;
    total: number;
    truncated: boolean;
  },
) {
  const format = new URL(request.url).searchParams.get("format");
  if (format === "json") {
    return NextResponse.json(
      {
        exportedAt: new Date().toISOString(),
        total: result.total,
        exported: result.rows.length,
        truncated: result.truncated,
        rows: result.rows,
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  return new Response(toCsv(result.rows), {
    headers: {
      "cache-control": "no-store",
      "content-disposition": `attachment; filename="${filename}.csv"`,
      "content-type": "text/csv; charset=utf-8",
    },
  });
}
