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
