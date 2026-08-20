import { isCommuteSlot, type CommuteSlot } from "@/domain/commute/schedule";
import type { CommuteEmail } from "@/emails/commute-email";
import { createCommuteEmailPreview } from "@/server/commutes/email-preview";
import type { CurrentRider } from "@/server/commutes/runtime";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const authResponse = {
  code: "COMMUTE_AUTH_REQUIRED",
  message: "Sign in with Google to manage your trips.",
} as const;
const invalidResponse = {
  code: "COMMUTE_INVALID",
  message: "Check your trip details and try again.",
} as const;
const csrfResponse = {
  code: "COMMUTE_CSRF_FORBIDDEN",
  message: "This request could not be verified. Try again.",
} as const;
const unavailableResponse = {
  code: "COMMUTE_UNAVAILABLE",
  message: "Your trips are unavailable right now.",
} as const;
const rateLimitedResponse = {
  code: "COMMUTE_PREVIEW_RATE_LIMITED",
  message: "Please wait a moment and try again.",
} as const;

const MAX_JSON_BODY_BYTES = 64 * 1024;
const MAX_SUBJECT_LENGTH = 160;
const MAX_TEXT_LENGTH = 4_000;
const MAX_HTML_LENGTH = 200_000;
const INTERNAL_WORDS =
  /\b(?:fingerprint|reason|provider|outbox|queue|worker|collector|gtfs|otp|graphql|schema|protobuf|job|token|secret|operational)\b/iu;
const PREVIEW_RATE_WINDOW_MS = 60_000;
const PREVIEW_RATE_MAX_REQUESTS = 5;
const PREVIEW_RATE_MAX_ENTRIES = 10_000;

type RouteContext = { params: Promise<{ slot: string }> };
export type PreviewRateDecision =
  { allowed: true } | { allowed: false; retryAfterSeconds?: number };
export type PreviewRateGate = (
  userId: string,
) => PreviewRateDecision | Promise<PreviewRateDecision>;

export type CommutePreviewer = {
  previewForRider(
    userId: string,
    slot: CommuteSlot,
  ): Promise<CommuteEmail | null>;
};

export type CommutePreviewRouteDependencies = {
  readRider: (request: Request) => Promise<CurrentRider | null>;
  preview: CommutePreviewer;
  admitPreview?: PreviewRateGate;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
}

function rateLimited(retryAfterSeconds: unknown) {
  const seconds =
    typeof retryAfterSeconds === "number" &&
    Number.isSafeInteger(retryAfterSeconds)
      ? Math.min(60, Math.max(1, retryAfterSeconds))
      : 1;
  return new Response(JSON.stringify(rateLimitedResponse), {
    status: 429,
    headers: {
      ...noStoreHeaders,
      "Content-Type": "application/json",
      "Retry-After": String(seconds),
    },
  });
}

function exactRateDecision(value: unknown): PreviewRateDecision | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (candidate.allowed === true && keys.length === 1) {
    return { allowed: true };
  }
  if (
    candidate.allowed !== false ||
    keys.some((key) => key !== "allowed" && key !== "retryAfterSeconds") ||
    (candidate.retryAfterSeconds !== undefined &&
      (!Number.isSafeInteger(candidate.retryAfterSeconds) ||
        (candidate.retryAfterSeconds as number) < 1))
  ) {
    return null;
  }
  return {
    allowed: false,
    ...(candidate.retryAfterSeconds === undefined
      ? {}
      : { retryAfterSeconds: candidate.retryAfterSeconds as number }),
  };
}

export function createCommutePreviewRateGate(
  options: {
    clock?: () => number;
    maxRequests?: number;
    windowMs?: number;
    maxEntries?: number;
  } = {},
): PreviewRateGate {
  const clock = options.clock ?? Date.now;
  const maxRequests =
    typeof options.maxRequests === "number" &&
    Number.isSafeInteger(options.maxRequests) &&
    options.maxRequests > 0
      ? options.maxRequests
      : PREVIEW_RATE_MAX_REQUESTS;
  const windowMs =
    typeof options.windowMs === "number" &&
    Number.isSafeInteger(options.windowMs) &&
    options.windowMs > 0
      ? options.windowMs
      : PREVIEW_RATE_WINDOW_MS;
  const maxEntries =
    typeof options.maxEntries === "number" &&
    Number.isSafeInteger(options.maxEntries) &&
    options.maxEntries > 0
      ? options.maxEntries
      : PREVIEW_RATE_MAX_ENTRIES;
  const requests = new Map<string, number[]>();

  return (userId) => {
    const nowValue = clock();
    const now = Number.isFinite(nowValue) ? nowValue : Date.now();
    const cutoff = now - windowMs;
    for (const [key, timestamps] of requests) {
      const active = timestamps.filter((timestamp) => timestamp > cutoff);
      if (active.length === 0) requests.delete(key);
      else requests.set(key, active);
    }
    if (!requests.has(userId) && requests.size >= maxEntries) {
      return { allowed: false, retryAfterSeconds: 1 };
    }
    const timestamps = requests.get(userId) ?? [];
    if (timestamps.length >= maxRequests) {
      const oldest = timestamps[0] ?? now;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((oldest + windowMs - now) / 1_000),
        ),
      };
    }
    timestamps.push(now);
    requests.set(userId, timestamps);
    return { allowed: true };
  };
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

