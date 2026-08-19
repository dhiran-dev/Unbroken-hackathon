import { NextResponse } from "next/server";
import { z } from "zod";

import { planJourney } from "@/domain/accessibility/planner";
import { SFMTA_STATIONS } from "@/domain/collection/catalog";
import { getPublicAccessibility } from "@/server/services/public-accessibility";

const stationSlugs = new Set<string>(SFMTA_STATIONS.map((station) => station.slug));
const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const requestSchema = z
  .object({
    origin: z.string().refine((value) => stationSlugs.has(value), {
      message: "Choose a supported starting station.",
    }),
    destination: z.string().refine((value) => stationSlugs.has(value), {
      message: "Choose a supported destination station.",
    }),
  })
  .refine((value) => value.origin !== value.destination, {
    message: "Choose two different stations.",
    path: ["destination"],
  });

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const issuePath = issue?.path[0];
    const message =
      issue?.message === "Choose two different stations."
        ? issue.message
        : issuePath === "origin"
          ? "Choose a supported starting station."
          : issuePath === "destination"
            ? "Choose a supported destination station."
            : "Choose a starting station and destination.";
    return NextResponse.json(
      { message },
      { status: 400, headers: noStoreHeaders },
    );
  }

  const accessibility = await getPublicAccessibility().catch(() => null);
  if (!accessibility) {
    return NextResponse.json(
      { message: "Elevator information is unavailable right now." },
      { status: 503, headers: noStoreHeaders },
    );
  }

  return NextResponse.json({
    plan: planJourney(
      parsed.data.origin,
      parsed.data.destination,
      accessibility,
    ),
    checkedAt: accessibility.trust.sourceValidAt,
    usingLastVerifiedUpdate: accessibility.trust.state === "older",
  }, { headers: noStoreHeaders });
}
