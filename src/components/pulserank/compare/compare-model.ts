import type { PublicProductDto } from "@/server/products/dto";

export type CompareMetricView = {
  primary: string;
  secondary?: string;
  badge: string;
  tone: "exact" | "muted" | "warning";
};

const FIELD_STATE_LABELS: Record<string, string> = {
  conflicting: "Conflicting",
  not_applicable: "Not applicable",
  not_published: "Not published",
  present: "Observed",
  unparseable: "Needs review",
};

const CATEGORY_LABELS: Record<string, string> = {
  coffee: "Coffee",
  "energy-drink": "Energy drink",
  "energy-shot": "Energy shot",
  food: "Food",
  gum: "Gum",
  other: "Other",
  soda: "Soda",
  tea: "Tea",
  water: "Water",
};

export function compareCategoryLabel(category: string): string {
  return CATEGORY_LABELS[category] ?? category.replaceAll("-", " ");
}

export function categoryProvenanceLabel(
  provenance: PublicProductDto["categoryProvenance"],
): string {
  const labels: Record<PublicProductDto["categoryProvenance"], string> = {
    legacy_broad: "legacy source category",
    source_listing: "source listing",
    source_pdp: "source product page",
  };
  return labels[provenance];
}

export function compareNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value);
}

function unavailableMetric(state: string): CompareMetricView {
  return {
    primary: "—",
    badge: FIELD_STATE_LABELS[state] ?? state.replaceAll("_", " "),
    tone:
      state === "conflicting" || state === "unparseable"
        ? "warning"
        : "muted",
  };
}

function qualifierLabel(qualifier: string): string {
  const labels: Record<string, string> = {
    approximate: "Approximate",
    estimated: "Estimated",
    exact: "Exact",
    range: "Range",
    unknown: "Unknown",
  };
  return labels[qualifier] ?? qualifier;
}

export function caffeineMetric(product: PublicProductDto): CompareMetricView {
  const caffeine = product.caffeine;
  if (caffeine.state !== "present") return unavailableMetric(caffeine.state);
  if (caffeine.qualifier === "range") {
    if (
      caffeine.min === null ||
      caffeine.max === null ||
      !Number.isFinite(caffeine.min) ||
      !Number.isFinite(caffeine.max) ||
      caffeine.min > caffeine.max
    ) {
      return { primary: "—", badge: "Range unavailable", tone: "warning" };
    }
    return {
      primary: `${compareNumber(caffeine.min)}–${compareNumber(caffeine.max)} mg`,
      badge: "Range",
      tone: "warning",
    };
  }
  if (caffeine.mg === null) return unavailableMetric("not_published");
  return {
    primary: `${compareNumber(caffeine.mg)} mg`,
    badge: qualifierLabel(caffeine.qualifier),
    tone: caffeine.qualifier === "exact" ? "exact" : "warning",
  };
}

function servingUnit(unit: PublicProductDto["serving"]["unit"]): string {
  if (!unit || unit === "unknown") return "serving";
  return unit.replaceAll("_", " ");
}

export function servingMetric(product: PublicProductDto): CompareMetricView {
  const serving = product.serving;
  if (serving.state !== "present") return unavailableMetric(serving.state);
  if (serving.value === null) return unavailableMetric("not_published");

  const primary = `${compareNumber(serving.value)} ${servingUnit(serving.unit)}`;
  const normalized = serving.normalizedMl;
  const context = [
    normalized === null || (serving.unit === "ml" && normalized === serving.value)
      ? null
      : `${compareNumber(normalized)} ml`,
    serving.form === "unknown"
      ? null
      : serving.form.charAt(0).toUpperCase() + serving.form.slice(1),
  ].filter((part): part is string => part !== null);
  const secondary = context.length > 0 ? context.join(" · ") : undefined;

  return { primary, secondary, badge: "Exact", tone: "exact" };
}

export function concentrationMetric(
  product: PublicProductDto,
): CompareMetricView {
  const concentration = product.concentration.mgPer100Ml;
  if (concentration === null) {
    return {
      primary: "—",
      badge: "Not eligible",
      tone: product.caffeine.state === "conflicting" ? "warning" : "muted",
    };
  }
  return {
    primary: `${compareNumber(concentration)} mg/100 ml`,
    badge: "Exact",
    tone: "exact",
  };
}

export function caloriesMetric(product: PublicProductDto): CompareMetricView {
  if (!product.calories) {
    return { primary: "—", badge: "Not available", tone: "muted" };
  }
  if (product.calories.state !== "present") return unavailableMetric(product.calories.state);
  if (product.calories.kcal === null) return unavailableMetric("not_published");
  return {
    primary: `${compareNumber(product.calories.kcal)} kcal`,
    badge: "Exact",
    tone: "exact",
  };
}

export function sugarMetric(product: PublicProductDto): CompareMetricView {
  if (!product.sugar) {
    return { primary: "—", badge: "Not available", tone: "muted" };
  }
  if (product.sugar.state !== "present") return unavailableMetric(product.sugar.state);
  if (product.sugar.g === null) return unavailableMetric("not_published");
  return {
    primary: `${compareNumber(product.sugar.g)} g`,
    badge: "Exact",
    tone: "exact",
  };
}

export function observedAtLabel(isoDate: string): string {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) return "Observation time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "short",
    timeZone: "UTC",
    timeZoneName: "short",
    year: "numeric",
  }).format(parsed);
}

export function eligibilityLabel(product: PublicProductDto): {
  primary: string;
  secondary: string;
  eligible: boolean;
} {
  const { concentration, totalCaffeine } = product.rankingEligibility;
  if (totalCaffeine && concentration) {
    return {
      primary: "Total caffeine & concentration",
      secondary: "Eligible",
      eligible: true,
    };
  }
  if (totalCaffeine) {
    return { primary: "Total caffeine", secondary: "Eligible", eligible: true };
  }
  if (concentration) {
    return { primary: "Concentration", secondary: "Eligible", eligible: true };
  }
  return {
    primary: "Not ranked",
    secondary:
      product.rankingEligibility.reasons.length > 0
        ? product.rankingEligibility.reasons
            .map((reason) => reason.replaceAll("_", " "))
            .join(" · ")
        : "No eligible exact metric",
    eligible: false,
  };
}
