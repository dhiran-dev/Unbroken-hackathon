/**
 * GET /api/public/categories — canonical categories over trusted products (A8).
 *
 * Thin handler: distinct canonical categories with real product counts,
 * derived exclusively from trusted observations through the
 * current-trusted pointer.
 */

import { PUBLIC_SCHEMA_VERSION } from "@/server/products/dto";
import { jsonPublic } from "@/server/products/request-params";
import { listCategories } from "@/server/products/queries";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const categories = await listCategories();
  return jsonPublic({
    schemaVersion: PUBLIC_SCHEMA_VERSION,
    categories,
  });
}
