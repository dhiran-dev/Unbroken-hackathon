import path from "node:path";

import { brightDataHealEnvelopeSchema } from "@/domain/incidents/contract";
import { getServerEnv } from "@/lib/env";

const CLI_TIMEOUT_MS = 11 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

export class HealingIntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HealingIntegrationError";
  }
}

async function runBrightDataCli(args: string[]) {
  const env = getServerEnv();
  const cliEntry = path.resolve(
    "node_modules/@brightdata/cli/dist/index.js",
  );
  const subprocess = Bun.spawn([process.execPath, cliEntry, ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRIGHTDATA_API_KEY: env.BRIGHTDATA_API_TOKEN,
      NO_COLOR: "1",
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    subprocess.kill();
  }, CLI_TIMEOUT_MS);

  const [exitCode, stdout, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stdout).text(),
    new Response(subprocess.stderr).text(),
  ]);
  clearTimeout(timeout);

  if (timedOut) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_TIMEOUT",
      "Bright Data healing did not finish before the bounded deadline.",
    );
  }
  if (stdout.length > MAX_OUTPUT_BYTES || stderr.length > MAX_OUTPUT_BYTES) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_OUTPUT_TOO_LARGE",
      "Bright Data healing returned more evidence than the safety limit allows.",
    );
  }
  if (exitCode !== 0) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_CLI_FAILED",
      "Bright Data healing did not complete. The existing production collector was left unchanged.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_ENVELOPE_INVALID",
      "Bright Data healing did not return a valid JSON envelope.",
    );
  }

  const parsed = brightDataHealEnvelopeSchema.safeParse(value);
  if (!parsed.success) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_ENVELOPE_INVALID",
      "Bright Data healing returned an unexpected envelope.",
    );
  }
  if (parsed.data.collector_id !== env.BRIGHTDATA_COLLECTOR_ID) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_COLLECTOR_ID_CHANGED",
      "Bright Data returned a different collector identifier.",
    );
  }
  return parsed.data;
}

export async function requestBrightDataHealing(prompt: string) {
  const env = getServerEnv();
  return runBrightDataCli([
    "scraper",
    "heal",
    env.BRIGHTDATA_COLLECTOR_ID,
    prompt,
    "--url",
    env.SFMTA_SOURCE_URL,
    "--timeout",
    "600",
    "--json",
  ]);
}

export async function resolveBrightDataHealing(decision: "approve" | "reject") {
  const env = getServerEnv();
  const args = [
    "scraper",
    "approve",
    env.BRIGHTDATA_COLLECTOR_ID,
    "--url",
    env.SFMTA_SOURCE_URL,
    "--timeout",
    "600",
    "--json",
  ];
  if (decision === "approve") args.push("--auto-save");
  if (decision === "reject") args.push("--reject");
  return runBrightDataCli(args);
}
