import { createHash } from "node:crypto";
import { isIP } from "node:net";

import { JourneyRequestInvalidError } from "@/domain/journey/journey";
import type {
  JourneyPlan,
  JourneyPlanner,
  JourneyRequest,
} from "@/domain/journey/journey";

export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_RATE_REQUESTS = 20;
const RATE_WINDOW_MS = 60_000;
const MAX_RATE_IDENTITIES = 10_000;
const MAX_RETRY_AFTER_SECONDS = 60;
const GLOBAL_RATE_IDENTITY = "global";
const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const SF_ROUTE_BOUNDS = {
  south: 37.68,
  north: 37.86,
  west: -122.58,
  east: -122.31,
};
const PLACE_ID_PATTERN =
  /^(stop|station|landmark):[^\s<>\u0000-\u001f\u007f]{1,160}$/u;

const invalidResponse = {
  available: false,
  code: "JOURNEY_REQUEST_INVALID",
  message: "Choose valid From and To places.",
} as const;

const unavailableResponse = {
  available: false,
  code: "JOURNEY_PLANNER_UNAVAILABLE",
  message: "Journey planning is unavailable right now.",
} as const;

const rateLimitedResponse = {
  available: false,
  code: "JOURNEY_RATE_LIMITED",
  message: "Please wait a moment and try again.",
} as const;

export type JourneyRateDecision = {
  allowed: boolean;
  retryAfterSeconds?: number;
};

export type JourneyRateGate = (
  request: Request,
) => JourneyRateDecision | Promise<JourneyRateDecision>;
type JourneysRouteDependencies = {
  getPlanner: () => JourneyPlanner | Promise<JourneyPlanner>;
  readPlannerFlag: () => string | undefined;
  admitRequest?: JourneyRateGate;
};

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: { ...noStoreHeaders, ...extraHeaders },
  });
}
function invalid() {
  return json(invalidResponse, 400);
}

function unavailable() {
  return json(unavailableResponse, 503);
}

function rateLimited(retryAfterSeconds = 1) {
  const bounded = Number.isSafeInteger(retryAfterSeconds)
    ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, retryAfterSeconds))
    : 1;
  return json(rateLimitedResponse, 429, { "Retry-After": String(bounded) });
}

function hashIdentity(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedIp(value: string | null) {
  if (
    value === null ||
    value.length > 64 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  let candidate = value.trim();
  if (candidate.startsWith("[") && candidate.endsWith("]")) {
    candidate = candidate.slice(1, -1);
  }
  return candidate !== "" && isIP(candidate) !== 0
    ? candidate.toLowerCase()
    : null;
}

function requestIdentity(request: Request) {
  const headers = [
    ["x-forwarded-for", true],
    ["x-real-ip", false],
    ["cf-connecting-ip", false],
    ["true-client-ip", false],
  ] as const;
  for (const [name, list] of headers) {
    const value = request.headers.get(name);
    const first = list ? (value?.split(",")[0] ?? null) : value;
    const ip = normalizedIp(first);
    if (ip) return ip;
  }
  return GLOBAL_RATE_IDENTITY;
}

export function createJourneyRateGate(
  options: { clock?: () => number; maxEntries?: number } = {},
): JourneyRateGate {
  const clock = options.clock ?? Date.now;
  const maxEntries = Number.isSafeInteger(options.maxEntries)
    ? Math.max(1, options.maxEntries!)
    : MAX_RATE_IDENTITIES;
  const counts = new Map<string, number[]>();
  const globalHash = hashIdentity(GLOBAL_RATE_IDENTITY);

  return (request) => {
    const nowValue = clock();
    const now = Number.isFinite(nowValue) ? nowValue : Date.now();
    const cutoff = now - RATE_WINDOW_MS;
    for (const [key, timestamps] of counts) {
      const active = timestamps.filter((timestamp) => timestamp > cutoff);
      if (active.length === 0) counts.delete(key);
      else counts.set(key, active);
    }

    let key = hashIdentity(requestIdentity(request));
    if (!counts.has(key) && counts.size >= maxEntries) {
      key = globalHash;
      if (!counts.has(globalHash) && counts.size >= maxEntries) {
        return { allowed: false, retryAfterSeconds: 1 };
      }
    }
    const timestamps = counts.get(key) ?? [];
    if (timestamps.length >= MAX_RATE_REQUESTS) {
      const oldest = timestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + RATE_WINDOW_MS - now) / 1_000),
        ),
      };
    }
    timestamps.push(now);
    counts.set(key, timestamps);
    return { allowed: true };
  };
}

function isJsonContentType(value: string | null) {
  return value !== null && /^application\/json(?:\s*;|$)/iu.test(value.trim());
}

function declaredLength(value: string | null): number | null {
  if (value === null) return 0;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) return null;
  const length = Number(value);
  if (!Number.isSafeInteger(length) || length > MAX_REQUEST_BYTES) return null;
  return length;
}

async function cancel(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // A malformed request remains a fixed public 400 even if cancellation fails.
  }
}

