import { createHash } from "node:crypto";
import { mkdir, readdir, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

const ARTIFACT_NAMES = new Set([
  "detection.json",
  "heal-request.json",
  "preview.json",
  "deterministic-review.json",
  "llm-review.json",
  "approval.json",
  "verification.json",
]);

const SECRET_KEY = /(authorization|api[_-]?key|token|password|secret)/i;
const BEARER_VALUE = /Bearer\s+[A-Za-z0-9._~+\/-]+/gi;

function sanitize(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value.replace(BEARER_VALUE, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [
        childKey,
        sanitize(child, childKey),
      ]),
    );
  }
  return value;
}

function artifactRoot() {
  return path.resolve(/* turbopackIgnore: true */
    process.env.INCIDENT_ARTIFACTS_DIR ?? "artifacts/incidents",
  );
}


export async function writeIncidentArtifact(
  incidentId: string,
  artifactName: string,
  value: unknown,
) {
  if (!/^[0-9a-f-]{36}$/i.test(incidentId)) {
    throw new Error("Invalid incident artifact identifier.");
  }
  if (!ARTIFACT_NAMES.has(artifactName)) {
    throw new Error("Unsupported incident artifact name.");
  }

  const root = artifactRoot();
  const directory = path.join(/* turbopackIgnore: true */ root, incidentId);
  const destination = path.join(/* turbopackIgnore: true */ directory, artifactName);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  const body = `${JSON.stringify(sanitize(value), null, 2)}\n`;

  await mkdir(/* turbopackIgnore: true */ directory, { recursive: true, mode: 0o700 });
  await writeFile(/* turbopackIgnore: true */ temporary, body, { encoding: "utf8", mode: 0o600 });
  await rename(/* turbopackIgnore: true */ temporary, destination);

  return {
    artifactName,
    relativePath: path.relative(process.cwd(), destination),
    sha256: createHash("sha256").update(body).digest("hex"),
    byteLength: Buffer.byteLength(body),
  };
}

export async function expireIncidentArtifacts(
  now = new Date(),
  retentionDays = 90,
) {
  const root = artifactRoot();
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1_000;
  let directories;
  try {
    directories = await readdir(/* turbopackIgnore: true */ root, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw error;
  }

  let removed = 0;
  for (const directory of directories) {
    if (!directory.isDirectory() || !/^[0-9a-f-]{36}$/i.test(directory.name)) {
      continue;
    }
    const incidentDirectory = path.join(/* turbopackIgnore: true */ root, directory.name);
    for (const artifactName of ARTIFACT_NAMES) {
      const candidate = path.join(/* turbopackIgnore: true */ incidentDirectory, artifactName);
      try {
        const metadata = await stat(/* turbopackIgnore: true */ candidate);
        if (metadata.mtimeMs < cutoff) {
          await unlink(/* turbopackIgnore: true */ candidate);
          removed += 1;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    try {
      await rmdir(/* turbopackIgnore: true */ incidentDirectory);
    } catch (error) {
      if (!["ENOENT", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) {
        throw error;
      }
    }
  }
  return removed;
}
