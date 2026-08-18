import { Accessibility } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      aria-label="UNBROKEN home"
      className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}
      href="/"
    >
      <span className="grid size-8 place-items-center rounded-lg border border-primary/20 bg-primary text-primary-foreground shadow-xs">
        <Accessibility aria-hidden="true" className="size-4" strokeWidth={2.25} />
      </span>
      {!compact && <span>UNBROKEN</span>}
    </Link>
  );
}
