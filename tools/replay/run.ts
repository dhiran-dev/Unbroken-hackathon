#!/usr/bin/env bun
/**
 * PulseRank golden replay harness (A6).
 *
 * Runs one fixture through the staged ingestion pipeline
 * (contract → normalize → validate → promote) and prints a stage-by-stage
 * JSON verdict. Stages execute cumulatively: requesting `--stage validate`
 * also runs contract and normalize first, because a later stage needs the
 * earlier stage's output.
 *
 * Usage:
 *   bun tools/replay/run.ts --fixture <path-to-fixture.json> [--stage all|contract|normalize|validate|promote]
 *
 * Output (stdout): a single JSON document whose `stages` array holds one
 * {stage, ok, findings} verdict per executed stage. Exit code 0 when every
 * executed stage passed, 1 otherwise.
 */

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { isAbsolute, resolve } from "node:path";

import {
  localPipelineStages,
  STAGE_ORDER,
  type Finding,
  type PipelineStages,
  type StageName,
  type StageResult,
} from "./adapters";
import type { ProductScrapeRowV1 } from "../../src/domain/product/contracts/product-scrape-row";

export interface ReplayReport {
  fixture: string;
  requestedStage: StageName | "all";
  ok: boolean;
  /** Stage at which the pipeline stopped early, if any. */
  haltedAt: StageName | null;
  /** One {stage, ok, findings} verdict per executed stage, in order. */
  stages: { stage: StageName; ok: boolean; findings: Finding[] }[];
  /** Final promoted row, or null if any stage failed. */
  finalRow: ProductScrapeRowV1 | null;
}

/** Harness stage names map onto PipelineStages methods like so. */
const METHOD_BY_STAGE: { [S in StageName]: keyof Omit<PipelineStages, never> & string } = {
  contract: "parse",
  normalize: "normalize",
  validate: "validateRun",
  promote: "promote",
};

function stagesUpTo(requested: StageName | "all"): readonly StageName[] {
  if (requested === "all") return STAGE_ORDER;
  const index = STAGE_ORDER.indexOf(requested);
  return STAGE_ORDER.slice(0, index + 1);
}

export function replayFixture(
  rawJsonText: string,
  requestedStage: StageName | "all" = "all",
  pipeline: PipelineStages = localPipelineStages,
  fixtureLabel = "(inline)",
): ReplayReport {
  const stages: ReplayReport["stages"] = [];
  let current: ProductScrapeRowV1 | null = null;
  let haltedAt: StageName | null = null;

  for (const stage of stagesUpTo(requestedStage)) {
    let result: StageResult<ProductScrapeRowV1>;
    if (stage === "contract") {
      result = pipeline.parse(rawJsonText);
    } else {
      if (current === null) {
        // Unreachable while stages halt on failure; guards against a
        // future adapter that reports ok with a null output.
        throw new Error(`replay harness: no input row available for stage "${stage}"`);
      }
      const method = METHOD_BY_STAGE[stage] as keyof PipelineStages;
      result = (pipeline[method] as (row: ProductScrapeRowV1) => StageResult<ProductScrapeRowV1>)(
        current,
      );
    }

    stages.push({ stage: result.stage, ok: result.ok, findings: result.findings });

    if (!result.ok) {
      haltedAt = stage;
      break;
    }
    current = result.output;
  }

  return {
    fixture: fixtureLabel,
    requestedStage,
    ok: haltedAt === null,
    haltedAt,
    stages,
    finalRow: current,
  };
}

function parseStage(value: string | undefined): StageName | "all" {
  if (value === undefined || value === "all") return "all";
  if ((STAGE_ORDER as readonly string[]).includes(value)) return value as StageName;
  process.stderr.write(
    `Unknown --stage "${value}". Expected one of: all, ${STAGE_ORDER.join(", ")}\n`,
  );
  process.exit(2);
}

function main(): void {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      fixture: { type: "string" },
      stage: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
    strict: true,
  });

  if (values.help || !values.fixture) {
    process.stderr.write(
      "Usage: bun tools/replay/run.ts --fixture <path-to-fixture.json> [--stage all|contract|normalize|validate|promote]\n",
    );
    process.exit(values.help ? 0 : 2);
  }

  const requestedStage = parseStage(values.stage);
  const fixturePath = isAbsolute(values.fixture)
    ? values.fixture
    : resolve(process.cwd(), values.fixture);

  let rawJsonText: string;
  try {
    rawJsonText = readFileSync(fixturePath, "utf8");
  } catch (error) {
    process.stderr.write(
      `Cannot read fixture ${fixturePath}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exit(2);
  }

  const report = replayFixture(rawJsonText, requestedStage, localPipelineStages, values.fixture);

  // Strip the full row from CLI output: verdicts only, per the harness contract.
  const verdict = { ...report, finalRow: report.finalRow === null ? null : "(omitted)" };
  process.stdout.write(`${JSON.stringify(verdict, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

if (import.meta.main) {
  main();
}
