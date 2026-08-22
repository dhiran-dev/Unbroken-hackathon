/**
 * GET /api/public/products — trusted-only product listing (A8).
 *
 * Thin handler: parse → query → map → JSON. Every row comes through
 * `listProducts`, which joins on `products.current_trusted_observation_id`
 * and constrains `status = 'trusted'`; candidate/quarantined/rejected data is
 * unreachable by construction. Responses carry `Cache-Control: public,
 * s-maxage=60` for CDN caching.
 */

import { PUBLIC_SCHEMA_VERSION } from "@/server/products/dto";
import { toPublicProductDto } from "@/server/products/dto";
import {
  badRequest,
  jsonPublic,
  parseProductListQuery,
} from "@/server/products/request-params";
import { InvalidCursorError, listProducts } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const parameters = new URL(request.url).searchParams;
  const parsed = parseProductListQuery(parameters);
  if (!parsed.ok) return badRequest(parsed.error);

  try {
    const result = await listProducts(parsed.value);
    return jsonPublic({
      schemaVersion: PUBLIC_SCHEMA_VERSION,
      items: result.items.map((row) => toPublicProductDto(row)),
      totalCount: result.totalCount,
      activeFacets: result.activeFacets,
      nextCursor: result.nextCursor,
    });
  } catch (error) {
    if (error instanceof InvalidCursorError) return badRequest(error.message);
    throw error;
  }
}
