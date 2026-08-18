import Link from "next/link";

import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function PublicHeader() {
  return (
    <header className="surface-glass sticky top-0 z-40 border-b">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Brand />
        <nav aria-label="Primary" className="flex items-center gap-1">
          <Link className="hidden rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground sm:block" href="/">
            Plan a trip
          </Link>
          <Link className="whitespace-nowrap rounded-md px-2 py-2 text-sm text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground sm:px-3" href="/status">
            Elevator status
          </Link>
          <ThemeToggle />
          <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }), "ml-1")} href="/login">
            Sign in
          </Link>
        </nav>
      </div>
    </header>
  );
}
