import { OTP_PINS, type OtpServiceEvidence } from "./contract";

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

export function inspectOtpDeploymentFiles(input: {
  compose: unknown;
  otpConfig: unknown;
  platformManifest: string;
  graphSha256: string;
}): OtpServiceEvidence | null {
  if (
    !isRecord(input.compose) ||
    !isRecord(input.compose.services) ||
    !exactKeys(input.compose.services, ["otp"]) ||
    !isRecord(input.compose.networks) ||
    !isRecord(input.compose.networks.otp_private) ||
    input.compose.networks.otp_private.internal !== true ||
    !isRecord(input.otpConfig) ||
    !exactKeys(input.otpConfig, ["otpFeatures"]) ||
    !isRecord(input.otpConfig.otpFeatures) ||
    !exactKeys(input.otpConfig.otpFeatures, ["ActuatorAPI", "DebugUi"]) ||
    input.otpConfig.otpFeatures.ActuatorAPI !== true ||
    input.otpConfig.otpFeatures.DebugUi !== false
  ) {
    return null;
  }
  const service = input.compose.services.otp;
  if (!isRecord(service)) return null;
  const environment = service.environment;
  const labels = service.labels;
  const healthcheck = service.healthcheck;
  if (
    service.image !== OTP_PINS.image.index ||
    "ports" in service ||
    !Array.isArray(service.expose) ||
    service.expose.length !== 1 ||
    service.expose[0] !== "8080" ||
    !Array.isArray(service.networks) ||
    service.networks.length !== 1 ||
    service.networks[0] !== "otp_private" ||
    service.read_only !== true ||
    service.mem_limit !== "4g" ||
    !Array.isArray(service.command) ||
    service.command.join(" ") !== "--load --serve" ||
    !Array.isArray(service.volumes) ||
    service.volumes.length !== 1 ||
    typeof service.volumes[0] !== "string" ||
    !service.volumes[0].includes("OTP_STATE_DIR") ||
    !service.volumes[0].endsWith(":/var/opentripplanner:ro") ||
    !isRecord(environment) ||
    environment.JAVA_TOOL_OPTIONS !==
      "-Xms512m -Xmx3g -XX:+ExitOnOutOfMemoryError" ||
    !isRecord(labels) ||
    labels["org.unbroken.otp.version"] !== OTP_PINS.otpVersion ||
    labels["org.unbroken.otp.config-version"] !== OTP_PINS.configVersion ||
    labels["org.unbroken.otp.health-path"] !== OTP_PINS.healthPath ||
    labels["org.unbroken.otp.graphql-path"] !== OTP_PINS.graphqlPath ||
    !isRecord(healthcheck) ||
    !Array.isArray(healthcheck.test) ||
    healthcheck.test.length !== 2 ||
    typeof healthcheck.test[1] !== "string" ||
    !healthcheck.test[1].includes(OTP_PINS.healthPath) ||
    !healthcheck.test[1].includes("/bin/bash -ec") ||
    !healthcheck.test[1].includes("/dev/tcp/127.0.0.1/8080") ||
    !healthcheck.test[1].includes('*" 200 "*') ||
    healthcheck.test[1].includes("wget") ||
    !/^[a-f0-9]{64}$/.test(input.graphSha256) ||
    (input.platformManifest !== OTP_PINS.image.linuxAmd64 &&
      input.platformManifest !== OTP_PINS.image.linuxArm64)
  ) {
    return null;
  }
  return {
    image: OTP_PINS.image.index,
    platformManifest: input.platformManifest,
    configVersion: OTP_PINS.configVersion,
    graphSha256: input.graphSha256,
    otpVersion: OTP_PINS.otpVersion,
    privateNetwork: true,
    hostPorts: [],
    readOnly: true,
    memoryLimitBytes: 4_294_967_296,
    javaMaxHeapBytes: 3_221_225_472,
    healthPath: OTP_PINS.healthPath,
    graphqlPath: OTP_PINS.graphqlPath,
  };
}
