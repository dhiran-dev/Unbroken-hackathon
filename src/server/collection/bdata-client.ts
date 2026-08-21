/**
 * Thin Bright Data CLI client for PulseRank collection jobs (Agent A7b).
 *
 * Spawns the pinned `@brightdata/cli` entrypoint
 * (`node_modules/@brightdata/cli/dist/index.js`) exactly like the established
 * bright-data-healing service, with the same env mapping
 * (BRIGHTDATA_API_TOKEN -> BRIGHTDATA_API_KEY) and a hard wall-clock timeout.
 * Output is parsed as a JSON array of rows (a bare object is wrapped so a
 * single-row collector still yields an array).
 *
 * CLI shapes (verified against @brightdata/cli 0.3.2 dist):
 * - sample:    `scraper run <collector_id> [url] [--input-file <path>] --json`
 * - discovery: `discover <query> --json` — discover has NO --input-file
 *              option, so an input file is resolved locally to its first URL
 *              (one per line, or a JSON array of strings / {"url": ...}).
 *
 * Safety properties:
 * - No network access and no env reads happen unless the caller invokes
 *   `collectViaBdata`; importing this module has zero side effects.
 * - stdout/stderr are byte-capped; the child process is killed on timeout or
 *   cap overrun.
 * - Failures surface as typed `BdataClientError`s with stable error codes —
 *   never console-only errors.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_SAMPLE_TIMEOUT_MS = 4 * 60 * 1_000 + 30_000; // mirrors DCA deadline
const DEFAULT_DISCOVERY_TIMEOUT_MS = 10 * 60 * 1_000;
const MAX_OUTPUT_BYTES = 5 * 1024 * 1024;

/** Stable failure codes surfaced in job results and incident reports. */
export type BdataClientErrorCode =
  | "BDATA_CLI_ENTRYPOINT_MISSING"
  | "BDATA_TIMEOUT"
  | "BDATA_CLI_FAILED"
  | "BDATA_OUTPUT_TOO_LARGE"
  | "BDATA_NON_JSON_OUTPUT"
  | "BDATA_EMPTY_OUTPUT"
  | "BDATA_ENV_UNCONFIGURED"
  | "BDATA_INPUT_FILE_UNREADABLE"
  | "BDATA_DISCOVERY_QUERY_MISSING";

export class BdataClientError extends Error {
  constructor(
    public readonly code: BdataClientErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BdataClientError";
  }
}

export type BdataCollectMode = "sample" | "discovery";

export type BdataCollectInput = {
  mode: BdataCollectMode;
  /** Target page URL. For `sample` it is scraped; for `discovery` it is the query. */
  url?: string | undefined;
  /**
   * Local file of URLs. For `sample` it is passed to `--input-file` as-is
   * (one per line, or a JSON array of strings / {"url": ...} objects — the
   * CLI parses it). For `discovery` the client resolves the file locally to
   * its FIRST usable URL, because `discover` has no --input-file option.
   */
  inputFile?: string | undefined;
  timeoutMs?: number | undefined;
};

export type BdataCollectOutput = {
  /** Parsed JSON array output of the CLI run. */
  rows: unknown[];
  /** Deterministic fingerprint over the canonical raw output. */
  fingerprint: string;
};

export type BdataRunnerCommand = {
  /**
   * Full spawn argv: `[nodeRuntime, cliEntrypoint, ...cliArgs]` — literally
   * `node node_modules/@brightdata/cli/dist/index.js <args>` (the runtime is
   * `process.execPath`, matching the healing service's invocation style).
   */
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
};

/**
 * Injectable runner seam: unit tests substitute this to capture argv/env and
 * return canned output, so no test ever spawns the real CLI (or any process).
 */
export type BdataCliRunner = (
  command: BdataRunnerCommand,
) => Promise<{ stdout: string; exitCode: number }>;

