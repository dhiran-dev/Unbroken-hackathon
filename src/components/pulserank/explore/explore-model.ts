import type { PublicProductDto } from "@/server/products/dto";

export type ExplorePlotMetric = "total" | "concentration";

export type ExplorePlotPoint = {
  xMl: number;
  yValue: number;
};

export function isExactPlotProduct(
  product: PublicProductDto,
  metric: ExplorePlotMetric,
): boolean {
  const exactCaffeine =
    product.caffeine.state === "present" &&
    product.caffeine.qualifier === "exact" &&
    product.caffeine.mg !== null &&
    Number.isFinite(product.caffeine.mg);
  const exactVolume =
    product.serving.state === "present" &&
    product.serving.normalizedMl !== null &&
    Number.isFinite(product.serving.normalizedMl) &&
    product.serving.normalizedMl > 0;

  if (!exactCaffeine || !exactVolume) return false;
  if (metric === "total") return true;

  return (
    product.concentration.mgPer100Ml !== null &&
    Number.isFinite(product.concentration.mgPer100Ml)
  );
}

export function toExplorePlotPoint(
  product: PublicProductDto,
  metric: ExplorePlotMetric,
): ExplorePlotPoint | null {
  if (!isExactPlotProduct(product, metric)) return null;
  return {
    xMl: product.serving.normalizedMl as number,
    yValue:
      metric === "total"
        ? (product.caffeine.mg as number)
        : (product.concentration.mgPer100Ml as number),
  };
}

export function niceAxisMaximum(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

export function exploreVolumePosition(volumeMl: number, axisMaximumMl: number): number {
  if (!Number.isFinite(volumeMl) || volumeMl <= 0) return 0;
  const maximum = Number.isFinite(axisMaximumMl) && axisMaximumMl > 0
    ? axisMaximumMl
    : 1;
  return Math.min(1, Math.log1p(volumeMl) / Math.log1p(maximum));
}

export function exploreVolumeAxisTicks(axisMaximumMl: number): number[] {
  const maximum = Math.max(1, axisMaximumMl);
  const candidates = maximum <= 100
    ? [0, 25, 50, 75, maximum]
    : maximum <= 500
      ? [0, 50, 100, 250, maximum]
      : maximum <= 1_000
        ? [0, 100, 250, 500, maximum]
        : maximum <= 5_000
          ? [0, 250, 1_000, 2_500, maximum]
          : maximum <= 25_000
            ? [0, 250, 1_000, 5_000, maximum]
            : [0, 500, 2_500, 10_000, maximum];

  return [...new Set(candidates.filter((tick) => tick >= 0 && tick <= maximum))];
}

export function appendUniqueProducts(
  current: PublicProductDto[],
  incoming: PublicProductDto[],
): PublicProductDto[] {
  const seen = new Set(current.map((product) => product.slug));
  return [
    ...current,
    ...incoming.filter((product) => {
      if (seen.has(product.slug)) return false;
      seen.add(product.slug);
      return true;
    }),
  ];
}
