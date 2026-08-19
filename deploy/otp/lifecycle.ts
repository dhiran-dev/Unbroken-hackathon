import { OTP_PINS, type OtpBuildManifest } from "./contract";

export type OtpGraphRepository = {
  getActive: () => Promise<OtpBuildManifest | null>;
  promoteIfCurrent: (
    candidate: OtpBuildManifest,
    expectedGraphSha256: string | null,
  ) => Promise<boolean>;
};

export type OtpGraphLifecycleResult =
  | {
      status: "promoted";
      activeGraphSha256: string;
      previousGraphSha256: string | null;
    }
  | {
      status: "retained";
      activeGraphSha256: string | null;
      code: "CANDIDATE_BUILD_FAILED" | "CANDIDATE_NOT_READY" | "STALE_CURRENT";
      message: "The current routing graph was kept.";
    };

const SHA256 = /^[a-f0-9]{64}$/;

function candidateIsVerified(
  candidate: OtpBuildManifest,
  activeGtfsArchiveSha256: string,
  stagedGtfsSha256: string,
) {
  return (
    candidate.configVersion === OTP_PINS.configVersion &&
    candidate.image.index === OTP_PINS.image.index &&
    candidate.image.linuxAmd64 === OTP_PINS.image.linuxAmd64 &&
    candidate.image.linuxArm64 === OTP_PINS.image.linuxArm64 &&
    candidate.image.releaseCommit === OTP_PINS.image.releaseCommit &&
    candidate.image.jarBytes === OTP_PINS.image.jarBytes &&
    candidate.image.jarSha256 === OTP_PINS.image.jarSha256 &&
    candidate.osm.sourceUrl === OTP_PINS.osm.sourceUrl &&
    candidate.osm.sourceBytes === OTP_PINS.osm.sourceBytes &&
    candidate.osm.sourceMd5 === OTP_PINS.osm.sourceMd5 &&
    candidate.osm.sourceSha256 === OTP_PINS.osm.sourceSha256 &&
    candidate.osm.bbox === OTP_PINS.osm.bbox &&
    candidate.osm.extractionStrategy === OTP_PINS.osm.extractionStrategy &&
    candidate.osm.setBounds === true &&
    candidate.osm.extractedBytes === OTP_PINS.osm.extractedBytes &&
    candidate.osm.extractedSha256 === OTP_PINS.osm.extractedSha256 &&
    candidate.osm.osmiumVersion === OTP_PINS.osm.osmiumVersion &&
    candidate.osm.nodes === OTP_PINS.osm.nodes &&
    candidate.osm.ways === OTP_PINS.osm.ways &&
    candidate.osm.relations === OTP_PINS.osm.relations &&
    candidate.osm.missingWayNodes === 0 &&
    candidate.osm.lastTimestamp === OTP_PINS.osm.lastTimestamp &&
    /gtfs/i.test(candidate.gtfs.fileName) &&
    SHA256.test(activeGtfsArchiveSha256) &&
    SHA256.test(stagedGtfsSha256) &&
    candidate.gtfs.activeArchiveSha256 === activeGtfsArchiveSha256 &&
    candidate.gtfs.stagedSha256 === stagedGtfsSha256 &&
    candidate.graph.fileName === "graph.obj" &&
    Number.isSafeInteger(candidate.graph.bytes) &&
    candidate.graph.bytes > 0 &&
    SHA256.test(candidate.graph.sha256)
  );
}

export async function buildAndPromoteOtpGraph(
  input: { activeGtfsArchiveSha256: string; stagedGtfsSha256: string },
  dependencies: {
    buildCandidate: () => Promise<OtpBuildManifest>;
    verifyCandidate: (candidate: OtpBuildManifest) => Promise<boolean>;
    repository: OtpGraphRepository;
  },
): Promise<OtpGraphLifecycleResult> {
  const previous = await dependencies.repository.getActive();
  try {
    const candidate = await dependencies.buildCandidate();
    if (
      !candidateIsVerified(
        candidate,
        input.activeGtfsArchiveSha256,
        input.stagedGtfsSha256,
      )
    ) {
      throw new Error("Candidate evidence failed validation.");
    }
    if (!(await dependencies.verifyCandidate(candidate))) {
      return {
        status: "retained",
        activeGraphSha256: previous?.graph.sha256 ?? null,
        code: "CANDIDATE_NOT_READY",
        message: "The current routing graph was kept.",
      };
    }
    const promoted = await dependencies.repository.promoteIfCurrent(
      candidate,
      previous?.graph.sha256 ?? null,
    );
    if (!promoted) {
      const active = await dependencies.repository.getActive();
      return {
        status: "retained",
        activeGraphSha256: active?.graph.sha256 ?? null,
        code: "STALE_CURRENT",
        message: "The current routing graph was kept.",
      };
    }
    return {
      status: "promoted",
      activeGraphSha256: candidate.graph.sha256,
      previousGraphSha256: previous?.graph.sha256 ?? null,
    };
  } catch {
    return {
      status: "retained",
      activeGraphSha256: previous?.graph.sha256 ?? null,
      code: "CANDIDATE_BUILD_FAILED",
      message: "The current routing graph was kept.",
    };
  }
}
