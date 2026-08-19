import { NextResponse } from "next/server";

import { getOperatorSessionForCapability } from "@/server/auth/session";
import { exportRuns, parseRunFilters } from "@/server/services/admin-data";
import { adminExportResponse } from "@/server/services/admin-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getOperatorSessionForCapability("operate"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await exportRuns(parseRunFilters(url.searchParams));
  return adminExportResponse(request, "unbroken-history", result);
}
