/**
 * Judge cockpit — mutation core (Agent A12).
 *
 * `executeJudgeMutation` is the single funnel both /judge server actions go
 * through. It is fail-closed and dependency-injected so the flag/token gating
 * is unit-testable without touching Bright Data:
 *
 * - the gate (flag + token) is evaluated BEFORE any service call — a locked or
 *   denied mutation never reaches the network,
 * - `heal-preview` calls the existing healing service
 *   (`requestBrightDataHealing`, src/server/services/bright-data-healing.ts),
 * - `rerun` runs the SAME collector through the existing collection service
 *   (`collectBrightData`, src/server/services/bright-data.ts) against a
 *   caffeineinformer.com URL only,
 * - successful envelopes are written under artifacts/demo/ only.
 */

import { evaluateMutationGate } from "@/server/judge/mutation-gate";

export type JudgeMutationKind = "heal-preview" | "rerun";

export type JudgeMutationDeps = {
  /** Existing healing service: bdata scraper heal behind the approval gate. */
  requestHealing: (prompt: string, sourceUrl: string) => Promise<unknown>;
  /** Existing collection service: trigger + download the same collector. */
  runCollector: (
    sourceUrl: string,
  ) => Promise<{ payload: unknown; collectionId: string; collectedAt: Date }>;
  /** Demo artifact writer (artifacts/demo/ only). */
  writeArtifact: (name: string, value: unknown) => Promise<void> | void;
};

export type JudgeMutationInput = {
  kind: JudgeMutationKind;
  sourceUrl: string;
  prompt?: string | undefined;
  token: string | undefined;
  mutationsEnabled: boolean;
  expectedToken: string | null | undefined;
};

export type JudgeMutationOutcome =
  | { readonly status: "locked"; readonly detail: string }
  | { readonly status: "denied"; readonly detail: string }
  | { readonly status: "ok"; readonly detail: string; readonly artifactName: string }
  | { readonly status: "error"; readonly detail: string };

/** Only the collector's registered target host may be driven from /judge. */
function isAllowedSourceUrl(value: string): boolean {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "caffeineinformer.com" || hostname.endsWith(".caffeineinformer.com")
    );
  } catch {
    return false;
  }
}

/**
 * Build the /judge redirect URL a mutation action returns to, so the outcome
 * banner renders in plain server HTML (works with JS disabled).
 */
export function judgeOutcomeUrl(kind: JudgeMutationKind, outcome: JudgeMutationOutcome): string {
  const params = new URLSearchParams({
    mutation: kind,
    outcome: outcome.status,
    detail: outcome.detail.slice(0, 300),
  });
  if (outcome.status === "ok") {
    params.set("artifact", outcome.artifactName);
  }
  return `/judge?${params.toString()}#step-${kind === "heal-preview" ? "heal-preview" : "rerun"}`;
}

const PROMPT_MIN_CHARS = 10;
const PROMPT_MAX_CHARS = 2000;

const DENIAL_COPY: Record<string, string> = {
  flag_disabled:
    "Mutations are locked: PULSERANK_JUDGE_MUTATIONS_ENABLED is false, so the cockpit is read-only.",
  token_not_configured:
    "Mutations are locked: PULSERANK_JUDGE_MUTATIONS_ENABLED is true but no PULSERANK_JUDGE_TOKEN is configured on the server.",
  token_required: "Mutation denied: the confirmation token field is required.",
  token_mismatch: "Mutation denied: the submitted token does not match PULSERANK_JUDGE_TOKEN.",
};

function demoArtifactName(kind: JudgeMutationKind, at: Date): string {
  const stamp = at.toISOString().replace(/[:.]/g, "-");
  return `${kind}-${stamp}.json`;
}

/**
 * Run one judge mutation through the gate. Resolves to a plain outcome object
 * (never throws for refusal reasons); service failures become `error`
 * outcomes with the failure code preserved in the detail.
 */
export async function executeJudgeMutation(
  deps: JudgeMutationDeps,
  input: JudgeMutationInput,
): Promise<JudgeMutationOutcome> {
  const gate = evaluateMutationGate({
    mutationsEnabled: input.mutationsEnabled,
    expectedToken: input.expectedToken,
    providedToken: input.token,
  });
  if (!gate.allowed) {
    return { status: "locked", detail: DENIAL_COPY[gate.reason] ?? "Mutations are locked." };
  }

  if (!isAllowedSourceUrl(input.sourceUrl)) {
    return {
      status: "denied",
      detail:
        "Refused: the source URL must be a caffeineinformer.com page (the collector's registered target).",
    };
  }

  try {
    if (input.kind === "heal-preview") {
      const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
      if (prompt.length < PROMPT_MIN_CHARS || prompt.length > PROMPT_MAX_CHARS) {
        return {
          status: "denied",
          detail: `Refused: the heal prompt must be ${PROMPT_MIN_CHARS}–${PROMPT_MAX_CHARS} characters.`,
        };
      }
      const envelope = await deps.requestHealing(prompt, input.sourceUrl);
      const name = demoArtifactName("heal-preview", new Date());
      await deps.writeArtifact(name, {
        kind: "judge-demo-heal-preview",
        requested_at: new Date().toISOString(),
        source_url: input.sourceUrl,
        prompt,
        envelope,
      });
      return {
        status: "ok",
        detail:
          "Heal preview requested through the healing service. The envelope stopped at the approval gate and was saved under artifacts/demo/.",
        artifactName: name,
      };
    }

    const result = await deps.runCollector(input.sourceUrl);
    const name = demoArtifactName("rerun", new Date());
    await deps.writeArtifact(name, {
      kind: "judge-demo-rerun",
      requested_at: new Date().toISOString(),
      source_url: input.sourceUrl,
      collection_id: result.collectionId,
      collected_at: result.collectedAt.toISOString(),
      payload: result.payload,
    });
    return {
      status: "ok",
      detail:
        "Collector rerun completed through the collection service. The payload was saved under artifacts/demo/. Validate it with the contract checks above before trusting it.",
      artifactName: name,
    };
  } catch (error) {
    const code = error instanceof Error && error.name !== "Error" ? error.name : "mutation_failed";
    const message = error instanceof Error ? error.message : "Unknown failure.";
    return {
      status: "error",
      detail: `Mutation failed (${code}): ${message}`.slice(0, 400),
    };
  }
}
