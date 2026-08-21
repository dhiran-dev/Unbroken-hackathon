/**
 * GET /api/public/search — free-text search over trusted products (A8).
 *
 * Thin handler: `q` is required; every other parameter matches the shared
 * product-list surface (category, caffeine range, sort, cursor, limit, …).
 * Searching touches names and aliases of TRUSTED products only.
 */

import { PUBLIC_SCHEMA_VERSION, toPublicProductDto } from "@/server/products/dto";
import {
  badRequest,
  jsonPublic,
  parseProductListQuery,
} from "@/server/products/request-params";
import { InvalidCursorError, searchProducts } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const query = (parameters.getAll("q").at(-1) ?? "").trim();
  if (query === "") {
    return badRequest("q is required and must not be empty");
  }

  const parsed = parseProductListQuery(parameters);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const result = await searchProducts(query, parsed.value);
    return jsonPublic({
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      query,
      items: result.items.map((row) => toPublicProductDto(row)),
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof InvalidCursorError) return badRequest(error.message);
    throw error;
  }
}
