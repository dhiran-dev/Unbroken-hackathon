/**
 * PulseRank public API — sort options and page-size bounds (A8).
 *
 * Lives in its own module (imported by both `queries.ts` and the pure
 * request-parameter parser) so callers can validate parameters without
 * importing the database client.
 */

export const PRODUCT_SORT_OPTIONS = [
  "name",
  "caffeine-desc",
  "caffeine-asc",
  "newest",
] as const;

export type ProductSortOption = (typeof PRODUCT_SORT_OPTIONS)[number];

export const DEFAULT_PAGE_LIMIT = 24;
export const MAX_PAGE_LIMIT = 100;
