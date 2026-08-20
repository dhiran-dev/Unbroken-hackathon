import type { Metadata } from "next";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { RiderMyTrips } from "@/components/rider-my-trips";
import type { CommutePlaceChoice } from "@/domain/commute/account-page";
import type { SavedCommute } from "@/domain/commute/service";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireRider } from "@/server/auth/session";
import { getCommuteService } from "@/server/commutes/runtime";
import { getTransitCatalog } from "@/server/transit/catalog";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My trips" };

export default async function RiderTripsPage() {
  const session = await requireRider();
  let initialCommutes: SavedCommute[] = [];
  let initialPlaces: CommutePlaceChoice[] = [];
  /*
   * `getPlace` and the browser search intentionally share the same catalog
   * fields. The cast only bridges their module-local aliases after the catalog
   * has already validated the exact stored reference.
   */
  let resolvedPlaces = [] as Awaited<
    ReturnType<Awaited<ReturnType<typeof getTransitCatalog>>["getPlace"]>
  >[];

  try {
    initialCommutes = await (
      await getCommuteService()
    ).listForRider(session.user.id);
    const placeIds = [
      ...new Set(
        initialCommutes.flatMap((commute) => [
          commute.originPlaceId,
          commute.destinationPlaceId,
        ]),
      ),
    ];
    const catalog = await getTransitCatalog();
    resolvedPlaces = await Promise.all(
      placeIds.map((placeId) => catalog.getPlace({ placeId })),
    );
    initialPlaces = resolvedPlaces
      .filter((place): place is NonNullable<typeof place> => place !== null)
      .map((place) => ({
        id: place.id,
        type: place.type,
        name: place.name,
        description: place.description,
        latitude: place.latitude,
        longitude: place.longitude,
        stopIds: [...place.stopIds],
        routeNames: [...place.routeNames],
      }));
  } catch {
    initialCommutes = [];
    initialPlaces = [];
  }

  return (
    <div className="min-h-screen bg-muted/25">
      <header className="surface-glass sticky top-0 z-30 border-b">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Brand />
          <div className="flex items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="px-4 py-8 sm:px-6 sm:py-12">
        <div className="mx-auto mb-6 max-w-5xl">
          <Link
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            href="/"
          >
            Back to trip planner
          </Link>
        </div>
        <RiderMyTrips
          initialCommutes={initialCommutes}
          initialPlaces={initialPlaces}
        />
      </main>
    </div>
  );
}
