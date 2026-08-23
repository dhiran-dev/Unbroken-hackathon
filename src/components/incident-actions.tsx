"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  APPROVAL_CONFIRMATION,
  REJECTION_CONFIRMATION,
  type IncidentAction,
} from "@/domain/incidents/client-contract";
import type { IncidentState } from "@/domain/incidents/machine";

import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

export function IncidentActions({
  incidentId,
  state,
}: {
  incidentId: string;
  state: IncidentState;
}) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [pending, setPending] = useState<IncidentAction | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(
    action: IncidentAction,
    body: Record<string, string> = {},
  ) {
    setPending(action);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/admin/incidents/${incidentId}/${action}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify(body),
        },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Action failed.");
      setMessage(
        action === "acknowledge"
          ? "Incident acknowledged."
          : `${action[0]?.toUpperCase()}${action.slice(1)} queued for the worker.`,
      );
      setPrompt("");
      setConfirmation("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Action failed.");
    } finally {
      setPending(null);
    }
  }

  const canHeal = [
    "acknowledged",
    "preview_rejected",
    "rejected",
    "verification_failed",
  ].includes(state);
  const canApprove = ["awaiting_review", "awaiting_approval"].includes(state);
  const canReject = ["preview_rejected", "awaiting_review", "awaiting_approval"].includes(state);

  return (
    <div className="space-y-5">
      {state === "detected" && (
        <Button
          disabled={pending !== null}
          onClick={() => submit("acknowledge")}
        >
          Acknowledge incident
        </Button>
      )}

      {canHeal && (
        <div className="space-y-2">
          <Label htmlFor="healing-prompt">Observed extraction problem</Label>
          <textarea
            className="min-h-28 w-full rounded-[var(--control-radius)] border border-input bg-card px-3 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            id="healing-prompt"
            maxLength={700}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="Describe exactly which fields, stations, or rows changed. Do not propose invented values."
            value={prompt}
          />
          <Button
            disabled={pending !== null || prompt.trim().length < 20}
            onClick={() => submit("heal", { prompt })}
          >
            Request safe healing
          </Button>
          <p className="text-xs leading-5 text-muted-foreground">
            This creates a draft preview only. It cannot update production.
          </p>
        </div>
      )}

      {state === "awaiting_review" && (
        <Button
          disabled={pending !== null}
          onClick={() => submit("review")}
          variant="outline"
        >
          Request Fireworks advisory review
        </Button>
      )}

      {(canApprove || canReject) && (
        <div className="space-y-3 rounded-xl border bg-muted/25 p-4">
          <div>
            <p className="text-sm font-medium">Explicit human decision</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Read the deterministic checks and advisory report first. The LLM
              cannot perform either action.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="decision-confirmation">Confirmation phrase</Label>
            <Input
              id="decision-confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={APPROVAL_CONFIRMATION}
              value={confirmation}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {canApprove && (
              <Button
                disabled={
                  pending !== null || confirmation !== APPROVAL_CONFIRMATION
                }
                onClick={() =>
                  submit("approve", { confirmation: APPROVAL_CONFIRMATION })
                }
              >
                Approve and save
              </Button>
            )}
            <Button
              disabled={
                pending !== null || confirmation !== REJECTION_CONFIRMATION
              }
              onClick={() =>
                submit("reject", { confirmation: REJECTION_CONFIRMATION })
              }
              variant="destructive"
            >
              Reject proposal
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            To reject, type <span className="font-mono">{REJECTION_CONFIRMATION}</span>.
          </p>
        </div>
      )}

      {["approved", "verification_failed"].includes(state) && (
        <Button
          disabled={pending !== null}
          onClick={() => submit("verify")}
          variant="outline"
        >
          Run post-approval verification
        </Button>
      )}

      {message && (
        <p aria-live="polite" className="text-xs leading-5 text-muted-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
