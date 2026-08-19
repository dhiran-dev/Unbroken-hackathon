"use client";

import {
  Activity,
  ExternalLink,
  History,
  LayoutDashboard,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const navigation = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/operations", label: "Operations", icon: Activity },
  { href: "/admin/history", label: "History", icon: History },
  { href: "/admin/incidents", label: "Incidents", icon: ShieldAlert },
];

export function AdminNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="Operator" className="flex gap-1 overflow-x-auto p-2 md:block md:space-y-1">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 md:flex",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
            )}
            href={href}
            key={href}
          >
            <Icon aria-hidden="true" className="size-4" />
            {label}
          </Link>
        );
      })}
      <Link
        aria-current={pathname === "/status" ? "page" : undefined}
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors duration-150 md:flex",
          pathname === "/status"
            ? "bg-sidebar-accent text-sidebar-accent-foreground"
            : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        )}
        href="/status"
      >
        <ExternalLink aria-hidden="true" className="size-4" />
        Public status
      </Link>
    </nav>
  );
}
