"use client";

import { LoaderCircle, Play } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

type State = "idle" | "pending" | "queued" | "error";

type RunNowButtonProps = {
  active: boolean;
};

export function RunNowButton({ active }: RunNowButtonProps) {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function runNow() {
    setState("pending");
    setMessage(null);
    const response = await fetch("/api/admin/runs", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setState("error");
      setMessage(body.error ?? "The collection could not be queued.");
      return;
    }
    setState("queued");
    setMessage("Collection queued. The worker will validate it before publication.");
  }

  const busy = active || state === "pending" || state === "queued";
  const statusMessage = active
    ? "A queued or running collection is already active."
    : message;

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <Button disabled={busy} onClick={runNow}>
        {active || state === "pending" ? (
          <LoaderCircle className="animate-spin" />
        ) : (
          <Play />
        )}
        {active
          ? "Collection in progress"
          : state === "pending"
            ? "Queuing…"
            : state === "queued"
              ? "Queued"
              : "Run now"}
      </Button>
      {statusMessage && (
        <p
          aria-live="polite"
          className={state === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}
        >
          {statusMessage}
        </p>
      )}
    </div>
  );
}
