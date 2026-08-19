import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { OTP_PINS } from "../../deploy/otp/contract";
import { inspectOtpDeploymentFiles } from "../../deploy/otp/deployment-files";

function json(name: string) {
  return JSON.parse(
    readFileSync(new URL(`../../deploy/otp/${name}`, import.meta.url), "utf8"),
  ) as unknown;
}

describe("OTP deployment files", () => {
  it("define one digest-pinned private service with no host port and bounded read-only serving", () => {
    const result = inspectOtpDeploymentFiles({
      compose: json("compose.json"),
      otpConfig: json("otp-config.json"),
      platformManifest: OTP_PINS.image.linuxAmd64,
      graphSha256:
        "0a9fc56c7c6c0112e248115b99226060bf88e5aa2afcd9f82091fd9e43b9f030",
    });

    expect(result).toEqual({
      image: OTP_PINS.image.index,
      platformManifest: OTP_PINS.image.linuxAmd64,
      configVersion: OTP_PINS.configVersion,
      graphSha256:
        "0a9fc56c7c6c0112e248115b99226060bf88e5aa2afcd9f82091fd9e43b9f030",
      otpVersion: OTP_PINS.otpVersion,
      privateNetwork: true,
      hostPorts: [],
      readOnly: true,
      memoryLimitBytes: 4_294_967_296,
      javaMaxHeapBytes: 3_221_225_472,
      healthPath: OTP_PINS.healthPath,
      graphqlPath: OTP_PINS.graphqlPath,
    });
  });

  it("fails closed when a host port, mutable image, or disabled health API appears", () => {
    const compose = json("compose.json") as Record<string, unknown>;
    const service = (compose.services as Record<string, unknown>).otp as Record<
      string,
      unknown
    >;
    const mutations = [
      { ...compose, services: { otp: { ...service, ports: ["8080:8080"] } } },
      {
        ...compose,
        services: {
          otp: {
            ...service,
            image: "docker.io/opentripplanner/opentripplanner:latest",
          },
        },
      },
    ];
    for (const changed of mutations) {
      expect(
        inspectOtpDeploymentFiles({
          compose: changed,
          otpConfig: json("otp-config.json"),
          platformManifest: OTP_PINS.image.linuxAmd64,
          graphSha256: "0".repeat(64),
        }),
      ).toBeNull();
    }
    expect(
      inspectOtpDeploymentFiles({
        compose,
        otpConfig: { otpFeatures: { ActuatorAPI: false } },
        platformManifest: OTP_PINS.image.linuxAmd64,
        graphSha256: "0".repeat(64),
      }),
    ).toBeNull();
  });
});

describe("OTP container health command", () => {
  it("uses the verified bash TCP seam and never assumes wget exists", () => {
    const compose = json("compose.json") as {
      services: { otp: { healthcheck: { test: unknown[] } } };
    };
    const command = compose.services.otp.healthcheck.test[1] as string;
    expect(command).toContain("/bin/bash -ec");
    expect(command).toContain("/dev/tcp/127.0.0.1/8080");
    expect(command).toContain(" 200 ");
    expect(command).not.toContain("wget");
  });
});