function isRider(value: CurrentRider | null): value is CurrentRider {
  return Boolean(
    value &&
    value.role === "rider" &&
    typeof value.userId === "string" &&
    value.userId.length > 0 &&
    value.userId.length <= 255 &&
    value.userId === value.userId.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value.userId),
  );
}

async function readEmptyJsonObject(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^\d+$/u.test(contentLength) ||
      Number(contentLength) > MAX_JSON_BODY_BYTES)
  ) {
    return false;
  }
  if (!request.body) return false;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      totalBytes += next.value.byteLength;
      if (totalBytes > MAX_JSON_BODY_BYTES) {
        await reader.cancel();
        return false;
      }
      chunks.push(next.value);
    }
  } catch {
    return false;
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    );
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    );
  } catch {
    return false;
  }
}

function publicPreview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const candidate = value as {
    subject?: unknown;
    html?: unknown;
    text?: unknown;
  };
  if (
    typeof candidate.subject !== "string" ||
    typeof candidate.html !== "string" ||
    typeof candidate.text !== "string" ||
    candidate.subject.length === 0 ||
    candidate.subject.length > MAX_SUBJECT_LENGTH ||
    candidate.subject !== candidate.subject.trim() ||
    candidate.html.length === 0 ||
    candidate.html.length > MAX_HTML_LENGTH ||
    candidate.text.length === 0 ||
    candidate.text.length > MAX_TEXT_LENGTH ||
    /[<>\u0000-\u001f\u007f]/u.test(candidate.subject) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.text) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.html) ||
    INTERNAL_WORDS.test(candidate.subject) ||
    INTERNAL_WORDS.test(candidate.html) ||
    INTERNAL_WORDS.test(candidate.text)
  ) {
    return null;
  }
  return { subject: candidate.subject, text: candidate.text };
}

export function createCommutePreviewPost(
  dependencies: CommutePreviewRouteDependencies,
) {
  return async function POST(request: Request, context: RouteContext) {
    let rider: CurrentRider | null;
    try {
      rider = await dependencies.readRider(request);
    } catch {
      return json(authResponse, 401);
    }
    if (!isRider(rider)) return json(authResponse, 401);
    if (!sameOriginMutation(request)) return json(csrfResponse, 403);
    if (!isJsonRequest(request)) return json(invalidResponse, 400);

    let slot: string;
    try {
      slot = (await context.params).slot;
    } catch {
      return json(invalidResponse, 400);
    }
    if (!isCommuteSlot(slot)) return json(invalidResponse, 400);
    if (!(await readEmptyJsonObject(request))) {
      return json(invalidResponse, 400);
    }
    if (dependencies.admitPreview) {
      let decision: PreviewRateDecision | null;
      try {
        decision = exactRateDecision(
          await dependencies.admitPreview(rider.userId),
        );
      } catch {
        return json(unavailableResponse, 503);
      }
      if (!decision) return json(unavailableResponse, 503);
      if (!decision.allowed) {
        return rateLimited(decision.retryAfterSeconds);
      }
    }

    try {
      const result = await dependencies.preview.previewForRider(
        rider.userId,
        slot,
      );
      const safe = publicPreview(result);
      if (!safe) return json(unavailableResponse, 503);
      return json(safe);
    } catch {
      return json(unavailableResponse, 503);
    }
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const [
      { readCurrentRider, getCommuteService },
      { getTransitCatalog },
      { getJourneyPlanner },
      { publicEnv },
    ] = await Promise.all([
      import("@/server/commutes/runtime"),
      import("@/server/transit/catalog"),
      import("@/server/journey/journey-runtime"),
      import("@/lib/env"),
    ]);
    const preview = createCommuteEmailPreview({
      schedules: await getCommuteService(),
      catalog: getTransitCatalog(),
      planner: await getJourneyPlanner(),
      appOrigin: publicEnv.NEXT_PUBLIC_APP_URL,
    });
    return createCommutePreviewPost({
      readRider: readCurrentRider,
      preview,
      admitPreview: productionPreviewRateGate,
    })(request, context);
  } catch {
    return json(unavailableResponse, 503);
  }
}

const productionPreviewRateGate = createCommutePreviewRateGate();
