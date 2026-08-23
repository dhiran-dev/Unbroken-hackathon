import type { PublicProductDto } from "@/server/products/dto";
import type { LeaderboardEntryDto } from "@/server/products/queries";

export type LeaderboardClientRow = {
  entry: LeaderboardEntryDto;
  product: PublicProductDto;
};

/** Append a cursor page without changing immutable snapshot ranks or order. */
export function mergeLeaderboardRows(
  current: LeaderboardClientRow[],
  next: LeaderboardClientRow[],
): LeaderboardClientRow[] {
  const seen = new Set(current.map((row) => row.entry.productId));
  const merged = [...current];
  for (const row of next) {
    if (seen.has(row.entry.productId)) continue;
    seen.add(row.entry.productId);
    merged.push(row);
  }
  return merged;
}

export function sourceForDisplay(sourceUrl: string | null): string {
  return sourceUrl ?? "Source unavailable";
}

export function emptyLeaderboardCopy(hasSnapshot: boolean): {
  title: string;
  description: string;
} {
  return hasSnapshot
    ? {
        title: "No exact entries match these filters",
        description:
          "This board only renders trusted products that satisfy its exact eligibility rules. Clear a filter to inspect the current snapshot.",
      }
    : {
        title: "No leaderboard snapshot yet",
        description:
          "This board has not been built from a trusted immutable snapshot yet. Check back after the next ranking rebuild.",
      };
}
