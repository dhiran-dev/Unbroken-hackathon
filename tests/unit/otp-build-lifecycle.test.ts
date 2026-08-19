import { describe, expect, it } from "vitest";

import { OTP_PINS, type OtpBuildManifest } from "../../deploy/otp/contract";
import {
  buildAndPromoteOtpGraph,
  type OtpGraphRepository,
} from "../../deploy/otp/lifecycle";

const ACTIVE_GTFS_SHA =
  "e3fa3823286462e892aba89f3764e3e5bde8d9aaf9760b89261faf434c27192c";
const STAGED_GTFS_SHA =
  "cdcc1bbe613804543d702e8e3b4adb6945d88fc774e5cad557508a12c9fbefb0";
const GRAPH_A =
  "0a9fc56c7c6c0112e248115b99226060bf88e5aa2afcd9f82091fd9e43b9f030";
const GRAPH_B =
  "b9224fe6e1f92e970e225c4804e56851c36d87f46772cb1cd3a1af62ee4a1bcd";

function manifest(graphSha256 = GRAPH_B): OtpBuildManifest {
  return {
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
      fileName: "sf-active-gtfs.zip",
      activeArchiveSha256: ACTIVE_GTFS_SHA,
      stagedSha256: STAGED_GTFS_SHA,
    },
    graph: {
      fileName: "graph.obj",
      bytes: 61_980_783,
      sha256: graphSha256,
    },
  };
}

class MemoryGraphRepository implements OtpGraphRepository {
  constructor(public active: OtpBuildManifest | null) {}

  async getActive() {
    return this.active;
  }

  async promoteIfCurrent(
    candidate: OtpBuildManifest,
    expectedGraphSha256: string | null,
  ) {
    if ((this.active?.graph.sha256 ?? null) !== expectedGraphSha256)
      return false;
    this.active = candidate;
    return true;
  }
}

describe("OTP graph candidate lifecycle", () => {
  it("promotes only a fully verified graph tied to the active GTFS archive", async () => {
    const repository = new MemoryGraphRepository(manifest(GRAPH_A));

    const result = await buildAndPromoteOtpGraph(
      {
        activeGtfsArchiveSha256: ACTIVE_GTFS_SHA,
        stagedGtfsSha256: STAGED_GTFS_SHA,
      },
      {
        buildCandidate: async () => manifest(GRAPH_B),
        verifyCandidate: async () => true,
        repository,
      },
    );

    expect(result).toEqual({
      status: "promoted",
      activeGraphSha256: GRAPH_B,
      previousGraphSha256: GRAPH_A,
    });
    expect(repository.active?.graph.sha256).toBe(GRAPH_B);
  });

  it("retains the prior graph after build failure or invalid candidate evidence", async () => {
    const failures: Array<() => Promise<OtpBuildManifest>> = [
      async () => Promise.reject(new Error("private build output")),
      async () => ({
        ...manifest(),
        gtfs: { ...manifest().gtfs, stagedSha256: "0".repeat(64) },
      }),
      async () => ({
        ...manifest(),
        gtfs: {
          ...manifest().gtfs,
          activeArchiveSha256: "1".repeat(64),
          stagedSha256: "1".repeat(64),
        },
      }),
      async () => ({
        ...manifest(),
        graph: { ...manifest().graph, bytes: 0 },
      }),
      async () => ({
        ...manifest(),
        osm: { ...manifest().osm, extractedSha256: "2".repeat(64) },
      }),
    ];

    for (const buildCandidate of failures) {
      const repository = new MemoryGraphRepository(manifest(GRAPH_A));
      const result = await buildAndPromoteOtpGraph(
        {
          activeGtfsArchiveSha256: ACTIVE_GTFS_SHA,
          stagedGtfsSha256: STAGED_GTFS_SHA,
        },
        { buildCandidate, verifyCandidate: async () => true, repository },
      );
      expect(result).toEqual({
        status: "retained",
        activeGraphSha256: GRAPH_A,
        code: "CANDIDATE_BUILD_FAILED",
        message: "The current routing graph was kept.",
      });
      expect(repository.active?.graph.sha256).toBe(GRAPH_A);
      expect(JSON.stringify(result)).not.toContain("private build output");
    }
  });

  it("probes the candidate before promotion and rejects a stale active graph", async () => {
    const notReady = new MemoryGraphRepository(manifest(GRAPH_A));
    expect(
      await buildAndPromoteOtpGraph(
        {
          activeGtfsArchiveSha256: ACTIVE_GTFS_SHA,
          stagedGtfsSha256: STAGED_GTFS_SHA,
        },
        {
          buildCandidate: async () => manifest(GRAPH_B),
          verifyCandidate: async () => false,
          repository: notReady,
        },
      ),
    ).toMatchObject({
      status: "retained",
      code: "CANDIDATE_NOT_READY",
      activeGraphSha256: GRAPH_A,
    });
    expect(notReady.active?.graph.sha256).toBe(GRAPH_A);

    const stale = new MemoryGraphRepository(manifest(GRAPH_A));
    const concurrent = manifest("3".repeat(64));
    expect(
      await buildAndPromoteOtpGraph(
        {
          activeGtfsArchiveSha256: ACTIVE_GTFS_SHA,
          stagedGtfsSha256: STAGED_GTFS_SHA,
        },
        {
          buildCandidate: async () => manifest(GRAPH_B),
          verifyCandidate: async () => {
            stale.active = concurrent;
            return true;
          },
          repository: stale,
        },
      ),
    ).toMatchObject({
      status: "retained",
      code: "STALE_CURRENT",
      activeGraphSha256: "3".repeat(64),
    });
    expect(stale.active?.graph.sha256).toBe("3".repeat(64));
  });
});
