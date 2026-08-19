import { CircleHelp, Clock3, Database, ExternalLink } from "lucide-react";
import type { Metadata } from "next";

import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPacific } from "@/lib/format";
import { getTransitCoverage } from "@/server/transit/coverage";

export const metadata: Metadata = { title: "Citywide data" };
export const dynamic = "force-dynamic";

const countLabels = {
  stops: "Stops",
  routes: "Routes",
  trips: "Trips",
  stopTimes: "Scheduled stop times",
  services: "Service calendars",
  shapePoints: "Route shape points",
} as const;

export default async function CoveragePage() {
  const snapshot = await getTransitCoverage().catch(() => null);

  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary">
            Citywide Muni schedule
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Data coverage
          </h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            See how much official Muni schedule data UNBROKEN has checked and
            can use.
          </p>
        </div>

        {!snapshot ? (
          <Card className="mt-8">
            <CardContent className="flex gap-3 py-8 sm:py-10">
              <CircleHelp
                aria-hidden="true"
                className="mt-0.5 size-5 shrink-0 text-muted-foreground"
              />
              <div>
                <h2 className="font-semibold">
                  Citywide schedule data is unavailable
                </h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  UNBROKEN does not have a checked citywide schedule ready to
                  show right now.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <div
              className={
                snapshot.state === "current"
                  ? "mt-8 rounded-xl border border-primary/30 bg-primary/5 p-4"
                  : "mt-8 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4"
              }
              role="status"
            >
              <h2 className="font-semibold">
                {snapshot.state === "current"
                  ? "Current checked schedule"
                  : "Using the last checked schedule"}
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {snapshot.state === "current"
                  ? "UNBROKEN checked schedule service for today in San Francisco."
                  : "Today is not covered by the latest checked schedule yet. The last checked schedule stays visible while we wait for a valid update."}
              </p>
            </div>

            <section aria-labelledby="source-times" className="mt-8">
              <h2 className="sr-only" id="source-times">
                Source times
              </h2>
              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-primary/30 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Clock3
                        aria-hidden="true"
                        className="size-4 text-primary"
                      />
                      Checked by UNBROKEN at
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-semibold">
                      {formatPacific(snapshot.checkedAt)}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      This is when UNBROKEN downloaded and checked the schedule.
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Database
                        aria-hidden="true"
                        className="size-4 text-muted-foreground"
                      />
                      SFMTA updated at
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-semibold">
                      {snapshot.sourceUpdatedAt
                        ? formatPacific(snapshot.sourceUpdatedAt)
                        : "Not provided"}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      This is the update time supplied with the official
                      schedule, when available.
                    </p>
                  </CardContent>
                </Card>
              </div>
            </section>

            <Card className="mt-6 overflow-hidden">
              <CardHeader className="border-b bg-muted/25">
                <CardTitle>Checked schedule rows</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Counts below come from the active database snapshot, not a
                  fixed example.
                </p>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full min-w-96 text-left">
                  <caption className="sr-only">
                    Rows in the active checked Muni schedule
                  </caption>
                  <thead className="border-b text-sm text-muted-foreground">
                    <tr>
                      <th className="px-5 py-3 font-medium sm:px-6" scope="col">
                        Schedule data
                      </th>
                      <th
                        className="px-5 py-3 text-right font-medium sm:px-6"
                        scope="col"
                      >
                        Rows
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(countLabels).map(([key, label]) => (
                      <tr className="border-b last:border-b-0" key={key}>
                        <th
                          className="px-5 py-4 font-medium sm:px-6"
                          scope="row"
                        >
                          {label}
                        </th>
                        <td className="px-5 py-4 text-right text-lg font-semibold tabular-nums sm:px-6">
                          {snapshot.coverage.counts[
                            key as keyof typeof snapshot.coverage.counts
                          ].toLocaleString("en-US")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <div className="mt-6 rounded-xl border bg-muted/25 p-4 text-sm sm:flex sm:items-center sm:justify-between sm:gap-4">
              <p className="leading-6 text-muted-foreground">
                Schedule date: {snapshot.coverage.serviceDate}. Active service
                calendars:{" "}
                {snapshot.coverage.activeServiceCount.toLocaleString("en-US")}.
              </p>
              <a
                className="mt-3 inline-flex min-h-11 shrink-0 items-center gap-2 font-medium text-primary hover:underline sm:mt-0"
                href="https://511.org/open-data/transit"
                rel="noreferrer"
                target="_blank"
              >
                Open official transit data
                <span className="sr-only">(opens in a new tab)</span>
                <ExternalLink aria-hidden="true" className="size-3.5" />
              </a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
