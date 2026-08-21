/**
 * GET /api/public/changes — recent trusted-to-trusted change events (A8).
 *
 * Thin handler: newest-first, keyset-paged via an opaque cursor. Only event
 * metadata is published (slug, event type, timestamp) — the internal
 * before/after bodies never leave the server.
 */

import { PUBLIC_SCHEMA_VERSION } from "@/server/products/dto";
import {
  badRequest,
  jsonPublic,
} from "@/server/products/request-params";
import { InvalidCursorError, listChanges } from "@/server/products/queries";

export const dynamic = "force-dynamic";

const MAX_CHANGES_LIMIT = 100;

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;

  let limit = 20;
  const limitRaw = parameters.getAll("limit").at(-1);
  if (limitRaw !== undefined) {
    if (!/^\d+$/.test(limitRaw.trim())) {
      return badRequest("limit must be a non-negative integer");
    }
    const parsedLimit = Number.parseInt(limitRaw.trim(), 10);
    if (parsedLimit < 1 || parsedLimit > MAX_CHANGES_LIMIT) {
      return badRequest(`limit must be between 1 and ${MAX_CHANGES_LIMIT}`);
    }
    limit = parsedLimit;
  }

  let cursor: string | null = null;
  const cursorRaw = parameters.getAll("cursor").at(-1);
  if (cursorRaw !== undefined) {
    if (cursorRaw.trim() === "") {
      return badRequest("cursor must not be empty when provided");
    }
    cursor = cursorRaw;
  }

  try {
    const result = await listChanges({ cursor, limit });
    return jsonPublic({
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      items: result.items,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof InvalidCursorError) return badRequest(error.message);
    throw error;
  }
}
