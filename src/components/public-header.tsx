import Link from "next/link";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

/**
 * PulseRank public header (disposition REWRITE). The legacy UNBROKEN nav
 * entries (trip planner, citywide data, elevator status, sign-in) pointed at
 * routes removed with the L1 cleanup batch; PulseRank navigation lands with
 * the public surfaces it will link to.
 */
export function PublicHeader() {
  return (
    <header className="surface-glass sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="PulseRank home">
          <Brand className="sm:hidden" compact />
        </Link>
        <Link href="/" aria-label="PulseRank home" className="hidden sm:inline-flex">
          <Brand />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
