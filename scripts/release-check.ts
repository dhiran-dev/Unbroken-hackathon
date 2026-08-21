/**
 * PulseRank release compliance gate (Agent A13a).
 *
 * Fast, deterministic, offline: static analysis + filesystem only. No network,
 * no database, no dependency imports beyond node builtins so it can run against
 * any checkout (including bare temp-dir fixtures in tests).
 *
 * Checks (fail => exit 1):
 *   1. legacy-runtime-references — prohibited SFMTA URLs, GTFS refresh
 *      invocations, and the legacy Bright Data collector ID anywhere under
 *      src/, scripts/, .github/, deploy/. Allowed homes for legacy identity
 *      are documentation paths (docs/, AGENTS.md, migration history), which
 *      are outside the scanned roots by construction.
 *   2. pulserank-flags — src/config/pulserank-flags.ts exists and every flag
 *      binding provably defaults to false.
 *   3. product-contracts — src/domain/product/contracts exports exist and the
 *      fixture src/domain/product/fixtures/standard-full.json carries every
 *      top-level section the V1 scrape-row schema declares.
 *   4. db-schema-boundary — no file under src/server/db/schema defines tables
 *      outside the known PostgreSQL schemas ("public" app schemas + "pulse").
 *
 * Warnings (reported, never fail the gate):
 *   5. package-metadata — package.json metadata mentioning "pulserank".
 *   6. backup-artifact — the pre-rebuild dump referenced by
 *      docs/coordination/state.yaml is missing on disk.
 *
 * CLI: bun scripts/release-check.ts  (prints report, exits 0/1)
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CheckStatus = "pass" | "warn" | "fail";

export interface Finding {
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}

export interface CheckResult {
  readonly id: string;
  readonly title: string;
  readonly status: CheckStatus;
  readonly findings: readonly Finding[];
}

export interface ReleaseReport {
  readonly root: string;
  readonly results: readonly CheckResult[];
  /** True when no check has status "fail" (warnings are tolerated). */
  readonly ok: boolean;
}

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Legacy UNBROKEN collector: audit identity only, never invoke (AGENTS.md). */
export const LEGACY_COLLECTOR_ID = "c_msyjsllt1r9ej5tdub";

/** The only Bright Data collector permitted in PulseRank runtime code. */
export const PULSERANK_COLLECTOR_ID = "c_mt33nlnkq376z132b";

/** Prohibited Bright Data target (AGENTS.md government-source compliance). */
const SFMTA_URL_PATTERN = /sfmta\.com/i;

/** GTFS refresh entry points: script names, module names, npm script refs. */
const GTFS_REFRESH_PATTERN =
  /(?:refresh[-_ ]?gtfs|gtfs[-_ ]?refresh|transit\s*:\s*refresh)/i;

/** Runtime surfaces scanned for prohibited legacy references. */
const SCAN_ROOTS = ["src", "scripts", ".github", "deploy"] as const;

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".sh",
  ".toml",
  ".css",
]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".turbo"]);
const MAX_SCAN_BYTES = 2_000_000;

interface ScanOptions {
  /** Repo-relative paths excluded from the legacy-reference scan. */
  readonly exclude?: readonly string[];
}

// ---------------------------------------------------------------------------
// Filesystem helpers (pure with respect to the given root)
// ---------------------------------------------------------------------------

async function listTextFiles(
  root: string,
  relativeDir: string,
  exclude: ReadonlySet<string>,
): Promise<string[]> {
  const absoluteDir = path.join(root, relativeDir);
  let entries;
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return [];
  }

  const found: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const childRelative = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      found.push(
        ...(await listTextFiles(root, childRelative, exclude)),
      );
      continue;
    }
    if (!entry.isFile()) continue;
    if (exclude.has(childRelative)) continue;
    if (
      !TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) &&
      path.extname(entry.name) !== ""
    ) {
      continue;
    }
    found.push(childRelative);
  }
  return found;
}

async function readTextFile(
  root: string,
  relativePath: string,
): Promise<string | null> {
  const absolute = path.join(root, relativePath);
  try {
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_SCAN_BYTES) return null;
    const body = await readFile(absolute, "utf8");
    // Cheap binary guard: NUL bytes mean this is not reviewable text.
    if (body.includes("\0")) return null;
    return body;
  } catch {
    return null;
  }
}

