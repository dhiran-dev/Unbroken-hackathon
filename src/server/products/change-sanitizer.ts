import type { ChangePoint } from "@/server/ingestion/change-detection";

type StoredPoint = Record<string, unknown>;

function isRecord(value: unknown): value is StoredPoint {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 120) : null;
}

/** Strict allowlist: raw prose and arbitrary nested JSON can never pass. */
export function sanitizeChangePoint(value: unknown): ChangePoint | null {
  if (!isRecord(value)) return null;
  const rawValue = value.value;
  const point: ChangePoint = {
    value:
      typeof rawValue === "string"
        ? rawValue.slice(0, 120)
        : finiteOrNull(rawValue),
    qualifier: textOrNull(value.qualifier),
    unit: textOrNull(value.unit),
  };
  if ("min" in value || "max" in value) {
    point.min = finiteOrNull(value.min);
    point.max = finiteOrNull(value.max);
  }
  return point;
}

const EVENT_FIELDS: Readonly<Record<string, string>> = Object.freeze({
  caffeine_changed: "caffeine_mg",
  serving_changed: "serving",
  calories_changed: "calories_kcal",
  sugar_changed: "sugar_g",
  source_level_changed: "source_level",
  variant_added: "variants",
  flavour_added: "flavours",
  flavour_state_changed: "flavours",
  product_renamed: "name",
  page_missing: "source_status",
});

/** Prefer the persisted deterministic field marker for compound event types. */
export function changeField(
  eventType: string,
  before: unknown,
  after: unknown,
): string {
  for (const point of [after, before]) {
    if (!isRecord(point) || typeof point.field !== "string") continue;
    const field = point.field.trim();
    if (field.length > 0 && field.length <= 160) return field;
  }
  return EVENT_FIELDS[eventType] ?? "unknown";
}
