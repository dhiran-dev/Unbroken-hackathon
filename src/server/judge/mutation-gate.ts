/**
 * Judge cockpit — mutation gate (Agent A12).
 *
 * Pure, fail-closed gate shared by both judge server actions. Mutations are
 * allowed only when BOTH hold:
 *
 * 1. `PULSERANK_JUDGE_MUTATIONS_ENABLED` is true (the runtime flag defaults to
 *    false — the cockpit is read-only evidence unless explicitly unlocked), AND
 * 2. `PULSERANK_JUDGE_TOKEN` is configured on the server AND the submitted
 *    form token matches it exactly.
 *
 * A missing server-side token keeps everything locked even when the flag is
 * true: an unlockable-by-anyone cockpit would be a fail-open design.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export type MutationGateInput = {
  mutationsEnabled: boolean;
  /** Server-configured shared secret; null/undefined/empty = not configured. */
  expectedToken: string | null | undefined;
  /** Token submitted with the form; undefined when the field was absent. */
  providedToken: string | undefined | null;
};

export type MutationGateVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly reason: "flag_disabled" | "token_not_configured" | "token_required" | "token_mismatch";
    };

/** Constant-time-ish comparison: equal-length SHA-256 digests compared bitwise. */
export function tokensMatch(expected: string, provided: string): boolean {
  const digest = (value: string) =>
    createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(expected), digest(provided));
}

export function evaluateMutationGate(input: MutationGateInput): MutationGateVerdict {
  if (!input.mutationsEnabled) {
    return { allowed: false, reason: "flag_disabled" };
  }
  const expected = typeof input.expectedToken === "string" ? input.expectedToken : "";
  if (expected.trim() === "") {
    return { allowed: false, reason: "token_not_configured" };
  }
  if (typeof input.providedToken !== "string" || input.providedToken === "") {
    return { allowed: false, reason: "token_required" };
  }
  if (!tokensMatch(expected, input.providedToken)) {
    return { allowed: false, reason: "token_mismatch" };
  }
  return { allowed: true };
}