function lineNumberAt(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) {
    if (text[i] === "\n") line += 1;
  }
  return line;
}

function result(
  id: string,
  title: string,
  status: CheckStatus,
  findings: readonly Finding[],
): CheckResult {
  return { id, title, status, findings };
}

// ---------------------------------------------------------------------------
// Check 1 — prohibited legacy runtime references
// ---------------------------------------------------------------------------

/**
 * Scans src/, scripts/, .github/ and deploy/ for prohibited legacy runtime
 * references: SFMTA source URLs, GTFS refresh invocations, and the legacy
 * collector ID. Any hit is a failure; legacy identity belongs only in
 * documentation paths (docs/, AGENTS.md, migration history), which sit
 * outside these roots. The checker excludes itself so its own detection
 * patterns never trip the gate.
 */
export async function scanLegacyReferences(
  root: string,
  options: ScanOptions = {},
): Promise<CheckResult> {
  const id = "legacy-runtime-references";
  const title = "No prohibited legacy runtime references";
  const exclude = new Set([
    "scripts/release-check.ts", // self-exclusion: detection patterns live here
    // src/server/jobs/pulse-jobs.ts holds LEGACY_JOB_DENYLIST: the auditable,
    // fail-closed record of retired job names that must never run again. The
    // literal historical names (e.g. the GTFS refresh job) are the point of
    // that list; they are rejected, never invoked, so this audit surface is
    // excluded from the runtime-reference scan.
    "src/server/jobs/pulse-jobs.ts",
    ...(options.exclude ?? []),
  ]);

  const findings: Finding[] = [];
  for (const scanRoot of SCAN_ROOTS) {
    const files = await listTextFiles(root, scanRoot, exclude);
    for (const file of files) {
      const body = await readTextFile(root, file);
      if (body === null) continue;

      const record = (pattern: RegExp, category: string) => {
        const flags = pattern.flags.includes("g")
          ? pattern.flags
          : pattern.flags + "g";
        const global = new RegExp(pattern.source, flags);
        let match: RegExpExecArray | null;
        while ((match = global.exec(body)) !== null) {
          findings.push({
            file,
            line: lineNumberAt(body, match.index),
            message: `${category}: "${match[0]}"`,
          });
        }
      };

      record(SFMTA_URL_PATTERN, "prohibited SFMTA source URL");
      record(GTFS_REFRESH_PATTERN, "GTFS refresh invocation");
      record(new RegExp(LEGACY_COLLECTOR_ID, "g"), "legacy collector ID");
    }
  }

  findings.sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0),
  );
  return result(
    id,
    title,
    findings.length > 0 ? "fail" : "pass",
    findings,
  );
}

// ---------------------------------------------------------------------------
// Check 2 — PulseRank feature flags default to false
// ---------------------------------------------------------------------------

/**
 * Expressions that provably evaluate to false when no env is set: the flag
 * readers (TRUTHY-set lookups defaulting false) and identifiers initialized
 * from them. Anything else — bare `true`, negations, arbitrary expressions —
 * cannot be proven false-by-default and fails the check.
 */
function isFalseByDefault(expr: string, safeIdents: ReadonlySet<string>): boolean {
  const operands = expr
    .split(/&&|\|\|/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (operands.length === 0) return false;
  return operands.every((operand) => {
    if (operand === "false") return true;
    if (operand.startsWith("!")) return false;
    if (/^read(?:Server|Public)Flag\s*\(/.test(operand)) return true;
    if (/^[A-Za-z_$][\w$]*$/.test(operand)) return safeIdents.has(operand);
    return false;
  });
}

function collectSafeFlagIdentifiers(source: string): Set<string> {
  const safe = new Set<string>();
  const declaration =
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*read(?:Server|Public)Flag\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = declaration.exec(source)) !== null) {
    safe.add(match[1] as string);
  }
  return safe;
}

/** Finds the index just past the `}` closing the brace opened at `open`. */
function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    else if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

interface FlagBinding {
  readonly key: string;
  readonly expr: string;
}

