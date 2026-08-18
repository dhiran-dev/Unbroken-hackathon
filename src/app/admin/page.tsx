import { Activity, ArrowRight, CircleHelp, Database, RadioTower } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const metrics = [
  ["Data trust", "Awaiting first check", CircleHelp],
  ["Collector", "Not checked", RadioTower],
  ["Database", "Ready check pending", Database],
  ["Open incidents", "No incident data", Activity],
] satisfies ReadonlyArray<readonly [string, string, LucideIcon]>;

export default function AdminOverviewPage() {
  return (
    <div className="space-y-6">
      <div><Badge>Operator workspace</Badge><h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Overview</h1><p className="mt-2 text-sm text-muted-foreground">Accessibility data health and operator controls.</p></div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(([label, value, Icon]) => (
          <Card key={label}><CardContent className="pt-5 sm:pt-6"><div className="flex items-start justify-between gap-4"><div><p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p><p className="mt-2 text-sm font-semibold">{value}</p></div><span className="grid size-9 place-items-center rounded-lg border bg-muted"><Icon className="size-4 text-muted-foreground" /></span></div></CardContent></Card>
        ))}
      </div>
      <Card>
        <CardHeader><CardTitle>Start with operations</CardTitle><p className="text-sm leading-6 text-muted-foreground">Review component readiness, collection freshness, and verification state in one place.</p></CardHeader>
        <CardContent><Link className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline" href="/admin/operations">Open operations <ArrowRight className="size-4" /></Link></CardContent>
      </Card>
    </div>
  );
}
