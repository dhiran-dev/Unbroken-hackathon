import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { privateBaseUrl } from "../../deploy/otp/verify-cli";

import {
  OTP_PINS,
  createOtpPlanRequest,
  createOtpWheelchairProbeRequest,
  verifyOtpDeployment,
  type OtpBuildManifest,
  type OtpDeploymentInputs,
} from "../../deploy/otp/contract";

const GTFS_SHA =
  "6f8d6c95ce83989b71682367b4c88583e46a3922144094794438750937447e57";
const GRAPH_SHA =
  "0a9fc56c7c6c0112e248115b99226060bf88e5aa2afcd9f82091fd9e43b9f030";

function fixture(name: string) {
  return JSON.parse(
    readFileSync(
      new URL(`../../deploy/otp/fixtures/${name}`, import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function manifest(): OtpBuildManifest {
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
      activeArchiveSha256: GTFS_SHA,
      stagedSha256: GTFS_SHA,
    },
    graph: { fileName: "graph.obj", bytes: 481_223_841, sha256: GRAPH_SHA },
  };
}

function inputs(
  overrides: Partial<OtpDeploymentInputs> = {},
): OtpDeploymentInputs {
  return {
    manifest: manifest(),
    service: {
      image: OTP_PINS.image.index,
      platformManifest: OTP_PINS.image.linuxAmd64,
      configVersion: OTP_PINS.configVersion,
      graphSha256: GRAPH_SHA,
      otpVersion: OTP_PINS.otpVersion,
      privateNetwork: true,
      hostPorts: [],
      readOnly: true,
      memoryLimitBytes: 4_294_967_296,
      javaMaxHeapBytes: 3_221_225_472,
      healthPath: OTP_PINS.healthPath,
      graphqlPath: OTP_PINS.graphqlPath,
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

function safeFailure(
  result: ReturnType<typeof verifyOtpDeployment>,
  code: string,
) {
  expect(result).toEqual({
    ready: false,
    code,
    message: "Current updates are unavailable.",
  });
  expect(JSON.stringify(result)).not.toMatch(
    /https?:\/\/|graph\.obj|token|private/i,
  );
}

describe("OTP verifier failure gates", () => {
  it("builds the fixed bounded neutral sample request from caller time", () => {
    const request = createOtpPlanRequest("2026-08-21T08:30:00-07:00");

    expect(request.path).toBe("/otp/gtfs/v1");
    expect(request.body.variables).toEqual({
      serviceDateTime: "2026-08-21T08:30:00-07:00",
    });
    expect(request.body.query).toContain("first: 5");
    expect(request.body.query).toContain("$serviceDateTime: OffsetDateTime!");
    expect(request.body.query).toContain("transitOnly: true");
    expect(request.body.query).toContain("routingErrors { code inputField }");
    expect(request.body.query).not.toContain("wheelchair");
    const probe = createOtpWheelchairProbeRequest("2026-08-21T08:30:00-07:00");
    expect(probe.body.query).toContain("wheelchair: { enabled: true }");
    expect(request.body.query).toContain("latitude: 37.75225");
    expect(request.body.query).toContain("longitude: -122.41845");
    expect(request.body.query).toContain("latitude: 37.808");
    expect(request.body.query).toContain("longitude: -122.4177");
    expect(() => createOtpPlanRequest("tomorrow morning")).toThrow();
    expect(() => createOtpPlanRequest("2026-02-30T08:30:00-07:00")).toThrow();
  });

  it("rejects image, OSM, GTFS, and graph pin drift or missing evidence", () => {
    const base = manifest();
    const changed: unknown[] = [
      { ...base, image: { ...base.image, index: "mutable:latest" } },
      { ...base, image: { ...base.image, linuxAmd64: "sha256:wrong" } },
      { ...base, image: { ...base.image, releaseCommit: "0".repeat(40) } },
      { ...base, image: { ...base.image, jarBytes: 1 } },
      { ...base, image: { ...base.image, jarSha256: "0".repeat(64) } },
      { ...base, osm: { ...base.osm, sourceBytes: 1 } },
      { ...base, osm: { ...base.osm, sourceSha256: "0".repeat(64) } },
      { ...base, osm: { ...base.osm, extractedBytes: 1 } },
      { ...base, osm: { ...base.osm, extractedSha256: "0".repeat(64) } },
      { ...base, osm: { ...base.osm, osmiumVersion: "other" } },
      { ...base, osm: { ...base.osm, missingWayNodes: 1 } },
      { ...base, gtfs: { ...base.gtfs, fileName: "feed.zip" } },
      { ...base, gtfs: { ...base.gtfs, stagedSha256: "wrong" } },
      { ...base, graph: { ...base.graph, bytes: 0 } },
      { ...base, graph: { ...base.graph, sha256: "missing" } },
      { ...base, osm: undefined },
    ];

    for (const candidate of changed) {
      safeFailure(
        verifyOtpDeployment(inputs({ manifest: candidate })),
        "BUILD_EVIDENCE_INVALID",
      );
    }
  });

  it("rejects public, mutable, writable, unbounded, or mismatched service evidence", () => {
    const base = inputs().service;
    const changed = [
      { ...base, hostPorts: [8080] },
      { ...base, privateNetwork: false },
      { ...base, readOnly: false },
      { ...base, image: "docker.io/opentripplanner/opentripplanner:latest" },
      { ...base, platformManifest: "sha256:wrong" },
      { ...base, configVersion: "other" },
      { ...base, otpVersion: "2.10.0" },
      { ...base, graphSha256: "0".repeat(64) },
      { ...base, memoryLimitBytes: Number.MAX_SAFE_INTEGER },
      { ...base, javaMaxHeapBytes: Number.MAX_SAFE_INTEGER },
      { ...base, healthPath: "/health" },
      { ...base, graphqlPath: "/graphql" },
    ];

    for (const service of changed) {
      safeFailure(
        verifyOtpDeployment(inputs({ service })),
        "SERVICE_CONTRACT_INVALID",
      );
    }
  });

  it("requires health 200 after graph load", () => {
    safeFailure(
      verifyOtpDeployment(
        inputs({
          health: { statusCode: 404, body: fixture("health-unready.json") },
        }),
      ),
      "SERVICE_NOT_READY",
    );
    safeFailure(
      verifyOtpDeployment(
        inputs({
          health: { statusCode: 200, body: fixture("health-unready.json") },
        }),
      ),
      "SERVICE_NOT_READY",
    );
  });

  it("rejects walk-only, empty, oversized, malformed, or errored plan results", () => {
    const transit = fixture("plan-with-transit.json") as Record<
      string,
      unknown
    >;
    const edge = (
      (
        (transit.data as Record<string, unknown>).planConnection as Record<
          string,
          unknown
        >
      ).edges as unknown[]
    )[0];
    const responses: Array<{ statusCode: number; body: unknown }> = [
      { statusCode: 200, body: fixture("plan-walk-only.json") },
      { statusCode: 200, body: { data: { planConnection: { edges: [] } } } },
      {
        statusCode: 200,
        body: {
          data: {
            planConnection: { edges: Array.from({ length: 6 }, () => edge) },
          },
        },
      },
      { statusCode: 200, body: { errors: [{ message: "private" }] } },
      { statusCode: 500, body: null },
    ];

    for (const plan of responses) {
      safeFailure(verifyOtpDeployment(inputs({ plan })), "PLAN_INVALID");
    }
    safeFailure(
      verifyOtpDeployment(inputs({ serviceDateTime: "not-a-date" })),
      "PLAN_INVALID",
    );
  });
});

describe("private OTP verifier address gate", () => {
  it("allows only loopback, private IPs, ULA, and single-label internal DNS", () => {
    for (const value of [
      "http://127.0.0.1:8080",
      "http://10.2.3.4:8080",
      "http://172.16.0.1",
      "http://172.31.255.254",
      "http://192.168.1.2",
      "http://[fd00::1]:8080",
      "http://otp:8080",
    ]) {
      expect(privateBaseUrl(value).hostname).toBeTruthy();
    }
    for (const value of [
      "https://8.8.8.8",
      "https://1.1.1.1",
      "https://example.com",
      "https://otp.internal.example",
      "https://[2001:4860:4860::8888]",
      "http://otp:8080/path",
      "http://user:pass@otp:8080",
    ]) {
      expect(() => privateBaseUrl(value)).toThrow();
    }
  });
});
