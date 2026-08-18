import { Activity, Clock3, ExternalLink, History, LayoutDashboard, ShieldAlert } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/brand";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireOperator } from "@/server/auth/session";

const navigation = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/operations", label: "Operations", icon: Activity },
  { href: "/admin/history", label: "History", icon: History },
  { href: "/admin/incidents", label: "Incidents", icon: ShieldAlert },
];

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await requireOperator();

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
        <nav aria-label="Operator" className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-1">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:flex" href={href} key={href}><Icon className="size-4" /> {label}</Link>
          ))}
          <Link className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground md:flex" href="/status"><ExternalLink className="size-4" /> Public status</Link>
        </nav>
        <div className="hidden absolute inset-x-0 bottom-0 border-t border-sidebar-border p-3 md:block">
          <div className="flex items-center gap-3 rounded-xl bg-sidebar-accent/70 p-2.5">
            <div className="grid size-8 shrink-0 place-items-center rounded-lg border border-sidebar-border bg-sidebar text-xs font-semibold uppercase">{session.user.name.slice(0, 2)}</div>
            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{session.user.name}</p><p className="truncate text-[11px] capitalize text-muted-foreground">{session.user.role}</p></div>
            <SignOutButton />
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="surface-glass sticky top-0 z-30 hidden h-[60px] items-center justify-end gap-1 border-b px-5 md:flex"><span className="mr-auto inline-flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" /> Pacific time</span><ThemeToggle /></header>
        <main className="mx-auto max-w-[1400px] p-4 sm:p-6 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