async function readBody(request: Request): Promise<string | null> {
  const length = declaredLength(request.headers.get("content-length"));
  if (length === null || length > MAX_REQUEST_BYTES) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      if (!(next.value instanceof Uint8Array)) {
        await cancel(reader);
        return null;
      }
      total += next.value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await cancel(reader);
        return null;
      }
      chunks.push(next.value);
    }
  } catch {
    await cancel(reader);
    return null;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function duplicateJsonKey(source: string) {
  let offset = 0;

  function whitespace() {
    while (offset < source.length && /\s/u.test(source[offset]!)) offset += 1;
  }

  function stringToken(): string | null {
    const start = offset;
    if (source[offset] !== '"') return null;
    offset += 1;
    while (offset < source.length) {
      const character = source[offset]!;
      if (character === '"') {
        offset += 1;
        try {
          const value: unknown = JSON.parse(source.slice(start, offset));
          return typeof value === "string" ? value : null;
        } catch {
          return null;
        }
      }
      if (character === "\\") {
        offset += 2;
        continue;
      }
      if (character < " ") return null;
      offset += 1;
    }
    return null;
  }

  function value(depth: number): boolean {
    if (depth > 128) return false;
    whitespace();
    const character = source[offset];
    if (character === '"') return stringToken() === null ? false : false;
    if (character === "{") return object(depth + 1);
    if (character === "[") return array(depth + 1);
    if (character === undefined) return false;
    while (offset < source.length && !/[\s,\]}]/u.test(source[offset]!)) {
      offset += 1;
    }
    return false;
  }

  function object(depth: number): boolean {
    offset += 1;
    whitespace();
    const keys = new Set<string>();
    if (source[offset] === "}") {
      offset += 1;
      return false;
    }
    while (offset < source.length) {
      const key = stringToken();
      if (key === null) return false;
      if (keys.has(key)) return true;
      keys.add(key);
      whitespace();
      if (source[offset] !== ":") return false;
      offset += 1;
      if (value(depth)) return true;
      whitespace();
      if (source[offset] === "}") {
        offset += 1;
        return false;
      }
      if (source[offset] !== ",") return false;
      offset += 1;
      whitespace();
    }
    return false;
  }

  function array(depth: number): boolean {
    offset += 1;
    whitespace();
    if (source[offset] === "]") {
      offset += 1;
      return false;
    }
    while (offset < source.length) {
      if (value(depth)) return true;
      whitespace();
      if (source[offset] === "]") {
        offset += 1;
        return false;
      }
      if (source[offset] !== ",") return false;
      offset += 1;
      whitespace();
    }
    return false;
  }

  return value(0);
}

function parseJson(source: string): unknown | null {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    return null;
  }
  return duplicateJsonKey(source) ? null : value;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const present = Object.keys(value);
  return (
    present.length === keys.length && keys.every((key) => present.includes(key))
  );
}

function safeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function place(value: unknown): JourneyRequest["origin"] | null {
  if (!record(value) || typeof value.type !== "string") return null;
  if (value.type === "catalog") {
    if (
      !exactKeys(value, ["type", "placeId"]) ||
      !safeText(value.placeId, 160) ||
      !PLACE_ID_PATTERN.test(value.placeId)
    ) {
      return null;
    }
    return { type: "catalog", placeId: value.placeId };
  }
  if (value.type !== "current_location") return null;
  if (
    !exactKeys(value, ["type", "latitude", "longitude", "accuracyMeters"]) ||
    !finiteNumber(value.latitude) ||
    !finiteNumber(value.longitude) ||
    !finiteNumber(value.accuracyMeters) ||
    value.latitude < SF_ROUTE_BOUNDS.south ||
    value.latitude > SF_ROUTE_BOUNDS.north ||
    value.longitude < SF_ROUTE_BOUNDS.west ||
    value.longitude > SF_ROUTE_BOUNDS.east ||
    value.accuracyMeters < 0 ||
    value.accuracyMeters > 1_000
  ) {
    return null;
  }
  return {
    type: "current_location",
    latitude: value.latitude,
    longitude: value.longitude,
    accuracyMeters: value.accuracyMeters,
  };
}

function requestValue(value: unknown): JourneyRequest | null {
  if (
    !record(value) ||
    !exactKeys(value, ["origin", "destination", "departureAt"])
  ) {
    return null;
  }
  const origin = place(value.origin);
  const destination = place(value.destination);
  if (!origin || !destination || !safeText(value.departureAt, 128)) {
    return null;
  }
  return { origin, destination, departureAt: value.departureAt };
}

function isJourneyRequestInvalidError(error: unknown) {
  return error instanceof JourneyRequestInvalidError;
}

export function createJourneysPost(dependencies: JourneysRouteDependencies) {
  return async function POST(request: Request): Promise<Response> {
    try {
      if (dependencies.readPlannerFlag() !== "true") return unavailable();
      if (!isJsonContentType(request.headers.get("content-type"))) {
        return invalid();
      }
      const text = await readBody(request);
      if (text === null) return invalid();
      const parsed = requestValue(parseJson(text));
      if (!parsed) return invalid();

      if (dependencies.admitRequest) {
        let decision: JourneyRateDecision | null = null;
        try {
          decision = await dependencies.admitRequest(request);
        } catch {
          return rateLimited();
        }
        if (decision?.allowed !== true) {
          return rateLimited(decision?.retryAfterSeconds);
        }
      }
      const planner = await dependencies.getPlanner();
      const result: JourneyPlan = await planner.plan(parsed);
      return json(result);
    } catch (error) {
      if (isJourneyRequestInvalidError(error)) return invalid();
      return unavailable();
    }
  };
}

export const POST = createJourneysPost({
  getPlanner: async () => {
    const { getJourneyPlanner } =
      await import("@/server/journey/journey-runtime");
    return getJourneyPlanner();
  },
  readPlannerFlag: () => process.env.CITYWIDE_PLANNER_ENABLED,
  admitRequest: createJourneyRateGate(),
});
