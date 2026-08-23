import Link from "next/link";

import { cn } from "@/lib/utils";
import { PulseLogo } from "@/components/pulserank/pulse-logo";

export function Brand({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <Link
      aria-label="PulseRank home"
      className={cn("inline-flex items-center gap-2.5 font-semibold tracking-tight", className)}
      href="/"
    >
      <PulseLogo size={32} />
      {!compact && <span>PulseRank</span>}
    </Link>
  );
}