/** Collects leaf `key: value` bindings inside an object-literal body. */
function collectFlagBindings(body: string): FlagBinding[] {
  const bindings: FlagBinding[] = [];
  const propertyPattern = /([A-Za-z_$][\w$]*)\s*:\s*/g;
  let match: RegExpExecArray | null;
  while ((match = propertyPattern.exec(body)) !== null) {
    const valueStart = match.index + match[0].length;
    const frozen = /^Object\.freeze\s*\(\s*\{/.exec(body.slice(valueStart));
    const opensObject = frozen !== null || body[valueStart] === "{";
    if (opensObject) {
      const braceOpen = valueStart + (frozen ? frozen[0].length - 1 : 0);
      const braceClose = matchingBrace(body, braceOpen);
      if (braceClose !== -1) {
        bindings.push(
          ...collectFlagBindings(body.slice(braceOpen + 1, braceClose)),
        );
        propertyPattern.lastIndex = braceClose + 1;
        continue;
      }
    }
    // Accumulate the value expression up to the terminating comma at depth 0.
    let depth = 0;
    let end = valueStart;
    while (end < body.length) {
      const char = body[end];
      if (char === "(" || char === "[" || char === "{") depth += 1;
      else if (char === ")" || char === "]" || char === "}") depth -= 1;
      else if (char === "," && depth === 0) break;
      end += 1;
    }
    bindings.push({
      key: match[1] as string,
      expr: body.slice(valueStart, end).trim(),
    });
    propertyPattern.lastIndex = end + 1;
  }
  return bindings;
}

/**
 * Verifies src/config/pulserank-flags.ts exists and every flag binding inside
 * the `pulserankFlags` initializer defaults to false (safe reader calls,
 * identifiers derived from them, or literal false).
 */
export async function checkFlags(root: string): Promise<CheckResult> {
  const id = "pulserank-flags";
  const title = "PulseRank flags exist and default to false";
  const relativePath = "src/config/pulserank-flags.ts";
  const source = await readTextFile(root, relativePath);

  if (source === null) {
    return result(id, title, "fail", [
      { file: relativePath, message: "required flags module is missing" },
    ]);
  }

  const anchor = /pulserankFlags\s*(?::[^=]+)?=/.exec(source);
  if (anchor === null) {
    return result(id, title, "fail", [
      { file: relativePath, message: "pulserankFlags export not found" },
    ]);
  }

  const objectOpen = source.indexOf("{", anchor.index);
  const objectClose = matchingBrace(source, objectOpen);
  if (objectOpen === -1 || objectClose === -1) {
    return result(id, title, "fail", [
      { file: relativePath, message: "pulserankFlags initializer not parseable" },
    ]);
  }

  const safeIdents = collectSafeFlagIdentifiers(source);
  const bindings = collectFlagBindings(source.slice(objectOpen + 1, objectClose));
  if (bindings.length === 0) {
    return result(id, title, "fail", [
      { file: relativePath, message: "no flag bindings found" },
    ]);
  }

  const findings: Finding[] = [];
  for (const binding of bindings) {
    if (!isFalseByDefault(binding.expr, safeIdents)) {
      findings.push({
        file: relativePath,
        message: `flag "${binding.key}" does not default to false (value: ${binding.expr})`,
      });
    }
  }

  return result(id, title, findings.length > 0 ? "fail" : "pass", findings);
}

// ---------------------------------------------------------------------------
// Check 3 — product domain contracts + golden fixture
// ---------------------------------------------------------------------------

const REQUIRED_CONTRACT_FILES = [
  "product-scrape-row.schema.ts",
  "product-scrape-row.ts",
  "field-states.ts",
  "observations.ts",
] as const;

const REQUIRED_CONTRACT_EXPORTS: ReadonlyArray<{ name: string; kind: "const" | "type" }> = [
  { name: "productScrapeRowV1Schema", kind: "const" },
  { name: "ProductScrapeRowV1", kind: "type" },
  { name: "FieldState", kind: "type" },
  { name: "NumberObservation", kind: "type" },
  { name: "ServingObservation", kind: "type" },
];

/** Extracts the top-level keys declared in `productScrapeRowV1Schema`. */
function declaredSchemaKeys(schemaSource: string): string[] | null {
  const anchor = /productScrapeRowV1Schema\s*(?::[^=]+)?=\s*z\.object\s*\(\s*\{/
    .exec(schemaSource);
  if (anchor === null) return null;
  const open = anchor.index + anchor[0].length - 1;
  const close = matchingBrace(schemaSource, open);
  if (close === -1) return null;
  const body = schemaSource.slice(open + 1, close);
  const keys: string[] = [];
  const keyPattern = /^\s{2,}([A-Za-z_$][\w$]*)\s*:/gm;
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(body)) !== null) {
    keys.push(match[1] as string);
  }
  return keys;
}

/**
 * Verifies the product contracts directory exposes the required exports, the
 * zod schema module is present, and the golden fixture standard-full.json
 * carries every top-level section the schema declares (structural
 * pre-validation; the authoritative zod parse lives in
 * tests/unit/domain/product/product-scrape-row.test.ts).
 */
export async function checkContracts(root: string): Promise<CheckResult> {
  const id = "product-contracts";
  const title = "Product contracts exported and golden fixture well-formed";
  const contractsDir = "src/domain/product/contracts";
  const fixturePath = "src/domain/product/fixtures/standard-full.json";

  const findings: Finding[] = [];

  const sources = new Map<string, string>();
  for (const file of REQUIRED_CONTRACT_FILES) {
    const relative = `${contractsDir}/${file}`;
    const body = await readTextFile(root, relative);
    if (body === null) {
      findings.push({
        file: relative,
        message: `required contract module is missing: ${file}`,
      });
      continue;
    }
    sources.set(file, body);
  }

  const schemaSource = sources.get("product-scrape-row.schema.ts");
  if (schemaSource !== undefined && !/from\s+"zod"/.test(schemaSource)) {
    findings.push({
      file: `${contractsDir}/product-scrape-row.schema.ts`,
      message: "schema module does not import zod",
    });
  }

  const combined = [...sources.values()].join("\n");
  for (const required of REQUIRED_CONTRACT_EXPORTS) {
    const keyword = required.kind === "const" ? "const" : "type";
    const pattern = new RegExp(
      `export\\s+${keyword}\\s+${required.name}\\b`,
    );
    if (!pattern.test(combined)) {
      findings.push({
        file: contractsDir,
        message: `missing export: ${keyword} ${required.name}`,
      });
    }
  }

  const fixtureBody = await readTextFile(root, fixturePath);
  if (fixtureBody === null) {
    findings.push({
      file: fixturePath,
      message: "golden fixture standard-full.json is missing or unreadable",
    });
    return result(id, title, "fail", findings);
  }

  let fixture: unknown;
  try {
    fixture = JSON.parse(fixtureBody);
  } catch (error) {
    findings.push({
      file: fixturePath,
      message: `golden fixture is not valid JSON: ${String(error)}`,
    });
    return result(id, title, "fail", findings);
  }

  if (schemaSource !== undefined) {
    const keys = declaredSchemaKeys(schemaSource);
    if (keys === null || keys.length === 0) {
      findings.push({
        file: `${contractsDir}/product-scrape-row.schema.ts`,
        message: "productScrapeRowV1Schema z.object keys not parseable",
      });
    } else if (
      fixture !== null &&
      typeof fixture === "object" &&
      !Array.isArray(fixture)
    ) {
      const record = fixture as Record<string, unknown>;
      for (const key of keys) {
        if (!(key in record)) {
          findings.push({
            file: fixturePath,
            message: `golden fixture missing schema section "${key}"`,
          });
        }
      }
      if (record.schemaVersion !== "1.0") {
        findings.push({
          file: fixturePath,
          message: `golden fixture schemaVersion must be "1.0" (got ${JSON.stringify(record.schemaVersion)})`,
        });
      }
    }
  }

  return result(id, title, findings.length > 0 ? "fail" : "pass", findings);
}

// ---------------------------------------------------------------------------
// Check 4 — database schema boundary
// ---------------------------------------------------------------------------

export interface DbSchemaCheckOptions {
  /**
   * PostgreSQL schema names allowed to hold tables. "public" (the existing
   * app schemas: auth/core/transit/commute) is always allowed; "pulse" is the
   * PulseRank addition.
   */
  readonly knownSchemas?: readonly string[];
}

const DEFAULT_KNOWN_DB_SCHEMAS = ["pulse"] as const;

interface TableRef {
  readonly table: string;
  readonly schema: string | null; // null => bound to an unresolved variable
  readonly file: string;
  readonly line: number;
}

/**
 * Verifies every table defined under src/server/db/schema lives in a known
 * PostgreSQL schema: the pre-existing "public" app schemas or the isolated
 * "pulse" schema. Flags new pgSchema namespaces, tables bound to undeclared
 * schema variables, and dotted "schema.table" names outside the known set.
 */
export async function checkDatabaseSchemas(
  root: string,
  options: DbSchemaCheckOptions = {},
): Promise<CheckResult> {
  const id = "db-schema-boundary";
  const title = "DB tables confined to known schemas (public + pulse)";
  const schemaDir = "src/server/db/schema";
  const known = new Set(["public", ...(options.knownSchemas ?? DEFAULT_KNOWN_DB_SCHEMAS)]);

  const files = await listTextFiles(root, schemaDir, new Set());
  if (files.length === 0) {
    return result(id, title, "fail", [
      { file: schemaDir, message: "schema directory missing or empty" },
    ]);
  }

  const declaredSchemas = new Map<string, string>(); // variable -> pg schema name
  const unknownSchemaDeclarations: Finding[] = [];
  for (const file of files) {
    const body = await readTextFile(root, file);
    if (body === null) continue;
    const pattern =
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*pgSchema\s*\(\s*["']([^"']+)["']\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(body)) !== null) {
      const variable = match[1] as string;
      const schemaName = match[2] as string;
      declaredSchemas.set(variable, schemaName);
      if (!known.has(schemaName)) {
        unknownSchemaDeclarations.push({
          file,
          line: lineNumberAt(body, match.index),
          message: `declares pgSchema("${schemaName}") outside the known schemas (${[...known].join(", ")})`,
        });
      }
    }
  }

  const tables: TableRef[] = [];
  for (const file of files) {
    const body = await readTextFile(root, file);
    if (body === null) continue;

    const namespaced =
      /([A-Za-z_$][\w$]*)\s*\.\s*table\s*\(\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = namespaced.exec(body)) !== null) {
      const variable = match[1] as string;
      tables.push({
        table: match[2] as string,
        schema: declaredSchemas.get(variable) ?? null,
        file,
        line: lineNumberAt(body, match.index),
      });
    }

    const bare = /\bpgTable\s*\(\s*["']([^"']+)["']/g;
    while ((match = bare.exec(body)) !== null) {
      const name = match[1] as string;
      const dot = name.indexOf(".");
      tables.push({
        table: dot === -1 ? name : (name.split(".")[1] ?? name),
        schema: dot === -1 ? "public" : (name.split(".")[0] ?? null),
        file,
        line: lineNumberAt(body, match.index),
      });
    }
  }

  const findings: Finding[] = [...unknownSchemaDeclarations];
  for (const table of tables) {
    if (table.schema === null) {
      findings.push({
        file: table.file,
        line: table.line,
        message: `table "${table.table}" bound to an undeclared schema variable`,
      });
    } else if (!known.has(table.schema)) {
      findings.push({
        file: table.file,
        line: table.line,
        message: `table "${table.table}" defined outside known schemas (schema "${table.schema}")`,
      });
    }
  }

  findings.sort((a, b) =>
    (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0),
  );
  return result(id, title, findings.length > 0 ? "fail" : "pass", findings);
}

// ---------------------------------------------------------------------------
// Check 5 — package.json metadata (warning only)
// ---------------------------------------------------------------------------

/**
 * Warns when package.json name/metadata mentions "pulserank". Informational
 * during the rebuild: the package keeps its historical identity until the
 * rename is deliberately executed.
 */
export async function checkPackageMetadata(root: string): Promise<CheckResult> {
  const id = "package-metadata";
  const title = 'package.json metadata mentioning "pulserank"';
  const relativePath = "package.json";
  const body = await readTextFile(root, relativePath);
  if (body === null) {
    return result(id, title, "warn", [
      { file: relativePath, message: "package.json missing or unreadable" },
    ]);
  }

  let manifest: Record<string, unknown>;
  try {
    manifest = JSON.parse(body) as Record<string, unknown>;
  } catch (error) {
    return result(id, title, "warn", [
      { file: relativePath, message: `package.json is not valid JSON: ${String(error)}` },
    ]);
  }

  const findings: Finding[] = [];
  const name = manifest.name;
  if (typeof name === "string" && /pulserank/i.test(name)) {
    findings.push({
      file: relativePath,
      message: `package name mentions pulserank: "${name}"`,
    });
  }
  const description = manifest.description;
  if (typeof description === "string" && /pulserank/i.test(description)) {
    findings.push({
      file: relativePath,
      message: `package description mentions pulserank: "${description}"`,
    });
  }
  if (Array.isArray(manifest.keywords)) {
    for (const keyword of manifest.keywords) {
      if (typeof keyword === "string" && /pulserank/i.test(keyword)) {
        findings.push({
          file: relativePath,
          message: `package keywords mention pulserank: "${keyword}"`,
        });
      }
    }
  }

  return result(id, title, findings.length > 0 ? "warn" : "pass", findings);
}

// ---------------------------------------------------------------------------
// Check 6 — pre-rebuild backup artifact (warning only)
// ---------------------------------------------------------------------------

/**
 * Verifies the backups/unbroken-before-pulserank-*.dump referenced by
 * docs/coordination/state.yaml exists on disk. Missing backup is a warning:
 * releases proceed, but the safety net must be called out.
 */
export async function checkBackupArtifacts(root: string): Promise<CheckResult> {
  const id = "backup-artifact";
  const title = "Pre-rebuild DB backup referenced by state.yaml exists";
  const statePath = "docs/coordination/state.yaml";
  const body = await readTextFile(root, statePath);

  if (body === null) {
    return result(id, title, "warn", [
      { file: statePath, message: "state.yaml missing; backup reference unverifiable" },
    ]);
  }

  const reference = /^\s*db_backup:\s*(\S+)/m.exec(body);
  if (reference === null) {
    return result(id, title, "pass", []);
  }

  const backupPath = (reference[1] ?? "").replace(/^["']|["'],?$/g, "");
  if (!/^backups\/unbroken-before-pulserank-.+\.dump$/.test(backupPath)) {
    return result(id, title, "warn", [
      { file: statePath, message: `unexpected db_backup reference: "${backupPath}"` },
    ]);
  }

  try {
    const info = await stat(path.join(root, backupPath));
    if (info.isFile()) return result(id, title, "pass", []);
  } catch {
    // fall through to warning below
  }

  return result(id, title, "warn", [
    { file: backupPath, message: `backup referenced in ${statePath} is missing on disk` },
  ]);
}

// ---------------------------------------------------------------------------
// Aggregation + CLI
// ---------------------------------------------------------------------------

/** Runs every release check against `root` and aggregates the report. */
export async function runReleaseChecks(
  root: string,
  options: ScanOptions & DbSchemaCheckOptions = {},
): Promise<ReleaseReport> {
  const results = [
    await scanLegacyReferences(root, options),
    await checkFlags(root),
    await checkContracts(root),
    await checkDatabaseSchemas(root, options),
    await checkPackageMetadata(root),
    await checkBackupArtifacts(root),
  ];
  return {
    root,
    results,
    ok: results.every((check) => check.status !== "fail"),
  };
}

function formatReport(report: ReleaseReport): string {
  const lines: string[] = [];
  lines.push(`PulseRank release gate — ${report.root}`);
  lines.push("");
  for (const check of report.results) {
    const badge = check.status.toUpperCase().padEnd(4);
    lines.push(`${badge} ${check.id} — ${check.title}`);
    for (const finding of check.findings) {
      const where = finding.file
        ? `${finding.file}${finding.line === undefined ? "" : `:${finding.line}`}`
        : "";
      lines.push(`     - ${finding.message}${where ? ` (${where})` : ""}`);
    }
  }
  const failed = report.results.filter((check) => check.status === "fail").length;
  const warned = report.results.filter((check) => check.status === "warn").length;
  lines.push("");
  lines.push(
    report.ok
      ? `Release gate PASSED (${failed} failed, ${warned} warnings)`
      : `Release gate FAILED (${failed} failed, ${warned} warnings)`,
  );
  return lines.join("\n");
}

async function main(): Promise<void> {
  const root = process.cwd();
  const report = await runReleaseChecks(root);
  console.log(formatReport(report));
  if (!report.ok) process.exitCode = 1;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith("release-check.ts") ||
    process.argv[1].endsWith("release-check"));

if (invokedDirectly) {
  await main();
}
