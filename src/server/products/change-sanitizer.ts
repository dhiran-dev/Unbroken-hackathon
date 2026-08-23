import { CHANGE_EVENT_TYPES, type ChangePoint, type ChangeEventType } from "@/server/ingestion/change-detection";

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

const EVENT_TYPE_SET = new Set<string>(CHANGE_EVENT_TYPES);
const VARIANT_FIELD = /^variant:([^\.\r\n]{1,80})\.(availability|caffeine_mg|calories_kcal|sugar_g|serving)$/;
const FLAVOUR_FIELD = /^flavour:([^\.\r\n]{1,80})$/;

export type PublicChangeEventType = ChangeEventType | "unknown_change";

export const PUBLIC_CHANGE_OBSERVATION_STATUSES = ["trusted", "superseded"] as const;

export function isPublicChangeObservationStatus(status: string | null): boolean {
  return status !== null && PUBLIC_CHANGE_OBSERVATION_STATUSES.includes(status as (typeof PUBLIC_CHANGE_OBSERVATION_STATUSES)[number]);
}

/** Keep unexpected persisted event kinds from crossing the public boundary. */
export function sanitizeChangeEventType(value: unknown): PublicChangeEventType {
  return typeof value === "string" && EVENT_TYPE_SET.has(value)
    ? value as ChangeEventType
    : "unknown_change";
}

function sanitizeFieldMarker(value: string): string | null {
  const marker = value.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  if (EVENT_FIELDS[marker]) return marker;
  const variant = marker.match(VARIANT_FIELD);
  if (variant?.[1] && variant[2]) return `variant:${variant[1].trim()}.${variant[2]}`;
  const flavour = marker.match(FLAVOUR_FIELD);
  if (flavour?.[1]) return `flavour:${flavour[1].trim()}`;
  return null;
}

/** Prefer the persisted deterministic field marker for compound event types. */
export function changeField(
  eventType: string,
  before: unknown,
  after: unknown,
): string {
  for (const point of [after, before]) {
    if (!isRecord(point) || typeof point.field !== "string") continue;
    const field = sanitizeFieldMarker(point.field);
    if (field) return field;
  }
  return EVENT_FIELDS[eventType] ?? "unknown";
}
