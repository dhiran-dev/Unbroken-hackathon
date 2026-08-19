import { NextResponse } from "next/server";

import { getOperatorSessionForCapability } from "@/server/auth/session";
import { exportIncidents, parseIncidentFilters } from "@/server/services/admin-data";
import { adminExportResponse } from "@/server/services/admin-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getOperatorSessionForCapability("operate"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await exportIncidents(parseIncidentFilters(url.searchParams));
  return adminExportResponse(request, "unbroken-incidents", result);
}
