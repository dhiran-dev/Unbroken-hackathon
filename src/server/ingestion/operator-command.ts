export type PulseOperatorCommand =
  | { kind: "export"; path: string; dryRun: boolean }
  | { kind: "resume"; runId: string }
  | {
      kind: "collect";
      mode: "discovery" | "sample";
      url: string | null;
      inputFile: string | null;
      timeoutMs: number | undefined;
    };

const VALUE_FLAGS = new Set([
  "--from-export",
  "--resume-run",
  "--mode",
  "--url",
  "--input-file",
  "--timeout-ms",
]);
const BOOLEAN_FLAGS = new Set(["--dry-run", "--auto-approve"]);

function option(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  if (index < 0) return null;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--") || value.trim() === "") {
    throw new Error(`${name} requires a value`);
  }
  return value.trim();
}

function validateArguments(args: readonly string[]): void {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index] ?? "";
    if (BOOLEAN_FLAGS.has(argument)) continue;
    if (VALUE_FLAGS.has(argument)) {
      index += 1;
      if (args[index] === undefined || args[index]?.startsWith("--")) {
        throw new Error(`${argument} requires a value`);
      }
      continue;
    }
    throw new Error(`unsupported operator argument: ${argument}`);
  }
}

export function parsePulseOperatorCommand(
  args: readonly string[],
): PulseOperatorCommand {
  validateArguments(args);
  if (args.includes("--auto-approve")) {
    throw new Error("--auto-approve is permanently disabled for PulseRank runs");
  }

  const exportPath = option(args, "--from-export");
  const resumeRunId = option(args, "--resume-run");
  if (exportPath !== null && resumeRunId !== null) {
    throw new Error("--from-export and --resume-run are mutually exclusive");
  }
  const dryRun = args.includes("--dry-run");
  if (dryRun && exportPath === null) {
    throw new Error("--dry-run is only valid with --from-export");
  }

  const liveOptions = ["--mode", "--url", "--input-file", "--timeout-ms"];
  if (
    (exportPath !== null || resumeRunId !== null) &&
    liveOptions.some((flag) => args.includes(flag))
  ) {
    throw new Error("recovery commands cannot be combined with live collection options");
  }
  if (exportPath !== null) return { kind: "export", path: exportPath, dryRun };
  if (resumeRunId !== null) return { kind: "resume", runId: resumeRunId };

  const rawMode = option(args, "--mode") ?? "discovery";
  if (rawMode !== "discovery" && rawMode !== "sample") {
    throw new Error("--mode must be discovery or sample");
  }
  const rawTimeout = option(args, "--timeout-ms");
  const timeoutMs = rawTimeout === null ? undefined : Number(rawTimeout);
  if (
    timeoutMs !== undefined &&
    (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60 * 60_000)
  ) {
    throw new Error("--timeout-ms must be an integer from 1 to 3600000");
  }
  return {
    kind: "collect",
    mode: rawMode,
    url: option(args, "--url"),
    inputFile: option(args, "--input-file"),
    timeoutMs,
  };
}
