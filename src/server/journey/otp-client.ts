import { isIP } from "node:net";

import { RouteEngineUnavailableError } from "@/domain/journey/route-engine";
import {
  createRouteEngine,
  type OtpPlanPort,
  type OtpPlanPortRequest,
} from "@/server/journey/route-engine";

const GRAPHQL_PATH = "/otp/gtfs/v1";
const MAXIMUM_RESPONSE_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;

const PLAN_QUERY = `query PlanCandidates(
  $origin: PlanLabeledLocationInput!
  $destination: PlanLabeledLocationInput!
  $departure: OffsetDateTime!
) {
  planConnection(
    origin: $origin
    destination: $destination
    dateTime: { earliestDeparture: $departure }
    first: 5
    modes: {
      transitOnly: true
      transit: {
        access: [WALK]
        egress: [WALK]
        transfer: [WALK]
        transit: [
          { mode: BUS }
          { mode: TRAM }
          { mode: SUBWAY }
          { mode: CABLE_CAR }
        ]
      }
    }
    preferences: {
      transit: { timetable: { excludeRealTimeUpdates: true } }
    }
  ) {
    edges {
      node {
        start
        end
        legs {
          mode
          startTime
          endTime
          distance
          from { name lat lon stop { gtfsId } }
          to { name lat lon stop { gtfsId } }
          legGeometry { points }
          route { gtfsId shortName longName color }
          trip { gtfsId }
          headsign
          intermediateStops { gtfsId }
        }
      }
    }
    routingErrors { code inputField }
  }
}`;

type Fetcher = (
  input: URL,
  init: RequestInit,
) => Promise<Response>;

function fail(): never {
  throw new RouteEngineUnavailableError();
}

function privateEndpoint(baseUrl: string | undefined): URL {
  if (!baseUrl) fail();
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    fail();
  }
  const hostname = base.hostname
    .replace(/^\[/u, "")
    .replace(/\]$/u, "")
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
    (hostname === "::1" || /^f[cd][0-9a-f]{2}:/iu.test(hostname));
  const internalDns =
    ipVersion === 0 &&
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname);
  if (
    (base.protocol !== "http:" && base.protocol !== "https:") ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== "" ||
    (base.pathname !== "" && base.pathname !== "/") ||
    (!privateIpv4 && !privateIpv6 && !internalDns)
  ) {
    fail();
  }
  return new URL(GRAPHQL_PATH, base);
}

async function cancelAndFail(response: Response): Promise<never> {
  try {
    await response.body?.cancel();
  } catch {
    // The public failure remains fixed even if the upstream stream cannot cancel.
  }
  fail();
}

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.ok) return await cancelAndFail(response);
  const contentType = response.headers.get("content-type");
  if (
    !contentType ||
    !/^application\/json(?:\s*;|$)/iu.test(contentType.trim())
  ) {
    return await cancelAndFail(response);
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(0|[1-9][0-9]*)$/u.test(contentLength) ||
      Number(contentLength) > MAXIMUM_RESPONSE_BYTES)
  ) {
    return await cancelAndFail(response);
  }
  if (!response.body) fail();

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAXIMUM_RESPONSE_BYTES) {
      await reader.cancel();
      fail();
    }
    chunks.push(next.value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    fail();
  }
}

export function createOtpPlanPort(input: {
  baseUrl?: string;
  fetcher?: Fetcher;
} = {}): OtpPlanPort {
  const endpoint = privateEndpoint(input.baseUrl ?? process.env.OTP_BASE_URL);
  const fetcher = input.fetcher ?? ((url, init) => fetch(url, init));
  return {
    async plan(request: OtpPlanPortRequest): Promise<unknown> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          cache: "no-store",
          redirect: "error",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            query: PLAN_QUERY,
            variables: {
              origin: {
                location: {
                  coordinate: {
                    latitude: request.origin.latitude,
                    longitude: request.origin.longitude,
                  },
                },
              },
              destination: {
                location: {
                  coordinate: {
                    latitude: request.destination.latitude,
                    longitude: request.destination.longitude,
                  },
                },
              },
              departure: request.departure,
            },
          }),
          signal: controller.signal,
        });
        return await boundedJson(response);
      } catch {
        fail();
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function createOtpRouteEngine(input: {
  baseUrl?: string;
  fetcher?: Fetcher;
  clock?: () => Date;
} = {}) {
  return createRouteEngine(createOtpPlanPort(input), { clock: input.clock });
}
