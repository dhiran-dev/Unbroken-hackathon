import type {
  PublicCaffeineDto,
  PublicProductDto,
  PublicServingDto,
  PublicSugarDto,
} from "@/server/products/dto";

export type PassportState =
  | "exact"
  | "explicit-zero"
  | "range"
  | "estimated"
  | "approximate"
  | "conflicting"
  | "unparseable"
  | "not-published"
  | "not-applicable"
  | "unknown";

export type MetricPresentation = {
  state: PassportState;
  stateLabel: string;
  value: string;
  unit: string | null;
};

export function formatPassportNumber(value: number): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

export function caffeinePresentation(
  caffeine: PublicCaffeineDto,
): MetricPresentation {
  if (caffeine.state === "conflicting") {
    return { state: "conflicting", stateLabel: "Conflicting values", value: "Conflicting", unit: null };
  }
  if (caffeine.state === "unparseable") {
    return { state: "unparseable", stateLabel: "Unparseable", value: "Unparseable", unit: null };
  }
  if (caffeine.state === "not_applicable") {
    return { state: "not-applicable", stateLabel: "Not applicable", value: "N/A", unit: null };
  }
  if (caffeine.state === "not_published") {
    return { state: "not-published", stateLabel: "Not published", value: "Not published", unit: null };
  }
  if (caffeine.qualifier === "range") {
    if (
      caffeine.min === null ||
      caffeine.max === null ||
      !Number.isFinite(caffeine.min) ||
      !Number.isFinite(caffeine.max) ||
      caffeine.min > caffeine.max
    ) {
      return {
        state: "range",
        stateLabel: "Range unavailable",
        value: "Range unavailable",
        unit: null,
      };
    }
    return {
      state: "range",
      stateLabel: "Published range",
      value: `${formatPassportNumber(caffeine.min)}–${formatPassportNumber(caffeine.max)}`,
      unit: "mg",
    };
  }
  if (caffeine.mg !== null) {
    if (caffeine.qualifier === "estimated") {
      return {
        state: "estimated",
        stateLabel: "Estimated value",
        value: formatPassportNumber(caffeine.mg),
        unit: "mg",
      };
    }
    if (caffeine.qualifier === "approximate") {
      return {
        state: "approximate",
        stateLabel: "Approximate value",
        value: `~${formatPassportNumber(caffeine.mg)}`,
        unit: "mg",
      };
    }
    if (caffeine.mg === 0) {
      return { state: "explicit-zero", stateLabel: "Explicit zero", value: "0", unit: "mg" };
    }
    return {
      state: caffeine.qualifier === "exact" ? "exact" : "unknown",
      stateLabel: caffeine.qualifier === "exact" ? "Exact value" : "Published value",
      value: formatPassportNumber(caffeine.mg),
      unit: "mg",
    };
  }
  return { state: "unknown", stateLabel: "Unknown", value: "Unknown", unit: null };
}

export type ServingPresentation = {
  normalizedValue: string;
  stateLabel: string;
  value: string;
};

export function servingPresentation(serving: PublicServingDto): ServingPresentation {
  const stateLabel = fieldStateLabel(serving.state);
  if (serving.state !== "present") {
    return { normalizedValue: stateLabel, stateLabel, value: stateLabel };
  }

  if (serving.value === null) {
    return {
      normalizedValue: "Not normalized",
      stateLabel: "Not published",
      value: "Not published",
    };
  }

  const unit = serving.unit?.replaceAll("_", " ") ?? "unit";
  return {
    normalizedValue: serving.normalizedMl === null
      ? "Not normalized"
      : `${formatPassportNumber(serving.normalizedMl)} ml`,
    stateLabel,
    value: `${formatPassportNumber(serving.value)} ${unit}`,
  };
}

export type ProductActionEligibility = {
  eligible: boolean;
  reason: string;
};

export function saveEligibility(product: PublicProductDto): ProductActionEligibility {
  const caffeine = product.caffeine;
  const numericQualifier = caffeine.qualifier === "exact" ||
    caffeine.qualifier === "approximate" ||
    caffeine.qualifier === "estimated";
  if (caffeine.state !== "present" || caffeine.mg === null || !numericQualifier) {
    return {
      eligible: false,
      reason: "Save requires a published numeric caffeine point, not a range or uncertain field state.",
    };
  }
  if (product.serving.state !== "present" || product.serving.value === null) {
    return {
      eligible: false,
      reason: "Save requires a published serving value.",
    };
  }
  return { eligible: true, reason: "Save this published numeric snapshot in this browser." };
}

