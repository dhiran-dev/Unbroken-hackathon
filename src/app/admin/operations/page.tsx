import { Activity, CircleHelp, Clock3, Database, RadioTower, Server } from "lucide-react";
import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Operations" };

const components = [
  ["Web application", "Running", Server],
  ["PostgreSQL", "Awaiting readiness check", Database],
  ["Bright Data collector", "Awaiting first scheduled run", RadioTower],
  ["Worker", "No heartbeat received", Activity],
] as const;

export default function OperationsPage() {
  return (
    <div className="space-y-6">
      <div><p className="text-sm font-medium text-primary">System health</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">Operations</h1><p className="mt-2 text-sm text-muted-foreground">Live checks, collection health, and response timing.</p></div>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader className="border-b"><CardTitle>Components</CardTitle></CardHeader>
          <CardContent className="divide-y p-0">
            {components.map(([name, status, Icon]) => (
              <div className="flex items-center gap-3 px-5 py-4 sm:px-6" key={name}><span className="grid size-9 place-items-center rounded-lg border bg-muted"><Icon className="size-4 text-muted-foreground" /></span><div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="mt-0.5 text-xs text-muted-foreground">{status}</p></div><CircleHelp className="size-4 text-muted-foreground" /></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Latest check</CardTitle></CardHeader>
          <CardContent><div className="rounded-xl border border-dashed bg-muted/30 p-6 text-center"><Clock3 className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-medium">No completed checks</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Timing and uptime will appear after the worker reports its first heartbeat.</p></div></CardContent>
        </Card>
      </div>
    </div>
  );
}
