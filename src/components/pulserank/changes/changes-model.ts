import type { ChangePoint } from "@/server/ingestion/change-detection";
import type { ChangeEventDto } from "@/server/products/queries";

export type ChangePointSide = "before" | "after";
export const CHANGE_GROUPS = [
  { id: "all", label: "All changes" },
  { id: "caffeine", label: "Caffeine" },
  { id: "serving", label: "Serving size" },
  { id: "nutrition", label: "Calories / Sugar" },
  { id: "discoveries", label: "Discoveries" },
  { id: "other", label: "Other" },
] as const;

export type ChangeGroupId = (typeof CHANGE_GROUPS)[number]["id"];

const EVENT_LABELS: Readonly<Record<string, string>> = Object.freeze({
  caffeine_changed: "Caffeine changed",
  serving_changed: "Serving changed",
  calories_changed: "Calories changed",
  sugar_changed: "Sugar changed",
  source_level_changed: "Source level changed",
  variant_added: "Variant added",
  variant_changed: "Variant changed",
  flavour_added: "Flavour added",
  flavour_state_changed: "Flavour state changed",
  conflict_introduced: "Conflict introduced",
  conflict_resolved: "Conflict resolved",
  product_renamed: "Product renamed",
  page_missing: "Source page missing",
});

const FIELD_LABELS: Readonly<Record<string, string>> = Object.freeze({
  caffeine_mg: "Caffeine",
  serving: "Serving",
  calories_kcal: "Calories",
  sugar_g: "Sugar",
  source_level: "Source level",
  source_status: "Source status",
  name: "Product name",
  variants: "Variants",
  flavours: "Flavours",
});

function humanize(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function eventLabel(eventType: string): string {
  return EVENT_LABELS[eventType] ?? humanize(eventType);
}

export function fieldLabel(field: string): string {
  const direct = FIELD_LABELS[field];
  if (direct) return direct;

  const variant = field.match(/^variant:(.+)\.(.+)$/);
  if (variant && variant[1] && variant[2]) return `Variant · ${variant[1]} · ${humanize(variant[2])}`;

  const flavour = field.match(/^flavour:(.+)$/);
  if (flavour) return `Flavour · ${flavour[1]}`;

  return humanize(field);
}

function numberText(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 20,
    useGrouping: true,
  }).format(value);
}

export function pointValueText(
  point: ChangePoint | null,
  side: ChangePointSide,
): string {
  if (point === null) {
    return side === "before" ? "No previous point" : "No new point";
  }

  const hasMin = point.min !== null && point.min !== undefined;
  const hasMax = point.max !== null && point.max !== undefined;
  let value: string;

  if (hasMin || hasMax) {
    const min = hasMin && typeof point.min === "number" ? numberText(point.min) : "?";
    const max = hasMax && typeof point.max === "number" ? numberText(point.max) : "?";
    value = `${min}–${max}`;
  } else if (typeof point.value === "number") {
    value = numberText(point.value);
  } else if (typeof point.value === "string" && point.value.length > 0) {
    value = point.value;
  } else {
    value = "Unknown";
  }

  return point.unit ? `${value} ${point.unit}` : value;
}

export function pointQualifierText(point: ChangePoint | null): string | null {
  if (!point || !point.qualifier) return null;
  return point.qualifier;
}

export function formatObservedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Timestamp unavailable";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatRelativeTime(value: string, now = Date.now()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time unavailable";

  const deltaSeconds = Math.round((date.getTime() - now) / 1000);
  const absoluteSeconds = Math.abs(deltaSeconds);
  if (absoluteSeconds < 60) return deltaSeconds < 0 ? "Just now" : "In under a minute";

  const units: Array<[number, string]> = [
    [60 * 60 * 24, "day"],
    [60 * 60, "hour"],
    [60, "minute"],
  ];
  const unit = units.find(([seconds]) => absoluteSeconds >= seconds);
  if (!unit) return deltaSeconds < 0 ? "Just now" : "In under a minute";

  const amount = Math.max(1, Math.round(absoluteSeconds / unit[0]));
  return deltaSeconds < 0 ? `${amount}${unit[1][0]} ago` : `In ${amount}${unit[1][0]}`;
}

export function countEventTypes(items: ChangeEventDto[]): Array<{ type: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.eventType, (counts.get(item.eventType) ?? 0) + 1);
  return [...counts.entries()].map(([type, count]) => ({ type, count }));
}

export function changeGroupForEventType(eventType: string): Exclude<ChangeGroupId, "all"> {
  if (eventType === "caffeine_changed") return "caffeine";
  if (eventType === "serving_changed") return "serving";
  if (eventType === "calories_changed" || eventType === "sugar_changed") return "nutrition";
  if (
    eventType === "variant_added" ||
    eventType === "variant_changed" ||
    eventType === "flavour_added" ||
    eventType === "flavour_state_changed" ||
    eventType === "product_renamed"
  ) return "discoveries";
  return "other";
}

export function countChangeGroups(items: ChangeEventDto[]): Array<{ id: ChangeGroupId; label: string; count: number }> {
  const counts = new Map<ChangeGroupId, number>(CHANGE_GROUPS.map(({ id }) => [id, 0]));
  counts.set("all", items.length);
  for (const item of items) {
    const group = changeGroupForEventType(item.eventType);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return CHANGE_GROUPS.map(({ id, label }) => ({ id, label, count: counts.get(id) ?? 0 }));
}
