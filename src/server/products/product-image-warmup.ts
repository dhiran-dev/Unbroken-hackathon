import { toPublicProductDto } from "@/server/products/dto";
import { getRenderedProductImage } from "@/server/products/product-image";
import { listCategories, listProducts } from "@/server/products/queries";

type ProductImageWarmupGlobal = typeof globalThis & {
  pulserankExploreImageWarmup?: Promise<void>;
};

const globalForWarmup = globalThis as ProductImageWarmupGlobal;

/**
 * Warm the default Explore data and inspector image before a deployment is
 * considered ready. Failure remains non-fatal because the route can query the
 * database normally and the UI has a procedural image fallback.
 */
export function warmExploreProductImage(): Promise<void> {
  globalForWarmup.pulserankExploreImageWarmup ??= Promise.all([
    listProducts({ limit: 24 }),
    listCategories(),
  ])
    .then(async ([{ items }]) => {
      const first = items[0];
      if (!first) return;
      const imageUrl = toPublicProductDto(first).image;
      if (imageUrl) await getRenderedProductImage(imageUrl);
    })
    .catch(() => {
      globalForWarmup.pulserankExploreImageWarmup = undefined;
    });
  return globalForWarmup.pulserankExploreImageWarmup;
}
