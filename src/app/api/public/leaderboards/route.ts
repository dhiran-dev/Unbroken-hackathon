/**
 * GET /api/public/leaderboards?board=<key> — immutable leaderboard snapshots (A8).
 *
 * Thin handler: entries come from the most recent leaderboard snapshot for
 * `board` (metric key), ordered by rank. Eligibility flags ride along so the
 * frontend can explain WHY an entry is or is not rankable. No snapshot at all
 * is a 404 — the endpoint never computes a board on the fly.
 */

import { PUBLIC_SCHEMA_VERSION } from "@/server/products/dto";
import { CANONICAL_CATEGORIES } from "@/server/ingestion/normalize";
import {
  badRequest,
  jsonPublic,
  notFound,
} from "@/server/products/request-params";
import { getLeaderboard } from "@/server/products/queries";

export const dynamic = "force-dynamic";

const MAX_LEADERBOARD_LIMIT = 200;

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const board = (parameters.getAll("board").at(-1) ?? "").trim();
  if (board === "") {
    return badRequest("board is required and must not be empty");
  }

  let limit = 50;
  const limitRaw = parameters.getAll("limit").at(-1);
  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw.trim())) {
      return badRequest("limit must be a non-negative integer");
    }
    const parsedLimit = Number.parseInt(limitRaw.trim(), 10);
    if (parsedLimit < 1 || parsedLimit > MAX_LEADERBOARD_LIMIT) {
      return badRequest(
        `limit must be between 1 and ${MAX_LEADERBOARD_LIMIT}`,
      );
    }
    limit = parsedLimit;
  }

  const categoryRaw = parameters.getAll("category").at(-1)?.trim();
  if (
    categoryRaw !== undefined &&
    !(CANONICAL_CATEGORIES as readonly string[]).includes(categoryRaw)
  ) {
    return badRequest(`category must be one of ${CANONICAL_CATEGORIES.join("|")}`);
  }

  const leaderboard = await getLeaderboard(
    board,
    limit,
    categoryRaw as (typeof CANONICAL_CATEGORIES)[number] | undefined,
  );
  if (!leaderboard) {
    return notFound(
      "NO_LEADERBOARD_SNAPSHOT",
      "no leaderboard snapshot has been built yet",
    );
  }

  return jsonPublic({
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    snapshotId: leaderboard.snapshotId,
    rebuiltAt: leaderboard.rebuiltAt.toISOString(),
    boardKey: leaderboard.boardKey,
    trustedProductCount: leaderboard.trustedProductCount,
    eligibleCount: leaderboard.eligibleCount,
    excludedCount: leaderboard.excludedCount,
    entries: leaderboard.entries,
  });
}
