import { CircleHelp, ExternalLink, RefreshCw } from "lucide-react";
import type { Metadata } from "next";

import { PublicHeader } from "@/components/public-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Elevator status" };

export default function StatusPage() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary">Muni Metro accessibility</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">Elevator status</h1>
          <p className="mt-3 text-base leading-7 text-muted-foreground">
            Current station access, elevator details, and the time each update was verified.
          </p>
        </div>

        <Card className="mt-8 overflow-hidden">
          <CardHeader className="border-b bg-muted/30">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2"><CircleHelp className="size-4 text-muted-foreground" /> Status unavailable</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">No verified accessibility update is available right now.</p>
              </div>
              <span className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground"><RefreshCw className="size-3.5" /> Waiting for verification</span>
            </div>
          </CardHeader>
          <CardContent className="py-10 sm:py-14">
            <div className="mx-auto max-w-lg text-center">
              <h2 className="font-semibold">We can’t confirm the current elevator state.</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                For immediate travel decisions, check the official SFMTA elevator page. UNBROKEN will show a status only after it passes verification.
              </p>
              <a className="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline" href="https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod" rel="noreferrer" target="_blank">
                Open official SFMTA status <ExternalLink className="size-3.5" />
              </a>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
