import type { PublicProductDto } from "@/server/products/dto";

export const LEADERBOARD_BOARDS = [
  {
    key: "highest-total-caffeine",
    label: "Highest total caffeine",
    detail: "Most caffeine per serving",
    metricLabel: "Total caffeine",
    metricUnit: "mg / serving",
  },
  {
    key: "highest-exact-concentration",
    label: "Highest concentration",
    detail: "Most caffeine per 100 ml",
    metricLabel: "Concentration",
    metricUnit: "mg / 100 ml",
  },
  {
    key: "caffeine-free",
    label: "Caffeine-free",
    detail: "0 mg caffeine per serving",
    metricLabel: "Total caffeine",
    metricUnit: "mg / serving",
  },
] as const;

export type LeaderboardBoardKey = (typeof LEADERBOARD_BOARDS)[number]["key"];

export type EligibilitySummary = {
  eligibleCount: number;
  excludedCount: number;
  reasons: Array<{ label: string; count: number }>;
};

function hasExactCaffeine(product: PublicProductDto): boolean {
  return (
    product.caffeine.state === "present" &&
    product.caffeine.qualifier === "exact" &&
    product.caffeine.mg !== null &&
    product.caffeine.mg >= 0
  );
}

export function isEligibleForBoard(
  boardKey: LeaderboardBoardKey,
  product: PublicProductDto,
): boolean {
  if (boardKey === "highest-exact-concentration") {
    return (
      hasExactCaffeine(product) &&
      product.rankingEligibility.concentration &&
      product.concentration.mgPer100Ml !== null
    );
  }
  if (boardKey === "caffeine-free") {
    return hasExactCaffeine(product) && product.caffeine.mg === 0;
  }
  return hasExactCaffeine(product);
}

function primaryExclusionReason(
  boardKey: LeaderboardBoardKey,
  product: PublicProductDto,
): string {
  switch (product.caffeine.state) {
    case "conflicting":
      return "Conflicting values";
    case "unparseable":
      return "Unparseable";
    case "not_published":
      return "Not published";
    case "not_applicable":
      return "Not applicable";
    case "present":
      break;
  }

  if (product.caffeine.qualifier !== "exact" || product.caffeine.mg === null) {
    return "Not an exact value";
  }
  if (boardKey === "highest-exact-concentration") {
    return product.serving.normalizedMl === null
      ? "Serving volume unavailable"
      : "Not concentration eligible";
  }
  if (boardKey === "caffeine-free") return "Contains caffeine";
  return "Not ranking eligible";
}

export function summarizeEligibility(
  boardKey: LeaderboardBoardKey,
  products: PublicProductDto[],
): EligibilitySummary {
  const counts = new Map<string, number>();
  let eligibleCount = 0;

  for (const product of products) {
    if (isEligibleForBoard(boardKey, product)) {
      eligibleCount += 1;
      continue;
    }
    const reason = primaryExclusionReason(boardKey, product);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }

  return {
    eligibleCount,
    excludedCount: products.length - eligibleCount,
    reasons: [...counts.entries()]
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
  };
}

export function hasCompleteServing(product: PublicProductDto): boolean {
  return (
    product.serving.state === "present" &&
    product.serving.value !== null &&
    product.serving.unit !== null
  );
}

export function servingFormLabel(
  form: PublicProductDto["serving"]["form"],
): string {
  if (!form) return "Other serving";
  return form.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function servingText(product: PublicProductDto): {
  primary: string;
  secondary: string;
} {
  const serving = product.serving;
  if (serving.value === null || serving.unit === null) {
    return { primary: "Not published", secondary: "Serving unavailable" };
  }
  const unit = serving.unit.replaceAll("_", " ");
  const primary = `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(serving.value)} ${unit}`;
  const secondary =
    serving.normalizedMl === null
      ? servingFormLabel(serving.form)
      : `(${serving.unit === "ml" ? "normalized " : ""}${new Intl.NumberFormat("en-US", {
          maximumFractionDigits: 1,
        }).format(serving.normalizedMl)} ml)`;
  return { primary, secondary };
}
