import { Clock3 } from "lucide-react";

import { AdminNavigation } from "@/components/admin-navigation";
import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireOperatorCapability } from "@/server/auth/session";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireOperatorCapability("operate");

  return (
    <div className="min-h-screen bg-muted/25 md:grid md:grid-cols-[232px_1fr]">
      <aside className="relative border-b bg-sidebar text-sidebar-foreground md:sticky md:top-0 md:h-screen md:border-b-0 md:border-r">
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-4 md:h-[60px]">
          <Brand />
          <div className="flex items-center gap-1 md:hidden">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </div>
        <AdminNavigation />
        <div className="absolute inset-x-0 bottom-0 hidden border-t border-sidebar-border p-3 md:block">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 p-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar text-xs font-semibold uppercase">
              {session.user.name.slice(0, 2)}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{session.user.name}</p>
              <p className="truncate text-[11px] capitalize text-muted-foreground">
                {session.user.role}
              </p>
            </div>
            <SignOutButton />
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
