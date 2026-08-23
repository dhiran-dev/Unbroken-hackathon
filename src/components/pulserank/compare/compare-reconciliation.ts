import type { CompareUpdate, ReplaceCompareResult } from "@/lib/local-state/compare";
import { sanitizeCompareSlugs } from "@/lib/local-state/compare";

export type CompareReconciliation = {
  requested: string[];
  notice: string | null;
};

/** Prevents an older selection request from applying after a local clear. */
export function isCurrentCompareRequest(
  active: boolean,
  requestId: number,
  currentRequestId: number,
): boolean {
  return active && requestId === currentRequestId;
}

type ReconcileOptions = {
  add: (slug: string) => CompareUpdate;
  addSlug: string | null;
  replace: (slugs: readonly string[]) => ReplaceCompareResult;
  shared: readonly string[] | undefined;
  stored: readonly string[];
};

/** Reconciles URL intent with browser-local persistence without fabricating selection state. */
export function reconcileCompareSelection({
  add,
  addSlug,
  replace,
  shared,
  stored,
}: ReconcileOptions): CompareReconciliation {
  const hasSharedSelection = shared !== undefined;
  let requested = hasSharedSelection
    ? sanitizeCompareSlugs(shared)
    : sanitizeCompareSlugs(stored);
  let notice: string | null = null;

  if (hasSharedSelection) {
    const result = replace(requested);
    requested = result.slugs;
    if (!result.ok) {
      notice = "This comparison is view-only because browser storage is unavailable.";
    }
  }

  if (addSlug?.trim()) {
    const result = add(addSlug);
    if (result.ok) {
      requested = result.slugs;
      if (!result.added && !result.slugs.includes(addSlug.trim())) {
        notice = result.slugs.length >= 4
          ? "Compare holds up to 4 products. Remove one before adding another."
          : "This product could not be added to the compare tray.";
      }
    } else {
      // Keep a shared URL usable as a view-only comparison when persistence fails.
      if (!hasSharedSelection) requested = result.slugs;
      notice = "This comparison is view-only because browser storage is unavailable.";
    }
  }

  return { notice, requested };
}
