import path from "node:path";

import { brightDataHealEnvelopeSchema } from "@/domain/incidents/contract";
import { getServerEnv } from "@/lib/env";

const CLI_TIMEOUT_MS = 11 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/**
 * True only when the envelope's collector id matches the env-configured
 * PulseRank collector exactly (disposition RETAIN_AND_REFACTOR: the healing
 * plumbing is reused with the NEW collector identity; the retired UNBROKEN
 * collector must never be invoked or accepted).
 */
export function hasStableProductionCollectorId(
  value: unknown,
  configuredCollectorId = getServerEnv().BRIGHTDATA_COLLECTOR_ID,
) {
  return (
    typeof value === "string" &&
    configuredCollectorId === getServerEnv().BRIGHTDATA_COLLECTOR_ID &&
    value === configuredCollectorId
  );
}

export class HealingIntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HealingIntegrationError";
  }
}

async function readBoundedText(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new HealingIntegrationError(
          "BRIGHT_DATA_HEAL_OUTPUT_TOO_LARGE",
          "Bright Data healing returned more evidence than the safety limit allows.",
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

async function runBrightDataCli(args: string[]) {
  const env = getServerEnv();
  const cliEntry = path.resolve("node_modules/@brightdata/cli/dist/index.js");
  const subprocess = Bun.spawn([process.execPath, cliEntry, ...args], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
      HOME: "/tmp",
      TMPDIR: "/tmp",
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
  const output = Promise.all([
    subprocess.exited,
    readBoundedText(subprocess.stdout, MAX_OUTPUT_BYTES),
    readBoundedText(subprocess.stderr, MAX_OUTPUT_BYTES),
  ]);
  let exitCode: number;
  let stdout: string;
  try {
    [exitCode, stdout] = await output;
  } catch (error) {
    subprocess.kill();
    await Promise.allSettled([output, subprocess.exited]);
    if (error instanceof HealingIntegrationError) throw error;
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_CLI_FAILED",
      "Bright Data healing could not be read safely. The existing production collector was left unchanged.",
    );
  } finally {
    clearTimeout(timeout);
  }

  if (timedOut) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_TIMEOUT",
      "Bright Data healing did not finish before the bounded deadline.",
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
  if (!hasStableProductionCollectorId(parsed.data.collector_id, env.BRIGHTDATA_COLLECTOR_ID)) {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_COLLECTOR_ID_CHANGED",
      "Bright Data returned a different collector identifier.",
    );
  }
  return parsed.data;
}
export async function requestBrightDataHealing(prompt: string, sourceUrl: string) {
  const env = getServerEnv();
  return runBrightDataCli([
    "scraper",
    "heal",
    env.BRIGHTDATA_COLLECTOR_ID,
    prompt,
    "--url",
    sourceUrl,
    "--timeout",
    "600",
    "--json",
  ]);
}

export async function resolveBrightDataHealing(decision: "approve" | "reject", sourceUrl: string) {
  const env = getServerEnv();
  const args = [
    "scraper",
    "approve",
    env.BRIGHTDATA_COLLECTOR_ID,
    "--url",
    sourceUrl,
    "--timeout",
    "600",
    "--json",
  ];
  if (decision === "approve") args.push("--auto-save");
  if (decision === "reject") args.push("--reject");
  return runBrightDataCli(args);
}
