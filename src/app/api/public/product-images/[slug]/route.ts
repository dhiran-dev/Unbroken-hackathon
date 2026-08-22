import { createHash } from "node:crypto";

import { toPublicProductDto } from "@/server/products/dto";
import { getRenderedProductImage } from "@/server/products/product-image";
import { getProductBySlug } from "@/server/products/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ slug: string }> };

const CACHE_CONTROL =
  "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800";

function imageHeaders(etag?: string): HeadersInit {
  return {
    "Cache-Control": CACHE_CONTROL,
    "Content-Type": "image/webp",
    "X-Content-Type-Options": "nosniff",
    ...(etag ? { ETag: etag } : {}),
  };
}

export async function GET(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { slug } = await context.params;
  const product = await getProductBySlug(slug.trim());
  if (product === null) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const imageUrl = toPublicProductDto(product).image;
  if (imageUrl === null) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    const image = await getRenderedProductImage(imageUrl);
    const etag = `"${createHash("sha256").update(image).digest("base64url")}"`;
    if (request.headers.get("if-none-match") === etag) {
      return new Response(null, { status: 304, headers: imageHeaders(etag) });
    }
    const body = new ArrayBuffer(image.byteLength);
    new Uint8Array(body).set(image);
    return new Response(body, { status: 200, headers: imageHeaders(etag) });
  } catch {
    // A failed transformation is intentionally indistinguishable from absent
    // public media; the client renders the procedural specimen fallback.
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
}