function defaultRunner(command: BdataRunnerCommand): Promise<{
  stdout: string;
  exitCode: number;
}> {
  const [runtime = "", entrypoint = "", ...cliArgs] = command.argv;
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      // The runner-command env is a plain string map by contract; Node's
      // ProcessEnv carries an ambient NODE_ENV augmentation, so the cast is
      // purely nominal — the map IS the child environment.
      child = spawn(runtime, [entrypoint, ...cliArgs], {
        cwd: process.cwd(),
        env: command.env as NodeJS.ProcessEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      reject(
        new BdataClientError(
          "BDATA_CLI_ENTRYPOINT_MISSING",
          `Could not launch the Bright Data CLI (${error instanceof Error ? error.message : "unknown error"}).`,
        ),
      );
      return;
    }

    let timedOut = false;
    let settled = false;
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, command.timeoutMs);

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_OUTPUT_BYTES) {
        child.kill();
        fail(
          new BdataClientError(
            "BDATA_OUTPUT_TOO_LARGE",
            "Bright Data CLI produced more output than the safety limit allows.",
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    // stderr must be drained so a chatty child cannot deadlock on a full pipe.
    child.stderr?.on("data", () => {});

    child.on("error", (error) => {
      fail(
        new BdataClientError(
          "BDATA_CLI_ENTRYPOINT_MISSING",
          `Could not launch the Bright Data CLI (${error instanceof Error ? error.message : "unknown error"}).`,
        ),
      );
    });
    child.on("close", () => {
      if (timedOut) {
        fail(
          new BdataClientError(
            "BDATA_TIMEOUT",
            "Bright Data collection did not finish before its bounded deadline.",
          ),
        );
        return;
      }
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: Buffer.concat(chunks).toString("utf8"),
        exitCode: child.exitCode ?? -1,
      });
    });
  });
}

/** Lazy env resolution keeps this module import-safe without configuration. */
async function brightDataEnv(): Promise<{
  BRIGHTDATA_API_TOKEN: string;
  BRIGHTDATA_COLLECTOR_ID: string;
}> {
  try {
    const { getServerEnv } = await import("@/lib/env");
    return getServerEnv();
  } catch {
    throw new BdataClientError(
      "BDATA_ENV_UNCONFIGURED",
      "Bright Data credentials are not configured; live collection is unavailable.",
    );
  }
}

function buildEnvironment(token: string): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: "/tmp",
    TMPDIR: "/tmp",
    BRIGHTDATA_API_KEY: token,
    NO_COLOR: "1",
    NODE_ENV: process.env.NODE_ENV ?? "production",
  };
}

function cliEntrypoint(): string {
  return path.resolve("node_modules/@brightdata/cli/dist/index.js");
}

/**
 * Runtime used to execute the CLI. Under the bun worker `process.execPath` is
 * bun (same behavior as the healing service); under node it is node — either
 * way the CommonJS CLI entrypoint runs on a node-compatible runtime.
 */
function nodeBinary(): string {
  return process.execPath;
}

/** Deterministic sha256-style fingerprint for persisted raw output. */
export function rawOutputFingerprint(value: unknown): string {
  const serialized = JSON.stringify(value, (_key, val) =>
    val === undefined ? null : val,
  );
  const hex = createHash("sha256").update(serialized).digest("hex");
  return `sha256:${hex}`;
}

function parseRows(stdout: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new BdataClientError(
      "BDATA_NON_JSON_OUTPUT",
      "Bright Data CLI did not return valid JSON output.",
    );
  }
  if (Array.isArray(parsed)) {
    if (parsed.length === 0) {
      throw new BdataClientError(
        "BDATA_EMPTY_OUTPUT",
        "Bright Data CLI returned an empty row set.",
      );
    }
    return parsed;
  }
  if (parsed !== null && typeof parsed === "object") {
    return [parsed];
  }
  throw new BdataClientError(
    "BDATA_NON_JSON_OUTPUT",
    "Bright Data CLI returned neither a JSON array nor a JSON object.",
  );
}

function sampleArgv(input: BdataCollectInput, collectorId: string): string[] {
  // `node <cli> scraper run <collector_id> [url] --input-file <path> --json`
  const argv = [nodeBinary(), cliEntrypoint(), "scraper", "run", collectorId];
  if (input.inputFile !== undefined) {
    argv.push("--input-file", input.inputFile);
  } else if (input.url !== undefined) {
    argv.push(input.url);
  }
  argv.push("--json");
  return argv;
}

