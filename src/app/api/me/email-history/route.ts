import type { CurrentRider } from "@/server/commutes/runtime";
import {
  createEmailHistoryReader,
  normalizeEmailHistoryRows,
  PostgresEmailHistoryStore,
  type EmailHistoryReader,
} from "@/server/commutes/email-history";

export const dynamic = "force-dynamic";

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
};
const authResponse = {
  code: "COMMUTE_AUTH_REQUIRED",
  message: "Sign in with Google to manage your trips.",
} as const;
const unavailableResponse = {
  code: "COMMUTE_UNAVAILABLE",
  message: "Your trips are unavailable right now.",
} as const;

export type EmailHistoryRouteDependencies = {
  readRider: (request: Request) => Promise<CurrentRider | null>;
  history: EmailHistoryReader;
};

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: noStoreHeaders });
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

export function createEmailHistoryGet(
  dependencies: EmailHistoryRouteDependencies,
) {
  return async function GET(request: Request) {
    let rider: CurrentRider | null;
    try {
      rider = await dependencies.readRider(request);
    } catch {
      return json(authResponse, 401);
    }
    if (!isRider(rider)) return json(authResponse, 401);

    try {
      const rows = await dependencies.history.listForRider(rider.userId);
      const deliveries = normalizeEmailHistoryRows(rows);
      if (!deliveries) return json(unavailableResponse, 503);
      return json({ deliveries });
    } catch {
      return json(unavailableResponse, 503);
    }
  };
}

const productionHistory = createEmailHistoryReader(
  new PostgresEmailHistoryStore(),
);

export async function GET(request: Request) {
  try {
    const { readCurrentRider } = await import("@/server/commutes/runtime");
    return createEmailHistoryGet({
      readRider: readCurrentRider,
      history: productionHistory,
    })(request);
  } catch {
    return json(unavailableResponse, 503);
  }
}
