import { describe, expect, it } from "vitest";

import { parsePulseOperatorCommand } from "@/server/ingestion/operator-command";

describe("PulseRank operator command parser", () => {
  it("parses the reference export dry-run without enabling another mode", () => {
    expect(
      parsePulseOperatorCommand([
        "--from-export",
        "artifacts/incidents/recovery/export.json",
        "--dry-run",
      ]),
    ).toEqual({
      kind: "export",
      path: "artifacts/incidents/recovery/export.json",
      dryRun: true,
    });
  });

  it("parses an explicit provider resume", () => {
    expect(parsePulseOperatorCommand(["--resume-run", "run-123"])).toEqual({
      kind: "resume",
      runId: "run-123",
    });
  });

  it("rejects auto approval and ambiguous recovery commands", () => {
    expect(() => parsePulseOperatorCommand(["--auto-approve"])).toThrow(
      /permanently disabled/i,
    );
    expect(() =>
      parsePulseOperatorCommand([
        "--from-export",
        "export.json",
        "--resume-run",
        "run-123",
      ]),
    ).toThrow(/mutually exclusive/i);
    expect(() => parsePulseOperatorCommand(["--dry-run"])).toThrow(
      /only valid with --from-export/i,
    );
  });
});
