import type { Metadata } from "next";
import Link from "next/link";

import { PublicCitywideStatusSurface } from "@/components/public-citywide-status";
import { LegacyStatusPage } from "@/app/status/legacy-status-page";
import { PublicHeader } from "@/components/public-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  ACCESSIBILITY_ADVISORY_SOURCE_URL,
  ELEVATOR_SOURCE_URL,
  REALTIME_SOURCE_URL,
  STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  STOP_RELOCATION_SOURCE_URL,
  filterPublicCitywideStatus,
  getPublicCitywideStatus,
} from "@/server/citywide-status/status-runtime";
import type {
  PublicCitywideStatusFilter,
  PublicCitywideStatusView,
} from "@/server/citywide-status/public-citywide-status";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  return process.env.CITYWIDE_PLANNER_ENABLED === "true"
    ? { title: "Citywide status" }
    : { title: "Elevator status" };
}
export const dynamic = "force-dynamic";

type StatusPageProps = {
  searchParams: Promise<{
    q?: string | string[];
    type?: string | string[];
    state?: string | string[];
    view?: string | string[];
  }>;
};

const types = new Set<PublicCitywideStatusFilter["type"]>([
  "all",
  "elevators",
  "advisories",
  "relocations",
  "guides",
  "alerts",
]);
const states = new Set<PublicCitywideStatusFilter["state"]>([
  "all",
  "current",
  "older",
  "unavailable",
]);

function one(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value)?.trim().slice(0, 80) ?? "";
}

async function legacySearchParams(
  searchParams: StatusPageProps["searchParams"],
) {
  const values = await searchParams;
  return { q: one(values.q), view: one(values.view) || "all" };
}

function filterFromSearchParams(
  values: Awaited<StatusPageProps["searchParams"]>,
): PublicCitywideStatusFilter {
  const query = one(values.q);
  const typeValue = one(values.type);
  const stateValue = one(values.state);
  return {
    query,
    type: types.has(typeValue as PublicCitywideStatusFilter["type"])
      ? (typeValue as PublicCitywideStatusFilter["type"])
      : "all",
    state: states.has(stateValue as PublicCitywideStatusFilter["state"])
      ? (stateValue as PublicCitywideStatusFilter["state"])
      : "all",
  };
}

function unavailableStatus(): PublicCitywideStatusView {
  const unavailable = (sourceUrl: string) => ({
    state: "unavailable" as const,
    checkedAt: null,
    sourceUpdatedAt: null,
    sourceUrl,
    summary: "Current information is unavailable.",
    count: 0,
    items: [],
  });
  return {
    elevators: {
      ...unavailable(ELEVATOR_SOURCE_URL),
      stations: [],
      counts: { accessible: 0, limited: 0, unavailable: 0, unknown: 0 },
    },
    advisories: unavailable(ACCESSIBILITY_ADVISORY_SOURCE_URL),
    relocations: unavailable(STOP_RELOCATION_SOURCE_URL),
    guides: unavailable(STOP_ACCESSIBILITY_GUIDE_SOURCE_URL),
    alerts: unavailable(REALTIME_SOURCE_URL),
  };
}

export default async function StatusPage({ searchParams }: StatusPageProps) {
  if (process.env.CITYWIDE_PLANNER_ENABLED !== "true") {
    return <LegacyStatusPage searchParams={legacySearchParams(searchParams)} />;
  }

  const filter = filterFromSearchParams(await searchParams);
  let status: PublicCitywideStatusView;
  try {
    status = await (await getPublicCitywideStatus()).read(new Date());
  } catch {
    status = unavailableStatus();
  }
  const filteredStatus = filterPublicCitywideStatus(status, filter);
  const isFiltered = Boolean(
    filter.query || filter.type !== "all" || filter.state !== "all",
  );

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-3xl">
          <p className="text-sm font-medium text-primary">San Francisco Muni</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Citywide service status
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Check elevators, accessibility changes, moved stops, guidance, and
            current service alerts in one place.
          </p>
        </div>

        <Card className="mt-8 p-4 sm:p-5">
          <form
            className="grid gap-3 md:grid-cols-[minmax(0,1fr)_15rem_15rem_auto_auto] md:items-end"
            method="get"
          >
            <label className="text-sm font-medium" htmlFor="status-query">
              Search status updates
              <Input
                className="mt-2"
                defaultValue={filter.query}
                id="status-query"
                name="q"
                placeholder="Try Powell or moved stop"
                type="search"
              />
            </label>
            <label className="text-sm font-medium" htmlFor="status-type">
              Filter by source
              <Select
                className="mt-2"
                defaultValue={filter.type}
                id="status-type"
                name="type"
              >
                <option value="all">All updates</option>
                <option value="elevators">Elevators and stations</option>
                <option value="advisories">Accessibility advisories</option>
                <option value="relocations">Moved stops</option>
                <option value="guides">Accessible-stop guidance</option>
                <option value="alerts">Current service alerts</option>
              </Select>
            </label>
            <label className="text-sm font-medium" htmlFor="status-state">
              Filter by information age
              <Select
                className="mt-2"
                defaultValue={filter.state}
                id="status-state"
                name="state"
              >
                <option value="all">All information</option>
                <option value="current">Current only</option>
                <option value="older">Older information</option>
                <option value="unavailable">Unavailable only</option>
              </Select>
            </label>
            <button
              className={cn(buttonVariants(), "w-full md:w-auto")}
              type="submit"
            >
              Apply filters
            </button>
            {isFiltered ? (
              <Link
                className={cn(
                  buttonVariants({ variant: "ghost" }),
                  "w-full md:w-auto",
                )}
                href="/status"
              >
                Clear
              </Link>
            ) : (
              <span aria-hidden="true" />
            )}
          </form>
        </Card>

        <div aria-live="polite" className="mt-5 text-sm text-muted-foreground">
          {isFiltered
            ? "Showing matching status updates."
            : "Showing all available status updates."}
        </div>

        <div className="mt-4">
          <PublicCitywideStatusSurface
            filter={filter}
            status={filteredStatus}
          />
        </div>
      </main>
    </div>
  );
}
