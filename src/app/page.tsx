import type { Metadata } from "next";

import { PublicHeader } from "@/components/public-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pulserankServerFlags } from "@/config/pulserank-flags";

export const metadata: Metadata = {
  title: "PulseRank",
  description:
    "PulseRank: verified product-data pulse checks with a transparent trust pipeline.",
};

/**
 * Root landing shell (disposition REWRITE). The legacy UNBROKEN journey
 * planner page was removed with the L1 cleanup batch; this is the neutral
 * PulseRank landing surface. Every PulseRank feature stays fail-closed behind
 * its flag until the rebuild explicitly enables it.
 */
export default function HomePage() {
  const appEnabled = pulserankServerFlags.appEnabled;

  return (
    <div className="flex min-h-screen flex-col">
      <PublicHeader />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-4 py-12 sm:px-6">
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              PulseRank
            </h1>
            <Badge
              className={
                appEnabled
                  ? undefined
                  : "border-border/40 bg-muted text-muted-foreground"
              }
            >
              {appEnabled ? "App enabled" : "App disabled"}
            </Badge>
          </div>
          <p className="max-w-2xl text-muted-foreground">
            Verified product-data pulse checks with an auditable
            collection-to-leaderboard pipeline. Surfaces switch on through the
            PULSERANK_* environment flags; nothing serves until it is
            explicitly enabled.
          </p>
        </section>

        <section className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Collection</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {pulserankServerFlags.collectionEnabled
                ? "Enabled — Bright Data sample runs may execute."
                : "Disabled (PULSERANK_COLLECTION_ENABLED=false)."}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Discovery</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {pulserankServerFlags.discoveryEnabled
                ? "Enabled — discovery runs may execute."
                : "Disabled (PULSERANK_DISCOVERY_ENABLED=false)."}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Judge mutations</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {pulserankServerFlags.judgeMutationsEnabled
                ? "Enabled — judge cockpit actions may mutate state."
                : "Disabled (PULSERANK_JUDGE_MUTATIONS_ENABLED=false)."}
            </CardContent>
          </Card>
        </section>

        <section className="rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
          Health endpoints remain available at{" "}
          <code className="rounded bg-muted px-1 py-0.5">/api/health/live</code>{" "}
          and{" "}
          <code className="rounded bg-muted px-1 py-0.5">/api/health/ready</code>.
        </section>
      </main>
    </div>
  );
}
