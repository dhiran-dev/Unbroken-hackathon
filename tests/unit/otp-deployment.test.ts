import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  OTP_PINS,
  verifyOtpDeployment,
  type OtpDeploymentInputs,
} from "../../deploy/otp/contract";

function fixture(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../../deploy/otp/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function validInputs(
  overrides: Partial<OtpDeploymentInputs> = {},
): OtpDeploymentInputs {
  return {
    manifest: {
      configVersion: "unbroken-sf-otp-v1",
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
        fileName: "sf-active-gtfs-cdcc1bbe6138.zip",
        activeArchiveSha256:
          "e3fa3823286462e892aba89f3764e3e5bde8d9aaf9760b89261faf434c27192c",
        stagedSha256:
          "cdcc1bbe613804543d702e8e3b4adb6945d88fc774e5cad557508a12c9fbefb0",
      },
      graph: {
        fileName: "graph.obj",
        bytes: 61_980_783,
        sha256:
          "b9224fe6e1f92e970e225c4804e56851c36d87f46772cb1cd3a1af62ee4a1bcd",
      },
    },
    service: {
      image: OTP_PINS.image.index,
      platformManifest: OTP_PINS.image.linuxAmd64,
      configVersion: "unbroken-sf-otp-v1",
      graphSha256:
        "b9224fe6e1f92e970e225c4804e56851c36d87f46772cb1cd3a1af62ee4a1bcd",
      otpVersion: "2.9.0",
      privateNetwork: true,
      hostPorts: [],
      readOnly: true,
      memoryLimitBytes: 4_294_967_296,
      javaMaxHeapBytes: 3_221_225_472,
      healthPath: "/otp/actuators/health",
      graphqlPath: "/otp/gtfs/v1",
    },
    health: { statusCode: 200, body: fixture("health-ready.json") },
    serviceDateTime: "2026-08-21T08:30:00-07:00",
    plan: { statusCode: 200, body: fixture("plan-with-transit.json") },
    wheelchairProbe: {
      statusCode: 200,
      body: fixture("plan-wheelchair-unknown.json"),
    },
    ...overrides,
  };
}

describe("OTP deployment verifier", () => {
  it("accepts a pinned private ready service with a bounded neutral transit candidate and no OTP accessibility claim", () => {
    const result = verifyOtpDeployment(validInputs());

    expect(result).toEqual({
      ready: true,
      evidence: {
        configVersion: "unbroken-sf-otp-v1",
        otpVersion: "2.9.0",
        imageIndex: OTP_PINS.image.index,
        platformManifest: OTP_PINS.image.linuxAmd64,
        graphSha256:
          "b9224fe6e1f92e970e225c4804e56851c36d87f46772cb1cd3a1af62ee4a1bcd",
        gtfsGeneratedZipSha256:
          "cdcc1bbe613804543d702e8e3b4adb6945d88fc774e5cad557508a12c9fbefb0",
        gtfsSha256:
          "e3fa3823286462e892aba89f3764e3e5bde8d9aaf9760b89261faf434c27192c",
        osmSha256: OTP_PINS.osm.extractedSha256,
        serviceDateTime: "2026-08-21T08:30:00-07:00",
        requestedItineraries: 5,
        accessibilityClaim: false,
        candidateRole: "static_candidates_only",
        wheelchairFilteredCandidateCount: 0,
        itineraryCount: 1,
        transitItineraryCount: 1,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(
      /https?:\/\/otp|internal|token/i,
    );
  });
});
