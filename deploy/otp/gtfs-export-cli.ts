import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";

import { sameGtfsIdentity, type GtfsExportProvenance } from "./gtfs-export";
import {
  GTFS_FILE_ORDER,
  PostgresStreamingGtfsExporter,
} from "./gtfs-stream-export";

function safePath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.includes("\0"))
    throw new Error("A safe absolute path is required.");
  return value;
}
async function sha256(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function runGtfsExport() {
  const exporter = new PostgresStreamingGtfsExporter();
  if (process.argv[2] === "--verify") {
    const evidenceText = await readFile(safePath(process.argv[3]), "utf8");
    if (Buffer.byteLength(evidenceText) > 64 * 1024)
      throw new Error("GTFS provenance is too large.");
    const evidence = JSON.parse(evidenceText) as GtfsExportProvenance;
    const current = await exporter.activeIdentity();
    if (!sameGtfsIdentity(evidence, current))
      throw new Error("The active transit snapshot changed.");
    return;
  }
  const archivePath = safePath(process.argv[2]);
  const provenancePath = safePath(process.argv[3]);
  const directory = await mkdtemp(join(dirname(archivePath), ".gtfs-export-"));
  const candidateArchive = `${archivePath}.candidate`;
  try {
    const identity = await exporter.exportFiles(directory);
    const process = Bun.spawn(
      ["zip", "-X", "-0", "-q", candidateArchive, ...GTFS_FILE_ORDER],
      { cwd: directory, stdout: "ignore", stderr: "ignore" },
    );
    if ((await process.exited) !== 0) throw new Error("GTFS packaging failed.");
    const size = (await stat(candidateArchive)).size;
    if (size <= 0) throw new Error("GTFS package is empty.");
    const provenance: GtfsExportProvenance = {
      ...identity,
      generatedArchiveBytes: size,
      generatedArchiveSha256: await sha256(candidateArchive),
    };
    const current = await exporter.activeIdentity();
    if (!sameGtfsIdentity(provenance, current))
      throw new Error("The active transit snapshot changed.");
    const candidateProvenance = `${provenancePath}.candidate`;
    await writeFile(candidateProvenance, JSON.stringify(provenance) + "\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(candidateArchive, archivePath);
    await rename(candidateProvenance, provenancePath);
  } finally {
    await rm(directory, { recursive: true, force: true });
    await rm(candidateArchive, { force: true });
  }
}

if (import.meta.main) {
  try {
    await runGtfsExport();
  } catch {
    process.stderr.write("The active transit archive could not be exported.\n");
    process.exitCode = 1;
  }
}