export function myDayEligibility(product: PublicProductDto): ProductActionEligibility {
  if (
    product.caffeine.state !== "present" ||
    product.caffeine.qualifier !== "exact" ||
    product.caffeine.mg === null
  ) {
    return {
      eligible: false,
      reason: "My Day requires an exact published caffeine value.",
    };
  }
  if (product.serving.state !== "present" || product.serving.value === null) {
    return {
      eligible: false,
      reason: "My Day requires a published serving value.",
    };
  }
  return { eligible: true, reason: "Add this exact serving to My Day in this browser." };
}

export function fieldStateLabel(state: string): string {
  const labels: Record<string, string> = {
    present: "Published",
    not_published: "Not published",
    not_applicable: "Not applicable",
    unparseable: "Unparseable",
    conflicting: "Conflicting values",
  };
  return labels[state] ?? "Unknown";
}

export type OptionalNutritionPresentation = {
  detail: string;
  state: string;
  value: string;
};

export function nutritionPresentation(
  field: { state: string; value: number | null } | undefined,
  unit: string,
): OptionalNutritionPresentation {
  if (field === undefined) {
    return {
      detail: "Not included in public view",
      state: "omitted",
      value: "Unavailable",
    };
  }
  const label = fieldStateLabel(field.state);
  const unavailable = field.state === "present" && field.value === null;
  return {
    detail: unavailable ? "Not published" : label,
    state: unavailable ? "not_published" : field.state,
    value: unavailable
      ? "Not published"
      : field.state === "present"
        ? `${formatPassportNumber(field.value as number)}${unit}`
        : label,
  };
}

export function categoryProvenanceLabel(
  provenance: PublicProductDto["categoryProvenance"],
): string {
  if (provenance === "source_listing") return "Source category list";
  if (provenance === "source_pdp") return "Source product page";
  return "Legacy catalog classification";
}

export function sourceLevelLabel(sourceLevel: string): string {
  return sourceLevel
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

export function rankingReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    caffeine_conflicting_excluded: "Conflicting caffeine values are excluded.",
    caffeine_sparse: "The source does not publish a usable caffeine value.",
    caffeine_unparseable: "The published caffeine value could not be parsed.",
    caffeine_no_usable_value: "No usable caffeine value is available.",
    concentration_requires_ml_volume:
      "Concentration requires a positive serving normalized to milliliters.",
    concentration_requires_exact_caffeine:
      "Concentration requires an exact caffeine value.",
  };
  return labels[reason] ?? reason.replaceAll("_", " ");
}

export type SugarScale = {
  fillPercent: number | null;
  maximum: number | null;
  state: PassportState;
  stateLabel: string;
  ticks: number[];
  valueLabel: string;
};

export function sugarScale(sugar: PublicSugarDto | undefined): SugarScale {
  if (!sugar) {
    return {
      fillPercent: null,
      maximum: null,
      state: "unknown",
      stateLabel: "Not included in this public response",
      ticks: [],
      valueLabel: "Not available",
    };
  }
  if (sugar.state !== "present" || sugar.g === null) {
    const state = sugar.state.replaceAll("_", "-") as PassportState;
    return {
      fillPercent: null,
      maximum: null,
      state,
      stateLabel: fieldStateLabel(sugar.state),
      ticks: [],
      valueLabel: fieldStateLabel(sugar.state),
    };
  }
  if (sugar.g === 0) {
    return {
      fillPercent: 0,
      maximum: 20,
      state: "explicit-zero",
      stateLabel: "Explicit zero",
      ticks: [0, 5, 10, 15, 20],
      valueLabel: "0 g",
    };
  }

  const maximum = Math.max(20, Math.ceil(sugar.g / 20) * 20);
  const step = maximum / 5;
  return {
    fillPercent: Math.min(100, (sugar.g / maximum) * 100),
    maximum,
    state: "exact",
    stateLabel: "Exact value",
    ticks: Array.from({ length: 6 }, (_, index) => step * index),
    valueLabel: `${formatPassportNumber(sugar.g)} g`,
  };
}
