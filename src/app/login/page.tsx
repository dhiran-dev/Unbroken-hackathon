import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getOperatorSession } from "@/server/auth/session";

export const metadata: Metadata = { title: "Operator sign in" };

export default async function LoginPage() {
  if (await getOperatorSession()) {
    redirect("/admin");
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_50%_0%,oklch(0.7_0.13_153/0.18),transparent_42%)]" />
      <div className="absolute left-4 top-4 sm:left-6 sm:top-6"><Brand /></div>
      <div className="absolute right-4 top-3.5 sm:right-6 sm:top-5"><ThemeToggle /></div>
      <div className="w-full max-w-md">
        <Link className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" href="/"><ArrowLeft className="size-4" /> Back to UNBROKEN</Link>
        <Card>
          <CardHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl border bg-muted"><ShieldCheck className="size-5 text-primary" /></div>
            <CardTitle className="text-xl">Operator sign in</CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">Access monitoring, history, and incident controls.</p>
          </CardHeader>
          <CardContent><LoginForm /></CardContent>
        </Card>
        <p className="mt-4 text-center text-xs leading-5 text-muted-foreground">Authorized owners and administrators only.</p>
      </div>
    </main>
  );
}
