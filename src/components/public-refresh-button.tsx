"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";

export function PublicRefreshButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <Button
      aria-label="Refresh elevator status"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      size="sm"
      type="button"
      variant="outline"
    >
      <RefreshCw aria-hidden="true" className={isPending ? "animate-spin" : undefined} />
      <span>{isPending ? "Refreshing…" : "Refresh"}</span>
      <span className="sr-only" aria-live="polite">
        {isPending ? "Refreshing elevator status." : ""}
      </span>
    </Button>
  );
}
