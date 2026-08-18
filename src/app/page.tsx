import { ArrowRight, CircleCheck, Clock3, Route, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { PublicHeader } from "@/components/public-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <PublicHeader />
      <main>
        <section className="relative overflow-hidden border-b">
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_-10%,oklch(0.65_0.18_264/0.14),transparent_42%)]" />
          <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.03fr_0.97fr] lg:items-center lg:py-28">
            <div className="max-w-2xl">
              <Badge><CircleCheck className="size-3.5" /> Elevator-aware Muni trips</Badge>
              <h1 className="text-balance mt-5 text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                A step-free trip should stay step-free.
              </h1>
              <p className="mt-5 max-w-xl text-balance text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                Plan with verified elevator information and see accessibility changes before they interrupt your journey.
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
                <div className="flex items-center gap-2 text-sm font-semibold"><Route className="size-4 text-primary" /> Plan a step-free trip</div>
                <p className="mt-1 text-sm text-muted-foreground">San Francisco Muni Metro</p>
              </div>
              <CardContent className="space-y-5 pt-5 sm:pt-6">
                <form action="/status" className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="origin">Starting point</Label>
                    <Input id="origin" name="origin" placeholder="Enter a station or place" required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="destination">Destination</Label>
                    <Input id="destination" name="destination" placeholder="Where are you going?" required />
                  </div>
                  <button className={cn(buttonVariants({ size: "lg" }), "w-full")} type="submit">
                    Find a step-free route <ArrowRight />
                  </button>
                </form>
                <div className="grid gap-3 border-t pt-5 text-sm sm:grid-cols-2">
                  <div className="flex gap-2.5"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" /><span>Routes change only when the evidence is trusted.</span></div>
                  <div className="flex gap-2.5"><Clock3 className="mt-0.5 size-4 shrink-0 text-primary" /><span>Verification time is shown with every update.</span></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
          <div className="grid gap-4 md:grid-cols-3">
            {[
              ["Clear status", "See which entrance, platform, or elevator affects your trip."],
              ["Honest freshness", "Know exactly when accessibility information was last verified."],
              ["Safer rerouting", "A broken data source never becomes a false all-clear."],
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