/**
 * Resolve the `<query>` positional for `discover`. An explicit `url` wins;
 * otherwise the first usable URL in `inputFile` is used (one URL per line
 * with `#` comments skipped, or a JSON array of strings / {"url": ...}
 * objects) — the discover subcommand has no --input-file option.
 */
function resolveDiscoveryQuery(input: BdataCollectInput): string {
  const explicit = input.url?.trim();
  if (explicit !== undefined && explicit !== "") return explicit;

  if (input.inputFile === undefined) {
    throw new BdataClientError(
      "BDATA_DISCOVERY_QUERY_MISSING",
      "Discovery needs a query URL or an input file of URLs.",
    );
  }

  let raw: string;
  try {
    raw = readFileSync(input.inputFile, "utf8");
  } catch (error) {
    throw new BdataClientError(
      "BDATA_INPUT_FILE_UNREADABLE",
      `Could not read the discovery input file (${error instanceof Error ? error.message : "unknown error"}).`,
    );
  }

  const trimmed = raw.trim();
  if (trimmed === "") {
    throw new BdataClientError(
      "BDATA_DISCOVERY_QUERY_MISSING",
      "The discovery input file is empty.",
    );
  }

  if (trimmed.startsWith("[")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new BdataClientError(
        "BDATA_INPUT_FILE_UNREADABLE",
        "The discovery input file looks like JSON but failed to parse.",
      );
    }
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (typeof item === "string" && item.trim() !== "") return item.trim();
        if (item !== null && typeof item === "object") {
          const url = (item as { url?: unknown }).url;
          if (typeof url === "string" && url.trim() !== "") return url.trim();
        }
      }
    }
    throw new BdataClientError(
      "BDATA_DISCOVERY_QUERY_MISSING",
      "The discovery input file contains no usable URL.",
    );
  }

  for (const line of trimmed.split(/\r?\n/)) {
    const candidate = line.trim();
    if (candidate !== "" && !candidate.startsWith("#")) return candidate;
  }
  throw new BdataClientError(
    "BDATA_DISCOVERY_QUERY_MISSING",
    "The discovery input file contains no usable URL.",
  );
}

function discoveryArgv(input: BdataCollectInput): string[] {
  // `node <cli> discover <query> --json`
  return [
    nodeBinary(),
    cliEntrypoint(),
    "discover",
    resolveDiscoveryQuery(input),
    "--json",
  ];
}

/**
 * Run one bounded Bright Data CLI collection and parse its JSON-array output.
 * Never touches the database — persistence is the handler's transactional job,
 * which runs only after this call succeeds.
 */
export async function collectViaBdata(
  input: BdataCollectInput,
  runner: BdataCliRunner = defaultRunner,
): Promise<BdataCollectOutput> {
  const timeoutMs =
    input.timeoutMs ??
    (input.mode === "discovery"
      ? DEFAULT_DISCOVERY_TIMEOUT_MS
      : DEFAULT_SAMPLE_TIMEOUT_MS);

  const env = await brightDataEnv();
  const argv =
    input.mode === "discovery" ? discoveryArgv(input) : sampleArgv(input, env.BRIGHTDATA_COLLECTOR_ID);

  let cliOutput: { stdout: string; exitCode: number };
  try {
    cliOutput = await runner({ argv, env: buildEnvironment(env.BRIGHTDATA_API_TOKEN), timeoutMs });
  } catch (error) {
    throw error instanceof BdataClientError
      ? error
      : new BdataClientError(
          "BDATA_CLI_FAILED",
          `Bright Data CLI transport failed: ${error instanceof Error ? error.message : "unknown"}`,
        );
  }

  if (cliOutput.exitCode !== 0) {
    throw new BdataClientError(
      "BDATA_CLI_FAILED",
      `Bright Data CLI exited with code ${cliOutput.exitCode}.`,
    );
  }

  const rows = parseRows(cliOutput.stdout);
  return { rows, fingerprint: rawOutputFingerprint(rows) };
}

/** Exposed for tests and handler reporting. */
export const BDATA_DEFAULT_TIMEOUTS_MS = Object.freeze({
  sample: DEFAULT_SAMPLE_TIMEOUT_MS,
  discovery: DEFAULT_DISCOVERY_TIMEOUT_MS,
});
