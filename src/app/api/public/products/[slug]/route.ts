/**
 * GET /api/public/products/[slug] — one trusted product (A8).
 *
 * Thin handler: the slug resolves through the same trusted-only join as the
 * list endpoint (`current_trusted_observation_id` + `status = 'trusted'`), so
 * a product with no promoted observation reads as a plain 404 — its
 * candidate/quarantined history never leaks.
 */

import { toPublicProductDto, PUBLIC_SCHEMA_VERSION } from "@/server/products/dto";
import {
  jsonPublic,
  notFound,
} from "@/server/products/request-params";
import { getProductBySlug } from "@/server/products/queries";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext): Promise<Response> {
  const { slug } = await context.params;
  const trimmedSlug = slug.trim();

  if (trimmedSlug === "") {
    return notFound("PRODUCT_NOT_FOUND", "product slug is required");
  }

  const row = await getProductBySlug(trimmedSlug);
  if (!row) {
    return notFound(
      "PRODUCT_NOT_FOUND",
      "no published product matches this slug",
    );
  }
  return jsonPublic({
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    product: toPublicProductDto(row),
  });
}
