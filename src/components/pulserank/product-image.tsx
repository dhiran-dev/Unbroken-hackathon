"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

type PublishedProductImageProps = Omit<
  ImageProps,
  "alt" | "onError" | "src" | "unoptimized"
> & {
  alt?: string;
  fallback: ReactNode;
  name: string;
  slug: string;
};

/**
 * The one browser boundary for product photography.
 *
 * Callers provide only a trusted product slug. The server resolves the
 * publication-approved source URL and returns the Sharp edge-matted WebP;
 * upstream URLs never become browser image sources. A 404/transform failure
 * swaps in the caller's layout-stable procedural fallback.
 */
export function PublishedProductImage({
  alt,
  fallback,
  name,
  slug,
  ...imageProps
}: PublishedProductImageProps) {
  const [failedSlug, setFailedSlug] = useState<string | null>(null);

  if (failedSlug === slug) return fallback;

  return (
    <Image
      {...imageProps}
      alt={alt ?? `${name} product packaging`}
      data-product-image={slug}
      data-product-image-mode="edge-matte"
      onError={() => setFailedSlug(slug)}
      src={`/api/public/product-images/${encodeURIComponent(slug)}`}
      unoptimized
    />
  );
}
