/**
 * Flag/token gating tests for the judge mutation funnel (Agent A12).
 *
 * `executeJudgeMutation` is the single funnel both /judge server actions go
 * through; these tests pin that NO service is reachable unless
 * PULSERANK_JUDGE_MUTATIONS_ENABLED is true AND the submitted token matches
 * PULSERANK_JUDGE_TOKEN. All Bright Data services are injected fakes — nothing
 * here touches the network or the filesystem.
 */

import { describe, expect, it, vi } from "vitest";

import { evaluateMutationGate, tokensMatch } from "@/server/judge/mutation-gate";
import {
  executeJudgeMutation,
  judgeOutcomeUrl,
  type JudgeMutationDeps,
} from "@/server/judge/mutations";

const STING_URL = "https://www.caffeineinformer.com/caffeine-content/sting";
const GOOD_PROMPT =
  "caffeine_mg_per_serving returned 72250 which is ~1000x too high; the page states about 72 mg per 250 ml serving.";

function gateInput(overrides?: Partial<Parameters<typeof executeJudgeMutation>[1]>): {
  token: string;
  expectedToken: string;
  mutationsEnabled: boolean;
} {
  return { token: "judge-secret", expectedToken: "judge-secret", mutationsEnabled: true };
}

type Deps = JudgeMutationDeps & {
  requestHealing: ReturnType<typeof vi.fn>;
  runCollector: ReturnType<typeof vi.fn>;
  writeArtifact: ReturnType<typeof vi.fn>;
};

function makeDeps(): Deps {
  const requestHealing = vi.fn(async () => ({
    collector_id: "c_mt2yacvcyvyvim56d",
    status: "awaiting_approval",
  }));
  const runCollector = vi.fn(async () => ({
    payload: [{ product_name: "Sting Energy Drink" }],
    collectionId: "j_abc123",
    collectedAt: new Date(0),
  }));
  const writeArtifact = vi.fn();
  return { requestHealing, runCollector, writeArtifact };
}

describe("evaluateMutationGate", () => {
  it("locks everything while PULSERANK_JUDGE_MUTATIONS_ENABLED is false", () => {
    const verdict = evaluateMutationGate({
      mutationsEnabled: false,
      expectedToken: "judge-secret",
      providedToken: "judge-secret",
    });
    expect(verdict).toEqual({ allowed: false, reason: "flag_disabled" });
  });

  it("stays locked when the flag is on but no server token is configured", () => {
    for (const expectedToken of [null, undefined, "", "   "]) {
      const verdict = evaluateMutationGate({
        mutationsEnabled: true,
        expectedToken,
        providedToken: "anything",
      });
      expect(verdict).toEqual({ allowed: false, reason: "token_not_configured" });
    }
  });

  it("denies missing, empty, or wrong tokens when configured", () => {
    expect(
      evaluateMutationGate({
        mutationsEnabled: true,
        expectedToken: "s3cret",
        providedToken: undefined,
      }),
    ).toEqual({ allowed: false, reason: "token_required" });
    expect(
      evaluateMutationGate({ mutationsEnabled: true, expectedToken: "s3cret", providedToken: "" }),
    ).toEqual({ allowed: false, reason: "token_required" });
    expect(
      evaluateMutationGate({
        mutationsEnabled: true,
        expectedToken: "s3cret",
        providedToken: "wrong",
      }),
    ).toEqual({ allowed: false, reason: "token_mismatch" });
  });

  it("allows an exact token match only when the flag is enabled", () => {
    expect(
      evaluateMutationGate({
        mutationsEnabled: true,
        expectedToken: "s3cret",
        providedToken: "s3cret",
      }),
    ).toEqual({ allowed: true });
  });

  it("compares tokens via fixed-length digests (no length leak)", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcdef")).toBe(false);
  });
});

describe("executeJudgeMutation — gating happens before any service call", () => {
  it("never reaches the healing service or writer when the flag is disabled", async () => {
    const deps = makeDeps();
    const outcome = await executeJudgeMutation(deps, {
      kind: "heal-preview",
      sourceUrl: STING_URL,
      prompt: GOOD_PROMPT,
      token: "judge-secret",
      mutationsEnabled: false,
      expectedToken: "judge-secret",
    });

    expect(outcome.status).toBe("locked");
    if (outcome.status === "locked") {
      expect(outcome.detail).toContain("PULSERANK_JUDGE_MUTATIONS_ENABLED");
    }
    expect(deps.requestHealing).not.toHaveBeenCalled();
    expect(deps.runCollector).not.toHaveBeenCalled();
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });

  it("never reaches the services on a token mismatch (flag enabled)", async () => {
    const deps = makeDeps();
    const outcome = await executeJudgeMutation(deps, {
      kind: "rerun",
      sourceUrl: STING_URL,
      token: "nope",
      expectedToken: "judge-secret",
      mutationsEnabled: true,
    });

    expect(outcome.status).toBe("locked");
    expect(outcome).toMatchObject({ status: "locked" });
    expect(deps.requestHealing).not.toHaveBeenCalled();
    expect(deps.runCollector).not.toHaveBeenCalled();
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });
});

