import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  ExternalLink,
  RefreshCw,
  Search,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { PublicHeader } from "@/components/public-header";
import { PublicRefreshButton } from "@/components/public-refresh-button";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  elevatorStateLabel,
  riderStateLabel,
  type RiderStationState,
} from "@/domain/accessibility/model";
import { formatAge, formatPacific } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getPublicAccessibility } from "@/server/services/public-accessibility";

export const metadata: Metadata = { title: "Elevator status" };
export const dynamic = "force-dynamic";

const stateClasses: Record<RiderStationState, string> = {
  accessible: "border-success/25 bg-success/10 text-success-foreground",
  limited: "border-warning/30 bg-warning/10 text-warning-foreground",
  unavailable:
    "border-destructive/25 bg-destructive/10 text-destructive-content",
  unknown: "border-border bg-muted text-muted-foreground",
};

type StatusPageProps = {
  searchParams: Promise<{ q?: string; view?: string }>;
};

export async function LegacyStatusPage({ searchParams }: StatusPageProps) {
  const { q = "", view = "all" } = await searchParams;
  const query = q.trim().toLocaleLowerCase();
  const accessibility = await getPublicAccessibility().catch(() => null);
  const visibleStations = accessibility
    ? [...accessibility.stations]
        .filter((station) => {
          const matchesView =
            view === "issues"
              ? station.state !== "accessible"
              : ["accessible", "limited", "unavailable", "unknown"].includes(
                    view,
                  )
                ? station.state === view
                : true;
          const matchesQuery =
            !query ||
            station.name.toLocaleLowerCase().includes(query) ||
            station.elevators.some((elevator) =>
              elevator.name.toLocaleLowerCase().includes(query),
            );
          return matchesView && matchesQuery;
        })
        .sort((a, b) => {
          const priority = {
            unavailable: 0,
            unknown: 1,
            limited: 2,
            accessible: 3,
          };
          return (
            priority[a.state] - priority[b.state] ||
            a.corridorOrder - b.corridorOrder
          );
        })
    : [];

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="text-sm font-medium text-primary">
              Muni Metro accessibility
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
              Elevator status
            </h1>
            <p className="mt-3 text-base leading-7 text-muted-foreground">
              See which stations have step-free access and which elevators are
              working.
            </p>
          </div>
          {accessibility && (
            <div className="flex flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <Clock3 aria-hidden="true" className="size-4" />
                <span>
                  Last verified{" "}
                  {formatPacific(accessibility.trust.sourceValidAt)} ·{" "}
                  {formatAge(accessibility.trust.ageSeconds)}
                </span>
              </div>
              <PublicRefreshButton />
            </div>
          )}
        </div>

        {!accessibility ? (
          <Card className="mt-8 overflow-hidden">
            <CardHeader className="border-b bg-muted/30">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <CircleHelp
                      aria-hidden="true"
                      className="size-4 text-muted-foreground"
                    />{" "}
                    Status unavailable
                  </CardTitle>
                  <p className="mt-1 text-sm text-muted-foreground">
                    No verified accessibility update is available right now.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground">
                    <RefreshCw aria-hidden="true" className="size-3.5" />{" "}
                    Waiting for an update
                  </span>
                  <PublicRefreshButton />
                </div>
              </div>
            </CardHeader>
            <CardContent className="py-10 sm:py-14">
              <div className="mx-auto max-w-lg text-center">
                <h2 className="font-semibold">
                  We can’t confirm the current elevator state.
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  For immediate travel decisions, check the official SFMTA
                  elevator page.
                </p>
                <a
                  className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
                  href="https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod"
                  rel="noreferrer"
                  target="_blank"
                >
                  Open official SFMTA status{" "}
                  <span className="sr-only">(opens in a new tab)</span>{" "}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            {accessibility.trust.state === "older" && (
              <div
                aria-live="polite"
                className="mt-8 flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/10 p-4 text-sm sm:flex-row sm:items-center sm:justify-between"
                role="status"
              >
                <CircleAlert
                  aria-hidden="true"
                  className="mt-0.5 size-5 shrink-0 text-warning-foreground"
                />
                <div>
                  <p className="font-medium">
                    The latest update could not be confirmed.
                  </p>
                  <p className="mt-1 leading-6 text-warning-foreground">
                    Based on the last verified update, which is{" "}
                    {formatAge(accessibility.trust.ageSeconds)}. It was verified
                    at {formatPacific(accessibility.trust.sourceValidAt)}. Check
                    SFMTA before travelling.
                  </p>
                </div>
                <PublicRefreshButton />
              </div>
            )}

            <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {(
                [
                  ["accessible", "Available"],
                  ["limited", "With changes"],
                  ["unavailable", "Unavailable"],
                  ["unknown", "Not confirmed"],
                ] as const
              ).map(([state, label]) => (
                <Card className="p-4 sm:p-5" key={state}>
                  <p className="text-2xl font-semibold tabular-nums">
                    {accessibility.counts[state]}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{label}</p>
                </Card>
              ))}
            </div>

            <form
              className="mt-8 grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem_auto_auto] md:items-end"
              method="get"
            >
              <label className="text-sm font-medium" htmlFor="q">
                Find a station or elevator
                <span className="relative mt-2 block">
                  <Search
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  />
                  <Input
                    className="pl-9"
                    defaultValue={q}
                    id="q"
                    name="q"
                    placeholder="Try Powell or platform"
                    type="search"
                  />
                </span>
              </label>
              <label className="text-sm font-medium" htmlFor="view">
                Show stations
                <Select
                  className="mt-2"
                  defaultValue={view}
                  id="view"
                  name="view"
                >
                  <option value="all">All stations</option>
                  <option value="issues">Needs attention</option>
                  <option value="accessible">Step-free access available</option>
                  <option value="limited">Step-free access with changes</option>
                  <option value="unavailable">
                    No confirmed step-free access
                  </option>
                  <option value="unknown">Access not confirmed</option>
                </Select>
              </label>
              <button
                className={cn(buttonVariants(), "w-full md:w-auto")}
                type="submit"
              >
                Show
              </button>
              {(query || view !== "all") && (
                <Link
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "w-full md:w-auto",
                  )}
                  href="/status"
                >
                  Clear
                </Link>
              )}
            </form>

            <div className="mt-8 space-y-3">
              {visibleStations.length === 0 && (
                <Card className="p-8 text-center">
                  <h2 className="font-semibold">No matching stations</h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Try another station name or show all station states.
                  </p>
                </Card>
              )}
              {visibleStations.map((station) => (
                <details
                  className="group rounded-2xl border bg-card shadow-[0_1px_2px_oklch(0_0_0/0.04)]"
                  key={station.slug}
                  open={Boolean(query)}
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
                    <div className="min-w-0">
                      <h2 className="font-semibold">{station.name}</h2>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {station.elevators.length} elevator
                        {station.elevators.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <span className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "rounded-full border px-3 py-1.5 text-xs font-medium",
                          stateClasses[station.state],
                        )}
                      >
                        {riderStateLabel(station.state)}
                      </span>
                      <ChevronDown
                        aria-hidden="true"
                        className="size-4 text-muted-foreground transition-transform duration-150 group-open:rotate-180"
                      />
                    </span>
                  </summary>
                  <div className="border-t px-4 py-2 sm:px-5">
                    {[...station.elevators]
                      .sort(
                        (a, b) =>
                          Number(a.state === "working") -
                          Number(b.state === "working"),
                      )
                      .map((elevator) => (
                        <div
                          className="flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-start sm:justify-between"
                          key={elevator.sourceKey}
                        >
                          <div className="min-w-0">
                            <h3 className="text-sm font-medium">
                              {elevator.name}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {elevator.role ?? "Elevator access"} · Last
                              changed {formatPacific(elevator.lastChangedAt)}
                            </p>
                            {elevator.state !== "working" && (
                              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                                {elevator.alternativeName
                                  ? `Use ${elevator.alternativeName} instead for this part of the station.`
                                  : `${elevator.role ?? "This part of the station"} does not have a confirmed working alternative.`}
                              </p>
                            )}
                          </div>
                          <span
                            className={cn(
                              "inline-flex w-fit items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium",
                              elevator.state === "working"
                                ? "border-success/25 bg-success/10 text-success-foreground"
                                : elevator.state === "out_of_service"
                                  ? "border-destructive/25 bg-destructive/10 text-destructive-content"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {elevator.state === "working" ? (
                              <CircleCheck
                                aria-hidden="true"
                                className="size-3.5"
                              />
                            ) : (
                              <CircleAlert
                                aria-hidden="true"
                                className="size-3.5"
                              />
                            )}
                            {elevatorStateLabel(elevator.state)}
                          </span>
                        </div>
                      ))}
                  </div>
                </details>
              ))}
            </div>

            <div className="mt-8 flex flex-col gap-3 rounded-xl border bg-muted/30 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p className="text-muted-foreground">
                For urgent travel decisions, confirm with SFMTA.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link
                  className={cn(
                    buttonVariants({ size: "sm" }),
                    "w-full sm:w-auto",
                  )}
                  href="/#planner"
                >
                  Plan a step-free trip
                </Link>
                <a
                  className={cn(
                    buttonVariants({ size: "sm", variant: "outline" }),
                    "w-full sm:w-auto",
                  )}
                  href="https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod"
                  rel="noreferrer"
                  target="_blank"
                >
                  Open SFMTA status{" "}
                  <span className="sr-only">(opens in a new tab)</span>{" "}
                  <ExternalLink aria-hidden="true" className="size-3.5" />
                </a>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
