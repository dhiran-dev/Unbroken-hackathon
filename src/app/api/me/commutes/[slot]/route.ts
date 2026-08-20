import type { CommuteService } from "@/domain/commute/service";
import { isCommuteSlot } from "@/domain/commute/schedule";
import type { CurrentRider } from "@/server/commutes/runtime";

export const dynamic = "force-dynamic";

const noStoreHeaders = { "Cache-Control": "no-store, max-age=0" };
const invalidResponse = {
  code: "COMMUTE_INVALID",
  message: "Check your trip details and try again.",
} as const;
const csrfResponse = {
  code: "COMMUTE_CSRF_FORBIDDEN",
  message: "This request could not be verified. Try again.",
} as const;
const authResponse = {
  code: "COMMUTE_AUTH_REQUIRED",
  message: "Sign in with Google to manage your trips.",
} as const;
const unavailableResponse = {
  code: "COMMUTE_UNAVAILABLE",
  message: "Your trips are unavailable right now.",
} as const;

type RouteContext = { params: Promise<{ slot: string }> };
type CommuteRouteDependencies = {
  readRider: (request: Request) => Promise<CurrentRider | null>;
  service: CommuteService;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function sameOriginMutation(request: Request) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if (!origin || fetchSite === "cross-site") return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isJsonRequest(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0];
  return contentType?.trim().toLowerCase() === "application/json";
}

const MAX_JSON_BODY_BYTES = 64 * 1024;
type JsonBodyResult = { ok: true; value: unknown } | { ok: false };

async function readJson(request: Request): Promise<JsonBodyResult> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (
      !/^\d+$/u.test(contentLength) ||
      Number(contentLength) > MAX_JSON_BODY_BYTES
    ) {
      return { ok: false };
    }
  }

  const body = request.body;
  if (!body) return { ok: false };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        return { ok: false };
      }
      chunks.push(next.value);
    }
  } catch {
    return { ok: false };
  } finally {
    reader.releaseLock();
  }

  if (totalBytes === 0) return { ok: false };
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false };
  }
}

export function createCommutePut(dependencies: CommuteRouteDependencies) {
  return async function PUT(request: Request, context: RouteContext) {
    const rider = await dependencies.readRider(request);
    if (!rider) return json(authResponse, 401);
    if (!sameOriginMutation(request)) return json(csrfResponse, 403);
    if (!isJsonRequest(request)) return json(invalidResponse, 400);
    const { slot } = await context.params;
    if (!isCommuteSlot(slot)) return json(invalidResponse, 400);
    const body = await readJson(request);
    if (!body.ok) return json(invalidResponse, 400);
    try {
      const result = await dependencies.service.replaceForRider(
        rider.userId,
        slot,
        body.value,
      );
      if (!result.ok) return json(invalidResponse, 400);
      return json({ commute: result.value });
    } catch {
      return json(unavailableResponse, 503);
    }
  };
}

export function createCommuteDelete(dependencies: CommuteRouteDependencies) {
  return async function DELETE(request: Request, context: RouteContext) {
    const rider = await dependencies.readRider(request);
    if (!rider) return json(authResponse, 401);
    if (!sameOriginMutation(request)) return json(csrfResponse, 403);
    const { slot } = await context.params;
    if (!isCommuteSlot(slot)) return json(invalidResponse, 400);
    try {
      await dependencies.service.deleteForRider(rider.userId, slot);
      return json({ deleted: true, slot });
    } catch {
      return json(unavailableResponse, 503);
    }
  };
}

export async function PUT(request: Request, context: RouteContext) {
  const [{ readCurrentRider, getCommuteService }] = await Promise.all([
    import("@/server/commutes/runtime"),
  ]);
  return createCommutePut({
    readRider: readCurrentRider,
    service: await getCommuteService(),
  })(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  const [{ readCurrentRider, getCommuteService }] = await Promise.all([
    import("@/server/commutes/runtime"),
  ]);
  return createCommuteDelete({
    readRider: readCurrentRider,
    service: await getCommuteService(),
  })(request, context);
}
