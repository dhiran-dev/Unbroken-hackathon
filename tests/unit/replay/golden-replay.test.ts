/**
 * Golden replay regression suite (A6).
 *
 * Runs EVERY fixture under src/domain/product/fixtures/ through the replay
 * harness (tools/replay/) and snapshots the stage-by-stage verdicts into
 * __snapshots__/. The two negative fixture classes must fail at the contract
 * stage for the specific reason their name describes; every positive class
 * must pass all four stages.
 *
 * Adapter note: normalize/validate/promote are local shape-preserving
 * pass-throughs until A5 is rewired into tools/replay/adapters.ts — see
 * tools/replay/README.md. When A5 lands, these snapshots become the
 * regression gate for its behavior on the golden corpus.
 */

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { replayFixture, type ReplayReport } from "../../../tools/replay/run";

const FIXTURES_DIR = fileURLToPath(
  new URL("../../../src/domain/product/fixtures", import.meta.url),
);

/** The two intentionally-invalid fixture classes from §8.6 / A3 handoff. */
const NEGATIVE_FIXTURES = ["invalid-negative.json", "wrong-host.json"] as const;

function fixtureNames(): string[] {
  return readdirSync(FIXTURES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES_DIR, name), "utf8");
}

function replay(name: string): ReplayReport {
  return replayFixture(loadFixture(name), "all", undefined, name);
}

/** Compact, deterministic view of a report used for snapshotting. */
function snapshotView(report: ReplayReport) {
  const row = report.finalRow;
  return {
    ok: report.ok,
    haltedAt: report.haltedAt,
    stages: report.stages,
    finalRowShape:
      row === null
        ? null
        : {
            schemaVersion: row.schemaVersion,
            slug: row.source.slug,
            variants: row.variants.length,
            flavours: row.flavours.map((flavour) => ({
              name: flavour.name,
              availability: flavour.availability,
              evidence: flavour.evidence,
            })),
            primaryCaffeine: {
              state: row.primary.caffeineMg.state,
              value: row.primary.caffeineMg.value,
              qualifier: row.primary.caffeineMg.qualifier,
            },
            servingState: row.primary.serving.state,
            publicationState: row.media.publicationState,
          },
  };
}

describe("golden replay harness (A6)", () => {
  it("sees the full 15-fixture golden corpus", () => {
    expect(fixtureNames()).toHaveLength(15);
    expect(fixtureNames()).toEqual(
      expect.arrayContaining([
        "per-item-candy.json",
        "flavour-list.json",
        "struck-through-flavours.json",
        "missing-serving.json",
      ]),
    );
  });

  describe("negative fixture classes fail at the contract stage", () => {
    it.each([...NEGATIVE_FIXTURES])("%s is rejected by the contract", (name) => {
      const report = replay(name);
      expect(report.ok).toBe(false);
      expect(report.haltedAt).toBe("contract");
      expect(report.stages).toHaveLength(1);
      expect(report.stages[0]!.ok).toBe(false);
      expect(report.finalRow).toBeNull();
    });

    it("invalid-negative.json fails on a non-negative-quantity violation", () => {
      const findings = replay("invalid-negative.json").stages[0]!.findings;
      expect(findings.length).toBeGreaterThan(0);
      expect(findings.some((finding) => finding.code === "schema_invalid")).toBe(true);
      expect(findings.some((finding) => finding.path?.includes("caffeineMg"))).toBe(true);
    });

    it("wrong-host.json fails on the caffeineinformer.com host pin", () => {
      const findings = replay("wrong-host.json").stages[0]!.findings;
      expect(findings.some((finding) => /caffeineinformer\.com/.test(finding.message))).toBe(
        true,
      );
    });
  });

  describe("every positive fixture passes all four stages", () => {
    const positives = fixtureNames().filter(
      (name) => !(NEGATIVE_FIXTURES as readonly string[]).includes(name),
    );

    it.each(positives)("%s replays contract→normalize→validate→promote cleanly", (name) => {
      const report = replay(name);
      expect(report.ok).toBe(true);
      expect(report.haltedAt).toBeNull();
      expect(report.stages.map((stage) => stage.stage)).toEqual([
        "contract",
        "normalize",
        "validate",
        "promote",
      ]);
      for (const stage of report.stages) {
        expect(stage.ok).toBe(true);
        // Pass-through placeholders must not inject findings of their own.
        expect(stage.findings).toEqual([]);
      }
      expect(report.finalRow).not.toBeNull();
    });
  });

  describe("fixture-class semantics survive the pipeline", () => {
    it("per-item-candy.json keeps the per-piece unit unconverted", () => {
      const row = replay("per-item-candy.json").finalRow!;
      expect(row.primary.serving).toMatchObject({
        state: "present",
        value: 1,
        unit: "candy",
        form: "item",
        normalizedMl: null,
      });
      expect(row.primary.caffeineMg.rawText).toContain("per piece");
    });

    it("flavour-list.json records mixed availability including strikethrough evidence", () => {
      const row = replay("flavour-list.json").finalRow!;
      const availabilities = row.flavours.map((flavour) => flavour.availability);
      expect(availabilities).toContain("listed");
      expect(availabilities).toContain("appears_inactive");
      expect(availabilities).toContain("explicitly_discontinued");
      expect(row.flavours.filter((flavour) => flavour.evidence === "strikethrough")).toHaveLength(
        1,
      );
    });

    it("struck-through-flavours.json marks struck-through flavours appears_inactive", () => {
      const row = replay("struck-through-flavours.json").finalRow!;
      const struckOut = row.flavours.filter((flavour) => flavour.evidence === "strikethrough");
      expect(struckOut.length).toBeGreaterThanOrEqual(2);
      for (const flavour of struckOut) {
        expect(flavour.availability).toBe("appears_inactive");
      }
    });

    it("missing-serving.json keeps total caffeine present with an unpublished serving", () => {
      const row = replay("missing-serving.json").finalRow!;
      expect(row.primary.caffeineMg).toMatchObject({
        state: "present",
        value: 120,
      });
      expect(row.primary.serving).toMatchObject({
        state: "not_published",
        value: null,
        normalizedMl: null,
      });
    });
  });

  describe("golden stage-output snapshots (__snapshots__)", () => {
    it.each(fixtureNames())("%s stage verdicts match the golden snapshot", (name) => {
      expect(snapshotView(replay(name))).toMatchSnapshot();
    });
  });
});