describe("executeJudgeMutation — happy paths with injected services", () => {
  it("heal-preview calls the healing service once and writes one demo artifact", async () => {
    const deps = makeDeps();
    const outcome = await executeJudgeMutation(deps, {
      kind: "heal-preview",
      sourceUrl: STING_URL,
      prompt: GOOD_PROMPT,
      ...gateInput(),
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status === "ok") {
      expect(outcome.artifactName.startsWith("heal-preview-")).toBe(true);
      expect(outcome.artifactName.endsWith(".json")).toBe(true);
    }
    expect(deps.requestHealing).toHaveBeenCalledTimes(1);
    expect(deps.requestHealing.mock.calls[0]?.[0]).toContain("72 mg");
    expect(deps.requestHealing.mock.calls[0]?.[1]).toBe(STING_URL);
    expect(deps.writeArtifact).toHaveBeenCalledTimes(1);
    const [name, body] = deps.writeArtifact.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(name)).toMatch(/^heal-preview-.*\.json$/);
    expect(body.kind).toBe("judge-demo-heal-preview");
    expect(body.source_url).toBe(STING_URL);
  });

  it("rerun calls the collection service once and writes one demo artifact", async () => {
    const deps = makeDeps();
    const outcome = await executeJudgeMutation(deps, {
      kind: "rerun",
      sourceUrl: STING_URL,
      ...gateInput(),
    });

    expect(outcome.status).toBe("ok");
    expect(deps.runCollector).toHaveBeenCalledTimes(1);
    expect(deps.runCollector.mock.calls[0]?.[0]).toBe(STING_URL);
    expect(deps.writeArtifact).toHaveBeenCalledTimes(1);
    const [name, body] = deps.writeArtifact.mock.calls[0] as [string, Record<string, unknown>];
    expect(String(name)).toMatch(/^rerun-.*\.json$/);
    expect(body).toMatchObject({ kind: "judge-demo-rerun", collection_id: "j_abc123" });
  });
});

describe("executeJudgeMutation — input validation refusals (post-gate)", () => {
  it("refuses non-caffeineinformer targets without any service call", async () => {
    const deps = makeDeps();
    for (const url of [
      "https://evil.example.com/page",
      "/etc/passwd",
      "not a url",
      // A lookalike host must not pass a suffix check.
      "https://caffeineinformer.com.evil.test/x",
    ]) {
      const outcome = await executeJudgeMutation(deps, {
        kind: "rerun",
        sourceUrl: url,
        ...gateInput(),
      });
      expect(outcome.status).toBe("denied");
    }
    expect(deps.runCollector).not.toHaveBeenCalled();
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });

  it("enforces prompt bounds for heal previews", async () => {
    const deps = makeDeps();
    const outcome = await executeJudgeMutation(deps, {
      kind: "heal-preview",
      sourceUrl: STING_URL,
      prompt: "short",
      ...gateInput(),
    });
    expect(outcome.status).toBe("denied");
    expect(deps.requestHealing).not.toHaveBeenCalled();
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });

  it("turns service failures into error outcomes without writing artifacts", async () => {
    const deps = makeDeps();
    deps.requestHealing.mockRejectedValueOnce(new Error("BRIGHT_DATA_HEAL_TIMEOUT"));
    const outcome = await executeJudgeMutation(deps, {
      kind: "heal-preview",
      sourceUrl: STING_URL,
      prompt: GOOD_PROMPT,
      ...gateInput(),
    });

    expect(outcome.status).toBe("error");
    if (outcome.status === "error") {
      expect(outcome.detail).toContain("BRIGHT_DATA_HEAL_TIMEOUT");
    }
    expect(deps.writeArtifact).not.toHaveBeenCalled();
  });
});

describe("judgeOutcomeUrl", () => {
  it("encodes the outcome for the no-JS redirect banner", () => {
    const url = judgeOutcomeUrl("heal-preview", {
      status: "ok",
      detail: "done",
      artifactName: "heal-preview-2026.json",
    });
    expect(url.startsWith("/judge?")).toBe(true);
    expect(url).toContain("mutation=heal-preview");
    expect(url).toContain("outcome=ok");
    expect(url).toContain("artifact=heal-preview-2026.json");
    expect(url).toContain("#step-heal-preview");

    const lockedUrl = judgeOutcomeUrl("rerun", {
      status: "locked",
      detail: "Mutations are locked.",
    });
    expect(lockedUrl).toContain("outcome=locked");
    expect(lockedUrl).not.toContain("artifact=");
    expect(lockedUrl).toContain("#step-rerun");
  });
});
