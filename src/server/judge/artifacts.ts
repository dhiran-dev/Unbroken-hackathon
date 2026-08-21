/**
 * Judge cockpit — safe artifact reader (Agent A12).
 *
 * The /judge page renders REAL healing evidence from `artifacts/` at request
 * time. This module is the only way the cockpit touches the filesystem:
 *
 * - reads are confined to `artifacts/` (relative to the process working
 *   directory); a requested file name can never escape the root,
 * - only flat file names inside the two known subdirectories (`scraper/`,
 *   `demo/`) are addressable — no separators, no dot segments, no absolute
 *   paths, no null bytes; the resolved path is re-verified to stay inside the
 *   root as defense in depth,
 * - content is returned as raw text or `JSON.parse`d values only. Artifact
 *   content is NEVER executed, imported, or evaluated,
 * - every read is size-capped so a pathological artifact cannot exhaust
 *   memory.
 */

import fs from "node:fs";
import path from "node:path";

/** Artifact subdirectories the cockpit may address. */
export const ARTIFACT_DIRS = ["scraper", "demo"] as const;
export type ArtifactDir = (typeof ARTIFACT_DIRS)[number];

/** Default artifacts root, resolved against the process working directory. */
export function defaultArtifactsRoot(): string {
  return path.resolve(process.cwd(), "artifacts");
}

/** Hard cap for any single artifact read (artifacts are small envelopes). */
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;

/**
 * A flat, safe artifact file name: starts alphanumeric, then alphanumerics,
 * dots, underscores, or hyphens. Rejects separators, dot segments, and
 * control characters outright.
 */
const SAFE_ARTIFACT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;

export class ArtifactNotFoundError extends Error {
  constructor(dir: ArtifactDir, name: string) {
    super(`Artifact ${dir}/${name} was not found under the artifacts root.`);
    this.name = "ArtifactNotFoundError";
  }
}

export class ArtifactPathError extends Error {
  constructor(name: string) {
    super(`Rejected unsafe artifact file name: ${JSON.stringify(name)}.`);
    this.name = "ArtifactPathError";
  }
}

export type ArtifactStat = {
  name: string;
  bytes: number;
  /** Last-modified time of the artifact file (ISO 8601), when stat succeeds. */
  modifiedAt: string | null;
};

function assertSafeName(name: string): void {
  if (
    typeof name !== "string" ||
    !SAFE_ARTIFACT_NAME.test(name) ||
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    name.includes("\0")
  ) {
    throw new ArtifactPathError(name);
  }
}

/**
 * Resolve `<root>/<dir>/<name>` and prove the result stays inside the root.
 * Exported for the path-traversal safety test; the double check (name grammar
 * + resolved-prefix assertion) is deliberate defense in depth.
 */
export function resolveArtifactPath(
  rootDir: string,
  dir: ArtifactDir,
  name: string,
): string {
  assertSafeName(name);
  const root = path.resolve(rootDir);
  const resolved = path.resolve(root, dir, name);
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (resolved !== root && !resolved.startsWith(prefix)) {
    throw new ArtifactPathError(name);
  }
  return resolved;
}

function statArtifact(
  resolvedPath: string,
  dir: ArtifactDir,
  name: string,
): { bytes: number; modifiedAt: string | null } {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolvedPath);
  } catch {
    throw new ArtifactNotFoundError(dir, name);
  }
  if (!stat.isFile()) {
    throw new ArtifactNotFoundError(dir, name);
  }
  return {
    bytes: stat.size,
    modifiedAt: Number.isFinite(stat.mtimeMs) ? new Date(stat.mtimeMs).toISOString() : null,
  };
}

/** List the artifact files in one known subdirectory (sorted by name). */
export function listArtifacts(
  dir: ArtifactDir,
  rootDir: string = defaultArtifactsRoot(),
): ArtifactStat[] {
  const resolvedDir = path.resolve(rootDir, dir);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolvedDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const stats: ArtifactStat[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!SAFE_ARTIFACT_NAME.test(entry.name)) continue;
    try {
      const stat = fs.statSync(path.join(resolvedDir, entry.name));
      stats.push({
        name: entry.name,
        bytes: stat.size,
        modifiedAt: Number.isFinite(stat.mtimeMs)
          ? new Date(stat.mtimeMs).toISOString()
          : null,
      });
    } catch {
      // A file that vanished mid-listing is simply not listed.
    }
  }
  return stats.sort((a, b) => a.name.localeCompare(b.name));
}

/** Read one artifact's raw text (size-capped). Never executes content. */
export function readArtifactText(
  dir: ArtifactDir,
  name: string,
  rootDir: string = defaultArtifactsRoot(),
): string {
  const resolvedPath = resolveArtifactPath(rootDir, dir, name);
  const { bytes } = statArtifact(resolvedPath, dir, name);
  if (bytes > MAX_ARTIFACT_BYTES) {
    throw new ArtifactPathError(name);
  }
  return fs.readFileSync(resolvedPath, "utf8");
}

/** Read one artifact and parse it as JSON. Never executes content. */
export function readArtifactJson(
  dir: ArtifactDir,
  name: string,
  rootDir: string = defaultArtifactsRoot(),
): unknown {
  return JSON.parse(readArtifactText(dir, name, rootDir)) as unknown;
}

/** Convenience: list + read the scraper evidence directory. */
export function listScraperArtifacts(
  rootDir: string = defaultArtifactsRoot(),
): ArtifactStat[] {
  return listArtifacts("scraper", rootDir);
}

export function readScraperArtifactJson(
  name: string,
  rootDir: string = defaultArtifactsRoot(),
): unknown {
  return readArtifactJson("scraper", name, rootDir);
}
