import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";

export const PRODUCT_IMAGE_SOURCE_HOST = "caffeineinformer.com";

export type ProductMedia = ProductScrapeRowV1["media"];

function isSourceHost(hostname: string): boolean {
  return hostname === `www.${PRODUCT_IMAGE_SOURCE_HOST}`;
}

/**
 * Product imagery is publishable only when it is an HTTPS asset hosted by the
 * product source. The raw collector value remains private when it fails this
 * boundary; callers receive a null URL instead of reflecting an arbitrary
 * third-party URL into a public response.
 */
export function authorizeProductImage(imageUrl: unknown): ProductMedia {
  if (typeof imageUrl !== "string" || imageUrl.trim() === "") {
    return { imageUrl: null, publicationState: "audit_only" };
  }

  try {
    const parsed = new URL(imageUrl.trim());
    if (parsed.protocol !== "https:" || !isSourceHost(parsed.hostname.toLowerCase())) {
      return { imageUrl: null, publicationState: "blocked" };
    }
    return { imageUrl: parsed.toString(), publicationState: "allowed" };
  } catch {
    return { imageUrl: null, publicationState: "blocked" };
  }
}

/** Revalidate an already classified scrape-row media block at normalization. */
export function normalizeProductMedia(media: ProductMedia): ProductMedia {
  if (media.publicationState !== "allowed") return media;
  return authorizeProductImage(media.imageUrl);
}
