/**
 * GET /api/public/leaderboards?board=<key> — immutable leaderboard snapshots
 * with exact server-side filters and opaque cursor pagination (A8).
 *
 * Thin handler: entries come from the most recent leaderboard snapshot for
 * `board` (metric key), ordered by rank. Eligibility flags ride along so the
 * frontend can explain WHY an entry is or is not rankable. No snapshot at all
 * is a 404 — the endpoint never computes a board on the fly.
 */

import {
  PUBLIC_SCHEMA_VERSION,
  toPublicProductDto,
  type PublicProductDto,
} from "@/server/products/dto";
import { CANONICAL_CATEGORIES } from "@/server/ingestion/normalize";
import {
  badRequest,
  jsonPublic,
  notFound,
} from "@/server/products/request-params";
import {
  getLeaderboard,
  getTrustedProductsBySlugs,
  InvalidCursorError,
} from "@/server/products/queries";

export const dynamic = "force-dynamic";

const MAX_LEADERBOARD_LIMIT = 200;
const SERVING_FORMS = [
  "drink",
  "concentrate",
  "mix",
  "food",
  "supplement",
  "item",
  "unknown",
] as const;

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const board = (parameters.getAll("board").at(-1) ?? "").trim();
  if (board === "") {
    return badRequest("board is required and must not be empty");
  }

  let limit = 25;
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

  const cursorRaw = parameters.getAll("cursor").at(-1);
  if (cursorRaw !== undefined && cursorRaw.trim() === "") {
    return badRequest("cursor must not be empty when provided");
  }

  const servingRaw = parameters.getAll("serving").at(-1)?.trim();
  if (
    servingRaw !== undefined &&
    !(SERVING_FORMS as readonly string[]).includes(servingRaw)
  ) {
    return badRequest(`serving must be one of ${SERVING_FORMS.join("|")}`);
  }

  const completeRaw = parameters.getAll("complete").at(-1);
  if (completeRaw !== undefined && !["0", "1"].includes(completeRaw.trim())) {
    return badRequest("complete must be 0 or 1");
  }

  let leaderboard;
  try {
    leaderboard = await getLeaderboard(board, {
      limit,
      cursor: cursorRaw ?? null,
      category: categoryRaw as
        | (typeof CANONICAL_CATEGORIES)[number]
        | undefined,
      servingForm: servingRaw,
      completeOnly: completeRaw === undefined ? false : completeRaw.trim() === "1",
    });
  } catch (error) {
    if (error instanceof InvalidCursorError) return badRequest(error.message);
    throw error;
  }
  if (!leaderboard) {
    return notFound(
      "NO_LEADERBOARD_SNAPSHOT",
      "no leaderboard snapshot has been built yet",
    );
  }

  const productRows = await getTrustedProductsBySlugs(
    leaderboard.entries.map((entry) => entry.product.slug),
  );
  const products: Record<string, PublicProductDto> = {};
  for (const row of productRows) {
    const product = toPublicProductDto(row);
    products[product.slug] = product;
  }

  return jsonPublic({
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    snapshotId: leaderboard.snapshotId,
    rebuiltAt: leaderboard.rebuiltAt.toISOString(),
    boardKey: leaderboard.boardKey,
    trustedProductCount: leaderboard.trustedProductCount,
    eligibleCount: leaderboard.eligibleCount,
    excludedCount: leaderboard.excludedCount,
    totalCount: leaderboard.totalCount,
    nextCursor: leaderboard.nextCursor,
    entries: leaderboard.entries,
    products,
  });
}
