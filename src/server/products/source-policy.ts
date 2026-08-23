/**
 * Public source-link policy. Product provenance links are published only when
 * they point to an approved Caffeine Informer product page over HTTPS.
 */
const PUBLIC_SOURCE_HOST = "www.caffeineinformer.com";
const PUBLIC_PRODUCT_PATH = /^\/caffeine-content\/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\/?$/;

/** Return a canonical public source URL, or null when the value is unsafe. */
export function authorizeProductSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.trim() === "") return null;

  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.hostname.toLowerCase() !== PUBLIC_SOURCE_HOST ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      !PUBLIC_PRODUCT_PATH.test(url.pathname)
    ) {
      return null;
    }

    const pathname = url.pathname.replace(/\/+$/, "");
    return `https://${PUBLIC_SOURCE_HOST}${pathname}`;
  } catch {
    return null;
  }
}
