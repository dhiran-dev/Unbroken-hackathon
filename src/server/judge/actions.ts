"use server";

/**
 * Judge cockpit — server actions (Agent A12).
 *
 * Two flag-gated demo mutations, wired to the EXISTING Bright Data services:
 *
 * - `healPreviewAction` → requestBrightDataHealing (bright-data-healing
 *   service; the bdata scraper heal flow that stops at the approval gate),
 * - `rerunCollectorAction` → collectBrightData (bright-data collection
 *   service; triggers + downloads the SAME collector id).
 *
 * Both refuse to touch any service unless PULSERANK_JUDGE_MUTATIONS_ENABLED is
 * true AND the submitted form token matches PULSERANK_JUDGE_TOKEN (see
 * mutation-gate.ts). Successful envelopes are written under artifacts/demo/
 * ONLY — recorded evidence under artifacts/scraper/ is never modified.
 *
 * The actions end in a redirect back to /judge with the outcome encoded in
 * query params, so the result banner renders as plain HTML without JS.
 */

import { redirect } from "next/navigation";

import { pulserankServerFlags } from "@/config/pulserank-flags";
import { getServerEnv } from "@/lib/env";
import { writeDemoArtifact } from "@/server/judge/demo-artifacts";
import {
  executeJudgeMutation,
  judgeOutcomeUrl,
  type JudgeMutationDeps,
  type JudgeMutationKind,
} from "@/server/judge/mutations";
import { collectBrightData } from "@/server/services/bright-data";
import { requestBrightDataHealing } from "@/server/services/bright-data-healing";

function realDeps(): JudgeMutationDeps {
  return {
    requestHealing: (prompt, sourceUrl) => requestBrightDataHealing(prompt, sourceUrl),
    runCollector: async (sourceUrl) => {
      const env = getServerEnv();
      return collectBrightData({
        BRIGHTDATA_API_TOKEN: env.BRIGHTDATA_API_TOKEN,
        BRIGHTDATA_COLLECTOR_ID: env.BRIGHTDATA_COLLECTOR_ID,
        sourceUrl,
      });
    },
    writeArtifact: (name, value) => {
      writeDemoArtifact(name, value);
    },
  };
}

function formToken(formData: FormData): string | undefined {
  const value = formData.get("token");
  return typeof value === "string" && value !== "" ? value : undefined;
}

export async function healPreviewAction(formData: FormData): Promise<void> {
  const outcome = await executeJudgeMutation(realDeps(), {
    kind: "heal-preview",
    sourceUrl: String(formData.get("sourceUrl") ?? ""),
    prompt: String(formData.get("prompt") ?? ""),
    token: formToken(formData),
    mutationsEnabled: pulserankServerFlags.judgeMutationsEnabled,
    expectedToken: process.env.PULSERANK_JUDGE_TOKEN ?? null,
  });
  redirect(judgeOutcomeUrl("heal-preview" satisfies JudgeMutationKind, outcome));
}

export async function rerunCollectorAction(formData: FormData): Promise<void> {
  const outcome = await executeJudgeMutation(realDeps(), {
    kind: "rerun",
    sourceUrl: String(formData.get("sourceUrl") ?? ""),
    token: formToken(formData),
    mutationsEnabled: pulserankServerFlags.judgeMutationsEnabled,
    expectedToken: process.env.PULSERANK_JUDGE_TOKEN ?? null,
  });
  redirect(judgeOutcomeUrl("rerun", outcome));
}
