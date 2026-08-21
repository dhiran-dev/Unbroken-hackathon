/**
 * Judge cockpit — demo artifact writer (Agent A12).
 *
 * Live heal previews and collector reruns triggered from /judge write their
 * envelopes HERE and ONLY here: `artifacts/demo/`. The recorded evidence under
 * `artifacts/scraper/` (Agent A2's real healing history) is never modified by
 * the cockpit.
 *
 * Confinement rules mirror the reader: flat safe file names only, resolved
 * path re-verified to stay inside `<cwd>/artifacts/demo`, content serialized
 * with JSON.stringify (never executed).
 */

import fs from "node:fs";
import path from "node:path";

const SAFE_DEMO_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u;
const MAX_DEMO_BYTES = 2 * 1024 * 1024;

export function defaultDemoDir(): string {
  return path.resolve(process.cwd(), "artifacts", "demo");
}

export class DemoArtifactWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DemoArtifactWriteError";
  }
}

/** Write one JSON envelope under `artifacts/demo/` (mkdir -p, size-capped). */
export function writeDemoArtifact(
  name: string,
  value: unknown,
  demoDir: string = defaultDemoDir(),
): { name: string; bytes: number } {
  if (!SAFE_DEMO_NAME.test(name) || name.includes("/") || name.includes("\\")) {
    throw new DemoArtifactWriteError(`Rejected unsafe demo artifact name: ${name}`);
  }
  const dir = path.resolve(demoDir);
  const root = path.resolve(process.cwd(), "artifacts", "demo");
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (!dir.startsWith(prefix)) {
    throw new DemoArtifactWriteError("Demo artifact directory escaped artifacts/demo.");
  }
  const body = JSON.stringify(value, null, 2) + "\n";
  if (Buffer.byteLength(body, "utf8") > MAX_DEMO_BYTES) {
    throw new DemoArtifactWriteError("Demo artifact exceeds the size cap.");
  }
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, name);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(prefix)) {
    throw new DemoArtifactWriteError("Demo artifact path escaped artifacts/demo.");
  }
  fs.writeFileSync(resolved, body, "utf8");
  return { name, bytes: Buffer.byteLength(body, "utf8") };
}
