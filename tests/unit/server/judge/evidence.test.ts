/**
 * Evidence-assembly tests (Agent A12): the computed verdicts the /judge page
 * displays, pinned against fixture copies of the REAL artifacts.
 *
 * Key claim under test: the broken (72250 mg) record maps to a conflicting
 * caffeine observation, so the A5 promotion logic makes it total-caffeine
 * INELIGIBLE; the healed (72 mg) record promotes rankable and eligible. No
 * fabricated numbers — everything derives from the fixture artifacts.
 */

import { describe, expect, it } from "vitest";

import { buildJudgeEvidence } from "@/server/judge/evidence";

import postHealRun from "../../../fixtures/judge/run-standard-post-heal.json";
import preHealRun from "../../../fixtures/judge/run-standard.json";

const STATS = [
  {
    name: "create.json",
    bytes: 10,
    modifiedAt: "2026-08-21T12:53:40.392Z",
  },
  {
    name: "run-standard.json",
    bytes: 10,
    modifiedAt: "2026-08-21T13:10:00.000Z",
  },
  {
    name: "run-standard-post-heal.json",
    bytes: 10,
    modifiedAt: "2026-08-21T14:00:00.000Z",
  },
];

function build() {
  return buildJudgeEvidence({
    create: { collector_id: "c_mt2yacvcyvyvim56d", name: "caffeine-pdp", status: "done" },
    runStandard: preHealRun,
    heal: {
      collector_id: "c_mt2yacvcyvyvim56d",
      status: "awaiting_approval",
      prompt: "caffeine_mg_per_serving returned 72250 … fix to about 72",
      diff_summary: "proposed template has 1 step(s)",
      completed_steps: ["planner", "code_fixer"],
      preview_result: [postHealRun[0]],
    },
    approve: {
      collector_id: "c_mt2yacvcyvyvim56d",
      status: "done",
      completed_steps: ["user_approval", "save_new_template"],
    },
    runStandardPostHeal: postHealRun,
    runDiscoveryBeforeHeal: [
      {
        product_name: "Caffeine Content of Drinks",
        input: { url: "https://www.caffeineinformer.com/the-caffeine-database" },
      },
    ],
    healDiscovery: { status: "heal_trigger_failed", error: "Another refactor job is still in progress" },
    healDiscoveryAttempt2: { status: "heal_trigger_failed", error: "Another refactor job is still in progress" },
    artifactStats: STATS,
    demoArtifacts: [],
    mutationsEnabled: false,
  });
}

describe("buildJudgeEvidence — contract verdicts", () => {
  const model = build();

  it("validates BOTH mapped rows against the zod contract (shape-level)", () => {
    expect(model.preHeal.contract.ok).toBe(true);
    expect(model.postHeal.contract.ok).toBe(true);
  });

  it("passes A5 run-level checks on both single-row runs", () => {
    expect(model.preHeal.runValidation?.ok).toBe(true);
    expect(model.postHeal.runValidation?.ok).toBe(true);
  });

  it("computes the unit bug on the pre-heal record and agreement post-heal", () => {
    expect(model.preHeal.unitCheck).toMatchObject({
      perServingMg: 72250,
      impliedPerServingMg: 71.975,
      consistent: false,
    });
    expect(model.postHeal.unitCheck).toMatchObject({
      perServingMg: 72,
      impliedPerServingMg: 71.975,
      consistent: true,
    });
  });
});

describe("buildJudgeEvidence — promotion / ranking impact (real A5 output)", () => {
  const model = build();

  it("excludes the broken record from every board via the conflict rule", () => {
    const pre = model.preHeal.promotion!;
    expect(pre.fieldVerdicts.caffeine_mg.verdict).toBe("conflict");
    expect(pre.fieldVerdicts.caffeine_mg.rankable).toBe(false);
    expect(pre.fieldVerdicts.caffeine_mg.exactBoardEligible).toBe(false);
    expect(pre.fieldVerdicts.serving.totalCaffeineEligible).toBe(false);
    // Conflicts are valid reviewed data: no incident, record stays trusted.
    expect(pre.incidents).toHaveLength(0);
    expect(pre.overall).toBe("trusted");
  });

  it("restores total-caffeine eligibility for the healed record", () => {
    const post = model.postHeal.promotion!;
    expect(post.fieldVerdicts.caffeine_mg).toMatchObject({
      verdict: "value",
      value: 72,
      qualifier: "exact",
      rankable: true,
      exactBoardEligible: true,
    });
    expect(post.fieldVerdicts.serving.totalCaffeineEligible).toBe(true);
    expect(post.fieldVerdicts.serving.concentrationEligible).toBe(true);
    expect(post.overall).toBe("trusted");
  });

  it("computes concentration only for the healed record (28.8 mg/100ml)", () => {
    // The conflicting pre-heal observation carries no exact value, so the A5
    // normalizer refuses to produce a concentration figure at all.
    expect(model.preHeal.normalized?.concentration).toEqual({
      mgPer100Ml: null,
      basis: "no_exact_caffeine",
    });
    expect(model.postHeal.normalized?.concentration).toEqual({
      mgPer100Ml: 28.8,
      basis: "computed",
    });
  });

  it("derives observedAt from the artifact stats, not the clock", () => {
    expect(model.preHeal.observedAt).toBe("2026-08-21T13:10:00.000Z");
    expect(model.postHeal.observedAt).toBe("2026-08-21T14:00:00.000Z");
  });
});

describe("buildJudgeEvidence — missing artifacts degrade honestly", () => {
  it("renders unavailable analyses instead of inventing data", () => {
    const model = buildJudgeEvidence({
      create: null,
      runStandard: null,
      heal: null,
      approve: null,
      runStandardPostHeal: null,
      runDiscoveryBeforeHeal: null,
      healDiscovery: null,
      healDiscoveryAttempt2: null,
      artifactStats: [],
      demoArtifacts: [],
      mutationsEnabled: false,
    });

    expect(model.preHeal.record).toBeNull();
    expect(model.preHeal.scrapeRow).toBeNull();
    expect(model.preHeal.promotion).toBeNull();
    expect(model.preHeal.contract).toMatchObject({ ok: false });
    expect(model.postHeal.promotion).toBeNull();
    expect(model.heal).toBeNull();
    expect(model.approve).toBeNull();
    expect(model.collectorId).toBe("c_mt33nlnkq376z132b");
  });
});
