import { Clock3 } from "lucide-react";

import { AdminNavigation } from "@/components/admin-navigation";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { pulserankServerFlags } from "@/config/pulserank-flags";

/**
 * Admin shell (disposition RETAIN_AND_REFACTOR). The operator-auth gating and
 * sign-out control went away with the deleted Better-Auth runtime; the shell
 * now surfaces the PulseRank judge-mode state instead. Mutating endpoints stay
 * fail-closed behind PULSERANK_JUDGE_MUTATIONS_ENABLED until the judge-mode
 * actor model lands.
 */
export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const judgeMode = pulserankServerFlags.judgeMutationsEnabled;

  return (
    <div className="min-h-screen bg-muted/25 md:grid md:grid-cols-[232px_1fr]">
      <aside className="relative border-b bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4 md:h-[60px]">
          <Brand />
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
          </div>
        </div>
        <AdminNavigation />
        <div className="absolute inset-x-0 bottom-0 hidden border-t border-sidebar-border p-3 md:block">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 p-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar text-xs font-semibold uppercase">
              PR
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">Judge mode</p>
              <p className="truncate text-[11px] capitalize text-muted-foreground">
                {judgeMode ? "mutations enabled" : "read-only"}
              </p>
            </div>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="surface-glass sticky top-0 z-30 hidden h-[60px] items-center justify-end gap-1 border-b px-5 md:flex">
          <span className="mr-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Clock3 aria-hidden="true" className="size-3.5" /> Pacific time
          </span>
          <ThemeToggle />
        </header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
