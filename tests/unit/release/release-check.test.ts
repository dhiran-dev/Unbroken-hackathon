/**
 * Unit tests for the PulseRank release compliance gate (Agent A13a).
 *
 * Every check runs against throwaway temp-dir trees so the gate's pure
 * functions are exercised on both violating and clean fixtures without
 * touching the real repository.
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkBackupArtifacts,
  checkContracts,
  checkDatabaseSchemas,
  checkFlags,
  checkPackageMetadata,
  runReleaseChecks,
  scanLegacyReferences,
  LEGACY_COLLECTOR_ID,
} from "../../../scripts/release-check";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "release-check-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(relativePath: string, body: string): Promise<void> {
  const absolute = path.join(root, relativePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, body, "utf8");
}

const CLEAN_FLAGS_MODULE = `
const TRUTHY = new Set(["true", "1"]);

function readServerFlag(name: string): boolean {
  return TRUTHY.has((process.env[name] ?? "").trim().toLowerCase());
}

function readPublicFlag(value: string | undefined): boolean {
  return TRUTHY.has((value ?? "").trim().toLowerCase());
}

const globalThreeEnabled = readPublicFlag(
  process.env.NEXT_PUBLIC_PULSERANK_3D_ENABLED,
);

export const pulserankFlags = Object.freeze({
  server: Object.freeze({
    appEnabled: readServerFlag("PULSERANK_APP_ENABLED"),
    collectionEnabled: readServerFlag("PULSERANK_COLLECTION_ENABLED"),
  }),
  threeDimensional: Object.freeze({
    enabled: globalThreeEnabled,
    home: globalThreeEnabled && readPublicFlag(process.env.NEXT_PUBLIC_PULSERANK_3D_HOME),
  }),
});
`;

const CLEAN_SCHEMA_MODULE = `
import { z } from "zod";

export const fieldStateSchema = z.enum(["observed", "estimated", "missing"]);

export const productScrapeRowV1Schema = z.object({
  schemaVersion: z.literal("1.0"),
  source: z.object({ url: z.string() }),
  identity: z.object({ name: z.string() }),
  primary: z.object({ caffeineMg: z.number() }),
});
`;

const STANDARD_FULL_FIXTURE = JSON.stringify({
  schemaVersion: "1.0",
  source: { url: "https://example.com/product" },
  identity: { name: "Example Product" },
  primary: { caffeineMg: 80 },
});

async function writeCleanContracts(): Promise<void> {
  await write(
    "src/domain/product/contracts/product-scrape-row.schema.ts",
    CLEAN_SCHEMA_MODULE,
  );
  await write(
    "src/domain/product/contracts/product-scrape-row.ts",
    'export type ProductScrapeRowV1 = { schemaVersion: "1.0" };\n',
  );
  await write(
    "src/domain/product/contracts/field-states.ts",
    'export type FieldState = "observed" | "estimated";\n',
  );
  await write(
    "src/domain/product/contracts/observations.ts",
    "export type NumberObservation = { value: number };\n" +
      "export type ServingObservation = { unit: string };\n",
  );
  await write("src/domain/product/fixtures/standard-full.json", STANDARD_FULL_FIXTURE);
}

describe("scanLegacyReferences", () => {
  it("passes on a clean tree", async () => {
    await write("src/domain/product/index.ts", "export const ready = true;\n");
    const check = await scanLegacyReferences(root);
    expect(check.status).toBe("pass");
    expect(check.findings).toHaveLength(0);
  });

  it("fails on a prohibited SFMTA source URL in src/", async () => {
    await write(
      "src/lib/env.ts",
      'export const SOURCE = "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod";\n',
    );
    const check = await scanLegacyReferences(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.file).toBe("src/lib/env.ts");
    expect(check.findings[0]?.message).toContain("SFMTA");
  });

  it("fails on a GTFS refresh invocation in scripts/", async () => {
    await write("scripts/nightly.ts", 'await import("./refresh-gtfs");\n');
    const check = await scanLegacyReferences(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("GTFS refresh");
  });

  it("fails on the legacy collector ID outside allowed paths", async () => {
    await write(
      ".github/workflows/ci.yml",
      `BRIGHTDATA_COLLECTOR_ID: ${LEGACY_COLLECTOR_ID}\n`,
    );
    const check = await scanLegacyReferences(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("legacy collector ID");
  });

  it("fails on prohibited references under deploy/", async () => {
    await write("deploy/runbook.md", "Point the collector at sfmta.com for status.\n");
    const check = await scanLegacyReferences(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.file).toBe("deploy/runbook.md");
  });

  it("excludes the checker itself so its detection patterns never self-trip", async () => {
    await write(
      "scripts/release-check.ts",
      `const legacy = "${LEGACY_COLLECTOR_ID}"; // pattern source\n`,
    );
    const check = await scanLegacyReferences(root);
    expect(check.status).toBe("pass");
  });

  it("honors additional exclusions passed by the caller", async () => {
    await write("src/generated/legacy-map.ts", `export const id = "${LEGACY_COLLECTOR_ID}";\n`);
    const failing = await scanLegacyReferences(root);
    expect(failing.status).toBe("fail");
    const passing = await scanLegacyReferences(root, {
      exclude: ["src/generated/legacy-map.ts"],
    });
    expect(passing.status).toBe("pass");
  });
});

describe("checkFlags", () => {
  it("passes when every flag defaults to false", async () => {
    await write("src/config/pulserank-flags.ts", CLEAN_FLAGS_MODULE);
    const check = await checkFlags(root);
    expect(check.status).toBe("pass");
  });

  it("fails when the flags module is missing", async () => {
    const check = await checkFlags(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("missing");
  });

  it("fails when a flag is hardcoded true", async () => {
    await write(
      "src/config/pulserank-flags.ts",
      CLEAN_FLAGS_MODULE.replace(
        'collectionEnabled: readServerFlag("PULSERANK_COLLECTION_ENABLED"),',
        "collectionEnabled: true,",
      ),
    );
    const check = await checkFlags(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("collectionEnabled");
  });

  it("fails when a safe reader is negated", async () => {
    await write(
      "src/config/pulserank-flags.ts",
      CLEAN_FLAGS_MODULE.replace(
        "enabled: globalThreeEnabled,",
        "enabled: !globalThreeEnabled,",
      ),
    );
    const check = await checkFlags(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("enabled");
  });

  it("fails when a flag is bound to an arbitrary expression", async () => {
    await write(
      "src/config/pulserank-flags.ts",
      CLEAN_FLAGS_MODULE.replace(
        "enabled: globalThreeEnabled,",
        'enabled: process.env.PULSERANK_3D === "yes",',
      ),
    );
    const check = await checkFlags(root);
    expect(check.status).toBe("fail");
  });
});

describe("checkContracts", () => {
  it("passes on exports plus a golden fixture matching the declared schema", async () => {
    await writeCleanContracts();
    const check = await checkContracts(root);
    expect(check.status).toBe("pass");
  });

  it("fails when a required contract module is missing", async () => {
    await writeCleanContracts();
    await rm(path.join(root, "src/domain/product/contracts/field-states.ts"));
    const check = await checkContracts(root);
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.message.includes("field-states.ts"))).toBe(true);
  });

  it("fails when a required export is absent", async () => {
    await writeCleanContracts();
    await write(
      "src/domain/product/contracts/observations.ts",
      "export type NumberObservation = { value: number };\n",
    );
    const check = await checkContracts(root);
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.message.includes("ServingObservation"))).toBe(true);
  });

  it("fails when the golden fixture lacks a declared schema section", async () => {
    await writeCleanContracts();
    await write(
      "src/domain/product/fixtures/standard-full.json",
      JSON.stringify({ schemaVersion: "1.0", source: {}, identity: {} }),
    );
    const check = await checkContracts(root);
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.message.includes('"primary"'))).toBe(true);
  });

  it("fails when the golden fixture is not valid JSON", async () => {
    await writeCleanContracts();
    await write("src/domain/product/fixtures/standard-full.json", "{ not json");
    const check = await checkContracts(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("valid JSON");
  });

  it("fails when the golden fixture is missing", async () => {
    await writeCleanContracts();
    await rm(path.join(root, "src/domain/product/fixtures/standard-full.json"));
    const check = await checkContracts(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("standard-full.json");
  });
});

describe("checkDatabaseSchemas", () => {
  it("passes with the pulse schema and existing public app tables", async () => {
    await write(
      "src/server/db/schema/pulse.ts",
      'import { pgSchema, pgTable, text } from "drizzle-orm/pg-core";\n' +
        'export const pulse = pgSchema("pulse");\n' +
        'export const pulseSources = pulse.table("sources", { slug: text("slug") });\n',
    );
    await write(
      "src/server/db/schema/core.ts",
      'import { pgTable } from "drizzle-orm/pg-core";\n' +
        'export const stations = pgTable("stations", {});\n',
    );
    const check = await checkDatabaseSchemas(root);
    expect(check.status).toBe("pass");
  });

  it("fails when a new pgSchema namespace is declared", async () => {
    await write(
      "src/server/db/schema/rogue.ts",
      'import { pgSchema } from "drizzle-orm/pg-core";\n' +
        'export const rogue = pgSchema("rogue_legacy");\n' +
        'export const rogueTable = rogue.table("junk", {});\n',
    );
    const check = await checkDatabaseSchemas(root);
    expect(check.status).toBe("fail");
    expect(check.findings.some((f) => f.message.includes("rogue_legacy"))).toBe(true);
  });

  it("fails when a table is bound to an undeclared schema variable", async () => {
    await write(
      "src/server/db/schema/mystery.ts",
      'import { pgSchema } from "drizzle-orm/pg-core";\n' +
        "import { other } from \"./elsewhere\";\n" +
        'export const mysteryTable = other.table("things", {});\n',
    );
    const check = await checkDatabaseSchemas(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("undeclared schema variable");
  });

  it("fails on dotted schema-qualified table names outside the known set", async () => {
    await write(
      "src/server/db/schema/dotted.ts",
      'import { pgTable } from "drizzle-orm/pg-core";\n' +
        'export const legacyRow = pgTable("legacy_extra.rows", {});\n',
    );
    const check = await checkDatabaseSchemas(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("legacy_extra");
  });

  it("fails when the schema directory is missing", async () => {
    const check = await checkDatabaseSchemas(root);
    expect(check.status).toBe("fail");
    expect(check.findings[0]?.message).toContain("missing or empty");
  });
});

describe("checkPackageMetadata", () => {
  it("passes when package.json does not mention pulserank", async () => {
    await write("package.json", JSON.stringify({ name: "unbroken" }));
    const check = await checkPackageMetadata(root);
    expect(check.status).toBe("pass");
  });

  it("warns (not fails) when the package name mentions pulserank", async () => {
    await write("package.json", JSON.stringify({ name: "pulserank-app" }));
    const check = await checkPackageMetadata(root);
    expect(check.status).toBe("warn");
    expect(check.findings[0]?.message).toContain("pulserank-app");
  });

  it("warns when package.json is missing", async () => {
    const check = await checkPackageMetadata(root);
    expect(check.status).toBe("warn");
  });
});

describe("checkBackupArtifacts", () => {
  it("passes when the referenced backup exists on disk", async () => {
    await write(
      "docs/coordination/state.yaml",
      "db_backup: backups/unbroken-before-pulserank-20260821-1808.dump\n",
    );
    await write("backups/unbroken-before-pulserank-20260821-1808.dump", "PGDMP");
    const check = await checkBackupArtifacts(root);
    expect(check.status).toBe("pass");
  });

  it("warns when the referenced backup is missing", async () => {
    await write(
      "docs/coordination/state.yaml",
      "db_backup: backups/unbroken-before-pulserank-20260821-1808.dump\n",
    );
    const check = await checkBackupArtifacts(root);
    expect(check.status).toBe("warn");
    expect(check.findings[0]?.message).toContain("missing on disk");
  });

  it("passes when state.yaml references no backup", async () => {
    await write("docs/coordination/state.yaml", "project: pulserank\n");
    const check = await checkBackupArtifacts(root);
    expect(check.status).toBe("pass");
  });
});

describe("runReleaseChecks", () => {
  it("aggregates every check and fails when any check fails", async () => {
    await write("src/lib/env.ts", `export const ID = "${LEGACY_COLLECTOR_ID}";\n`);
    await write("package.json", JSON.stringify({ name: "pulserank-app" }));
    const report = await runReleaseChecks(root);
    expect(report.results.map((r) => r.id)).toEqual([
      "legacy-runtime-references",
      "pulserank-flags",
      "product-contracts",
      "db-schema-boundary",
      "package-metadata",
      "backup-artifact",
    ]);
    expect(report.ok).toBe(false);
    const legacy = report.results.find((r) => r.id === "legacy-runtime-references");
    expect(legacy?.status).toBe("fail");
  });

  it("stays ok when only warnings fire", async () => {
    await write("src/config/pulserank-flags.ts", CLEAN_FLAGS_MODULE);
    await writeCleanContracts();
    await write(
      "src/server/db/schema/pulse.ts",
      'import { pgSchema } from "drizzle-orm/pg-core";\n' +
        'export const pulse = pgSchema("pulse");\n',
    );
    await write("package.json", JSON.stringify({ name: "pulserank-app" }));
    await write(
      "docs/coordination/state.yaml",
      "db_backup: backups/unbroken-before-pulserank-20260821-1808.dump\n",
    );
    const report = await runReleaseChecks(root);
    expect(report.ok).toBe(true);
    expect(report.results.filter((r) => r.status === "warn").length).toBeGreaterThan(0);
  });
});
