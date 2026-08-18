import { CalendarDays, History } from "lucide-react";
import type { Metadata } from "next";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "History" };

export default function HistoryPage() {
  return (
    <div className="space-y-6">
      <div><p className="text-sm font-medium text-primary">Audit trail</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">History</h1><p className="mt-2 text-sm text-muted-foreground">Collections, status changes, incidents, and operator decisions.</p></div>
      <Card>
        <CardHeader className="border-b"><div className="flex items-center justify-between gap-3"><CardTitle>Recent activity</CardTitle><span className="inline-flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-xs text-muted-foreground"><CalendarDays className="size-3.5" /> Last 24 hours</span></div></CardHeader>
        <CardContent className="py-14"><div className="mx-auto max-w-sm text-center"><span className="mx-auto grid size-11 place-items-center rounded-xl border bg-muted"><History className="size-5 text-muted-foreground" /></span><h2 className="mt-4 text-sm font-semibold">No history yet</h2><p className="mt-1 text-sm leading-6 text-muted-foreground">Verified collections and operator actions will be recorded here.</p></div></CardContent>
      </Card>
    </div>
  );
}
