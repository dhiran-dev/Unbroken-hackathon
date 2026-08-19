import { NextResponse } from "next/server";

import { getOperatorSessionForCapability } from "@/server/auth/session";
import { exportEquipment, parseEquipmentFilters } from "@/server/services/admin-data";
import { adminExportResponse } from "@/server/services/admin-export";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!(await getOperatorSessionForCapability("operate"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = new URL(request.url);
  const result = await exportEquipment(parseEquipmentFilters(url.searchParams));
  return adminExportResponse(request, "unbroken-equipment", result);
}
