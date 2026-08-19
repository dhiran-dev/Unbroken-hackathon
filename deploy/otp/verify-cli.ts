import { readFile } from "node:fs/promises";
import { isIP } from "node:net";

import {
  createOtpPlanRequest,
  createOtpWheelchairProbeRequest,
  verifyOtpDeployment,
  type OtpVerificationResult,
} from "./contract";
import { inspectOtpDeploymentFiles } from "./deployment-files";

const SAFE_FAILURE: OtpVerificationResult = {
  ready: false,
  code: "SERVICE_NOT_READY",
  message: "Current updates are unavailable.",
};

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required ${name}.`);
  return value;
}

export function privateBaseUrl(value: string) {
  const url = new URL(value);
  const hostname = url.hostname
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
  const ipVersion = isIP(hostname);
  const octets = ipVersion === 4 ? hostname.split(".").map(Number) : [];
  const privateIpv4 =
    ipVersion === 4 &&
    (octets[0] === 10 ||
      (octets[0] === 172 &&
        octets[1] !== undefined &&
        octets[1] >= 16 &&
        octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168) ||
      octets[0] === 127);
  const privateIpv6 =
    ipVersion === 6 &&
    (hostname === "::1" || /^f[cd][0-9a-f]{2}:/i.test(hostname));
  const internalDns =
    ipVersion === 0 && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname);
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (!privateIpv4 && !privateIpv6 && !internalDns)
  ) {
    throw new Error("The private OTP base URL is invalid.");
  }
  return url;
}

async function jsonFile(path: string, maximumBytes: number) {
  const value = await readFile(path, "utf8");
  if (Buffer.byteLength(value) > maximumBytes) {
    throw new Error("A verification input is too large.");
  }
  return JSON.parse(value) as unknown;
}

async function fetchJson(
  url: URL,
  init?: RequestInit,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (Buffer.byteLength(text) > 2 * 1024 * 1024) {
    throw new Error("The OTP verification response is too large.");
  }
  return {
    statusCode: response.status,
    body: text.length === 0 ? null : (JSON.parse(text) as unknown),
  };
}

export async function runOtpVerification(): Promise<OtpVerificationResult> {
  try {
    const baseUrl = privateBaseUrl(required("OTP_BASE_URL"));
    const manifestPath = required("OTP_GRAPH_MANIFEST_PATH");
    const platformManifest = required("OTP_PLATFORM_MANIFEST");
    const serviceDateTime = required("OTP_SERVICE_DATETIME");
    const manifest = await jsonFile(manifestPath, 64 * 1024);
    const compose = await jsonFile(
      new URL("./compose.json", import.meta.url).pathname,
      64 * 1024,
    );
    const otpConfig = await jsonFile(
      new URL("./otp-config.json", import.meta.url).pathname,
      64 * 1024,
    );
    if (
      manifest === null ||
      typeof manifest !== "object" ||
      !("graph" in manifest) ||
      manifest.graph === null ||
      typeof manifest.graph !== "object" ||
      !("sha256" in manifest.graph) ||
      typeof manifest.graph.sha256 !== "string"
    ) {
      return SAFE_FAILURE;
    }
    const service = inspectOtpDeploymentFiles({
      compose,
      otpConfig,
      platformManifest,
      graphSha256: manifest.graph.sha256,
    });
    if (!service) return SAFE_FAILURE;
    const health = await fetchJson(new URL(service.healthPath, baseUrl));
    const request = createOtpPlanRequest(serviceDateTime);
    const wheelchairRequest = createOtpWheelchairProbeRequest(serviceDateTime);
    const plan = await fetchJson(new URL(request.path, baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.body),
    });
    const wheelchairProbe = await fetchJson(
      new URL(wheelchairRequest.path, baseUrl),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(wheelchairRequest.body),
      },
    );
    return verifyOtpDeployment({
      manifest,
      service,
      health,
      serviceDateTime,
      plan,
      wheelchairProbe,
    });
  } catch {
    return SAFE_FAILURE;
  }
}

if (import.meta.main) {
  const result = await runOtpVerification();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ready) process.exitCode = 1;
}
