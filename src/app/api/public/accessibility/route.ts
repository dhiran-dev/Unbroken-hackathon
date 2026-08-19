import { NextResponse } from "next/server";

import { getPublicAccessibility } from "@/server/services/public-accessibility";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const accessibility = await getPublicAccessibility().catch(() => null);
  if (!accessibility) {
    return NextResponse.json(
      {
        available: false,
        message: "Elevator information is unavailable right now.",
      },
      { status: 503, headers: noStoreHeaders },
    );
  }

  return NextResponse.json({
    available: true,
    trust: {
      state: accessibility.trust.state,
      sourceValidAt: accessibility.trust.sourceValidAt,
      ageSeconds: accessibility.trust.ageSeconds,
    },
    counts: accessibility.counts,
    stations: accessibility.stations.map((station) => ({
      slug: station.slug,
      name: station.name,
      state: station.state,
      elevators: station.elevators.map((elevator) => ({
        name: elevator.name,
        state: elevator.state,
        lastChangedAt: elevator.lastChangedAt,
        role: elevator.role ?? "Elevator access",
        alternativeName: elevator.alternativeName ?? null,
      })),
    })),
  }, { headers: noStoreHeaders });
}
