import { rename, writeFile } from "node:fs/promises";

import { OTP_PINS, type OtpBuildManifest } from "./contract";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
}

function positiveInteger(name: string) {
  const value = Number(required(name));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return value;
}

export async function writeOtpBuildManifest() {
  const output = required("OTP_MANIFEST_OUTPUT");
  const temporary = `${output}.tmp`;
  const activeArchiveSha256 = required("OTP_GTFS_ACTIVE_ARCHIVE_SHA256");
  const stagedSha256 = required("OTP_GTFS_ZIP_SHA256");
  const graphSha256 = required("OTP_GRAPH_SHA256");
  if (
    !/^[a-f0-9]{64}$/.test(activeArchiveSha256) ||
    !/^[a-f0-9]{64}$/.test(stagedSha256) ||
    !/^[a-f0-9]{64}$/.test(graphSha256)
  ) {
    throw new Error("Manifest hashes must be lowercase SHA-256 values.");
  }
  const manifest: OtpBuildManifest = {
    configVersion: OTP_PINS.configVersion,
    image: {
      index: OTP_PINS.image.index,
      linuxAmd64: OTP_PINS.image.linuxAmd64,
      linuxArm64: OTP_PINS.image.linuxArm64,
      releaseCommit: OTP_PINS.image.releaseCommit,
      jarBytes: OTP_PINS.image.jarBytes,
      jarSha256: OTP_PINS.image.jarSha256,
    },
    osm: {
      sourceUrl: OTP_PINS.osm.sourceUrl,
      sourceBytes: OTP_PINS.osm.sourceBytes,
      sourceMd5: OTP_PINS.osm.sourceMd5,
      sourceSha256: OTP_PINS.osm.sourceSha256,
      bbox: OTP_PINS.osm.bbox,
      extractionStrategy: OTP_PINS.osm.extractionStrategy,
      setBounds: OTP_PINS.osm.setBounds,
      extractedBytes: OTP_PINS.osm.extractedBytes,
      extractedSha256: OTP_PINS.osm.extractedSha256,
      osmiumVersion: OTP_PINS.osm.osmiumVersion,
      nodes: OTP_PINS.osm.nodes,
      ways: OTP_PINS.osm.ways,
      relations: OTP_PINS.osm.relations,
      missingWayNodes: OTP_PINS.osm.missingWayNodes,
      lastTimestamp: OTP_PINS.osm.lastTimestamp,
    },
    gtfs: {
      fileName: required("OTP_GTFS_FILENAME"),
      activeArchiveSha256,
      stagedSha256,
    },
    graph: {
      fileName: "graph.obj",
      bytes: positiveInteger("OTP_GRAPH_BYTES"),
      sha256: graphSha256,
    },
  };
  if (!/gtfs/i.test(manifest.gtfs.fileName)) {
    throw new Error("The staged GTFS filename must contain gtfs.");
  }
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temporary, output);
}

if (import.meta.main) {
  await writeOtpBuildManifest();
}
