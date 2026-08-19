import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Clock3,
  ExternalLink,
  Route,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { JourneyForm } from "@/components/journey-form";
import { PublicRefreshButton } from "@/components/public-refresh-button";
import { PublicHeader } from "@/components/public-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { planJourney } from "@/domain/accessibility/planner";
import { SFMTA_STATIONS } from "@/domain/collection/catalog";
import { formatPacific } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPublicAccessibility } from "@/server/services/public-accessibility";

export const dynamic = "force-dynamic";

type HomePageProps = {
  searchParams: Promise<{ origin?: string; destination?: string }>;
};

export default async function HomePage({ searchParams }: HomePageProps) {
  const { origin = "", destination = "" } = await searchParams;
  const accessibility = await getPublicAccessibility().catch(() => null);
  const journey =
    origin && destination && accessibility
      ? planJourney(origin, destination, accessibility)
      : null;
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main>
        <section className="relative overflow-hidden border-b">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-10%,oklch(0.65_0.18_264/0.14),transparent_42%)]" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.03fr_0.97fr] lg:items-center lg:py-28">
            <div className="max-w-2xl">
              <Badge><CircleCheck aria-hidden="true" className="size-3.5" /> Elevator-aware Muni trips</Badge>
              <h1 className="text-balance mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                A step-free trip should stay step-free.
              </h1>
              <p className="mt-5 max-w-xl text-balance text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Choose two stations and see the working elevators to use before you travel.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link className={cn(buttonVariants({ size: "lg" }))} href="#planner">
                  Plan a trip <ArrowRight />
                </Link>
                <Link className={cn(buttonVariants({ size: "lg", variant: "outline" }))} href="/status">
                  Check elevator status
                </Link>
              </div>
            </div>

            <Card className="overflow-hidden" id="planner">
              <div className="border-b bg-muted/35 px-5 py-4 sm:px-6">
                <div className="flex items-center gap-2 text-sm font-semibold"><Route aria-hidden="true" className="size-4 text-primary" /> Plan a step-free trip</div>
                <p className="mt-1 text-sm text-muted-foreground">San Francisco Muni Metro</p>
              </div>
              <CardContent className="space-y-5 pt-5 sm:pt-6">
                {accessibility?.trust.state === "older" && (
                  <div
                    aria-live="polite"
                    className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
                    role="status"
                  >
                    <div>
                      <p className="font-medium text-warning-foreground">
                        Route planning is paused until a fresh update arrives.
                      </p>
                      <p className="mt-1 leading-6 text-warning-foreground">
                        The last verified update was {formatPacific(accessibility.trust.sourceValidAt)}. Check SFMTA before travelling.
                      </p>
                    </div>
                    <PublicRefreshButton />
                  </div>
                )}
                {!accessibility && (
                  <div
                    aria-live="polite"
                    className="flex flex-col gap-3 rounded-xl border bg-muted/40 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
                    role="status"
                  >
                    <div>
                      <p className="font-medium">Current elevator information is unavailable.</p>
                      <p className="mt-1 leading-6 text-muted-foreground">
                        Try again when a verified update is available, or check SFMTA before travelling.
                      </p>
                    </div>
                    <PublicRefreshButton />
                  </div>
                )}
                <JourneyForm
                  initialDestination={destination}
                  initialOrigin={origin}
                  stations={SFMTA_STATIONS.map((station) => ({
                    slug: station.slug,
                    name: station.displayName,
                  }))}
                  submitDisabled={!accessibility || accessibility.trust.state === "older"}
                />
                <div className="grid gap-3 border-t pt-5 text-sm sm:grid-cols-2">
                  <div className="flex gap-2.5"><ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><span>Only confirmed elevator information is used.</span></div>
                  <div className="flex gap-2.5"><Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" /><span>{accessibility ? `Last verified ${formatPacific(accessibility.trust.sourceValidAt)}` : "Current information is unavailable"}</span></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        {origin && destination && (
          <section
            className="border-b bg-muted/20"
            id="route"
          >
            <div className="mx-auto max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
              {!accessibility || !journey ? (
                <Card className="p-6 sm:p-8">
                  <div className="flex gap-3">
                    <CircleAlert aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-warning-foreground" />
                    <div>
                      <h2 className="text-lg font-semibold">
                        We can’t check this trip right now
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        Current elevator information is unavailable. Check the
                        official SFMTA page before travelling.
                      </p>
                    </div>
                  </div>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <div className="border-b p-5 sm:p-6">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <div className="flex items-center gap-2">
                          {journey.available ? (
                            <CircleCheck aria-hidden="true" className="size-5 text-success-foreground" />
                          ) : (
                            <CircleAlert aria-hidden="true" className="size-5 text-warning-foreground" />
                          )}
                          <h2 className="text-xl font-semibold tracking-tight">
                            {journey.title}
                          </h2>
                        </div>
                        <p className="mt-2 text-sm text-muted-foreground">
                          {journey.summary}
                        </p>
                      </div>
                      <span className="w-fit rounded-full border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                        Last verified {formatPacific(accessibility.trust.sourceValidAt)}
                      </span>
                    </div>
                  </div>

                  {journey.instructions.length > 0 && (
                    <div className="divide-y">
                      {journey.instructions.map((instruction, index) => (
                        <div
                          className="grid gap-3 p-5 sm:grid-cols-[32px_1fr] sm:p-6"
                          key={`${instruction.title}-${index}`}
                        >
                          <span className="grid size-8 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
                            {index + 1}
                          </span>
                          <div>
                            <h3 className="font-semibold">{instruction.title}</h3>
                            <p className="mt-1 text-sm leading-6 text-muted-foreground">
                              {instruction.detail}
                            </p>
                            {instruction.elevators.length > 0 && (
                              <ul className="mt-3 space-y-2">
                                {instruction.elevators.map((elevator) => (
                                  <li
                                    className="flex items-center gap-2 text-sm"
                                    key={elevator}
                                  >
                                    <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success-foreground" />
                                    {elevator}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {journey.alternative && (
                    <div className="border-t bg-primary/5 p-5 sm:p-6">
                      <p className="text-xs font-medium uppercase tracking-[0.14em] text-primary">
                        Another station option
                      </p>
                      <h3 className="mt-2 font-semibold">
                        {journey.alternative.title}
                      </h3>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {journey.alternative.detail}
                      </p>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {journey.alternative.addedTime}
                      </p>
                      <Link
                        className={cn(buttonVariants({ size: "sm" }), "mt-4")}
                        href={`/?origin=${encodeURIComponent(journey.alternative.originSlug)}&destination=${encodeURIComponent(journey.alternative.destinationSlug)}#route`}
                      >
                        Use this option <ArrowRight />
                      </Link>
                    </div>
                  )}

                  {(journey.notices.length > 0 || !journey.available) && (
                    <div className="border-t bg-muted/30 p-5 sm:p-6">
                      {journey.notices.map((notice) => (
                        <p className="text-sm leading-6 text-muted-foreground" key={notice}>
                          {notice}
                        </p>
                      ))}
                      <a className="mt-3 inline-flex items-center gap-2 text-sm font-medium text-primary hover:underline" href="https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod" rel="noreferrer" target="_blank">
                        Check SFMTA elevator status <span className="sr-only">(opens in a new tab)</span> <ExternalLink aria-hidden="true" className="size-3.5" />
                      </a>
                    </div>
                  )}
                </Card>
              )}
            </div>
          </section>
        )}

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Clear status", "See which entrance, platform, or elevator affects your trip."],
              ["Recent checks", "See exactly when the elevator information was last checked."],
              ["Simple alternatives", "When one elevator is unavailable, see the working option to use instead."],
            ].map(([title, body]) => (
              <Card key={title} className="p-5 sm:p-6">
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p>
              </Card>
            ))}
          </div>
        </section>
      </main>
      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>UNBROKEN</span>
          <span>Accessibility information should inform, never overpromise.</span>
        </div>
      </footer>
    </div>
  );
}
