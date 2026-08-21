/**
 * PulseRank ingestion — trusted-to-trusted change detection (Agent A5).
 *
 * Pure function mandate (A5): no database access, no network access, no clock
 * reads. `diffTrustedRecords` is a pure function of its three inputs; the
 * observation timestamp is always a parameter — there is no `Date.now` (or any
 * other clock read) anywhere in the ingestion module.
 *
 * Implements PULSERANK_MASTER_IMPLEMENTATION_PLAN.md §"Agent A5" →
 * "Change events": only trusted-to-trusted transitions may create events, of
 * exactly these types:
 *
 *   caffeine_changed, serving_changed, calories_changed, sugar_changed,
 *   source_level_changed, variant_added, variant_changed, flavour_added,
 *   flavour_state_changed, conflict_introduced, conflict_resolved,
 *   product_renamed, page_missing
 *
 * A diff runs only when BOTH records are trusted records (non-null). A null
 * previous record is a first observation (no events); a null next record means
 * nothing new was trusted (no events). Page disappearance arrives as a trusted
 * record with `sourceStatus: "missing"` (the prior trusted record preserved by
 * promotion), which yields exactly one `page_missing` event.
 *
 * Every event carries `observedAt` from the parameter — never a clock read.
 */

import type { TrustedProductRecord } from "@/server/ingestion/promote";

// ---------------------------------------------------------------------------
// Event shapes
// ---------------------------------------------------------------------------

export const CHANGE_EVENT_TYPES = [
  "caffeine_changed",
  "serving_changed",
  "calories_changed",
  "sugar_changed",
  "source_level_changed",
  "variant_added",
  "variant_changed",
  "flavour_added",
  "flavour_state_changed",
  "conflict_introduced",
  "conflict_resolved",
  "product_renamed",
  "page_missing",
] as const;

export type ChangeEventType = (typeof CHANGE_EVENT_TYPES)[number];

/** One observed point in time of a field: value + qualifier + unit. */
export type ChangePoint = {
  value: number | string | null;
  qualifier: string | null;
  unit: string | null;
  /** Range bounds when the point is a range observation. */
  min?: number | null;
  max?: number | null;
};

export type ChangeEvent = {
  type: ChangeEventType;
  /**
   * Logical field that changed: a primary metric ("caffeine_mg", "serving",
   * "calories_kcal", "sugar_g", "source_level", "name", "source_status"),
   * "variants"/"flavours" for entity additions, or a dotted entity path
   * ("variant:<name>.<metric>", "flavour:<name>") for per-entity changes.
   */
  field?: string | undefined;
  before: ChangePoint | null;
  after: ChangePoint | null;
  /** Observation timestamp — always supplied by the caller, never a clock. */
  observedAt: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function metricPoint(point: TrustedProductRecord["caffeineMg"]): ChangePoint {
  const out: ChangePoint = {
    value: point.value,
    qualifier: point.qualifier,
    unit: point.unit,
  };
  if (point.min !== null || point.max !== null) {
    out.min = point.min;
    out.max = point.max;
  }
  return out;
}

function servingPoint(
  serving: TrustedProductRecord["serving"],
): ChangePoint {
  return {
    value: serving.value,
    qualifier: null,
    unit: serving.unit,
  };
}

function namedPoint(value: string): ChangePoint {
  return { value, qualifier: null, unit: null };
}

function metricsDiffer(
  a: TrustedProductRecord["caffeineMg"],
  b: TrustedProductRecord["caffeineMg"],
): boolean {
  return (
    a.value !== b.value ||
    a.min !== b.min ||
    a.max !== b.max ||
    a.qualifier !== b.qualifier
  );
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

/**
 * Diff two trusted product records. Deterministic: same inputs in, same events
 * out, in a fixed order (record-level events first, then primary metrics in
 * canonical order, then variants and flavours sorted by name).
 */
export function diffTrustedRecords(
  prevTrusted: TrustedProductRecord | null,
  nextTrusted: TrustedProductRecord | null,
  observedAt: string,
): ChangeEvent[] {
  // Only trusted-to-trusted transitions may create events.
  if (prevTrusted === null || nextTrusted === null) return [];
  if (prevTrusted.slug !== nextTrusted.slug) return [];

  const events: ChangeEvent[] = [];

  // -- record-level ----------------------------------------------------------

  if (prevTrusted.name !== nextTrusted.name) {
    events.push({
      type: "product_renamed",
      field: "name",
      before: namedPoint(prevTrusted.name),
      after: namedPoint(nextTrusted.name),
      observedAt,
    });
  }

  if (
    prevTrusted.sourceStatus === "active" &&
    nextTrusted.sourceStatus === "missing"
  ) {
    events.push({
      type: "page_missing",
      field: "source_status",
      before: namedPoint("active"),
      after: namedPoint("missing"),
      observedAt,
    });
  }

  if (prevTrusted.sourceLevel !== nextTrusted.sourceLevel) {
    events.push({
      type: "source_level_changed",
      field: "source_level",
      before: namedPoint(prevTrusted.sourceLevel),
      after: namedPoint(nextTrusted.sourceLevel),
      observedAt,
    });
  }

  // -- primary metrics -------------------------------------------------------
  // Conflict transitions get their dedicated event types; plain value /
  // qualifier / bound changes get the metric-specific *_changed events.

  const primaryMetrics = [
    {
      key: "caffeineMg" as const,
      field: "caffeine_mg",
      changedType: "caffeine_changed" as const,
    },
    {
      key: "caloriesKcal" as const,
      field: "calories_kcal",
      changedType: "calories_changed" as const,
    },
    {
      key: "sugarG" as const,
      field: "sugar_g",
      changedType: "sugar_changed" as const,
    },
  ];

  for (const { key, field, changedType } of primaryMetrics) {
    const prev = prevTrusted[key];
    const next = nextTrusted[key];
    const prevConflicting = prev.state === "conflicting";
    const nextConflicting = next.state === "conflicting";

    if (!prevConflicting && nextConflicting) {
      events.push({
        type: "conflict_introduced",
        field,
        before: metricPoint(prev),
        after: metricPoint(next),
        observedAt,
      });
      continue;
    }
    if (prevConflicting && !nextConflicting) {
      events.push({
        type: "conflict_resolved",
        field,
        before: metricPoint(prev),
        after: metricPoint(next),
        observedAt,
      });
      continue;
    }
    if (!prevConflicting && !nextConflicting && metricsDiffer(prev, next)) {
      events.push({
        type: changedType,
        field,
        before: metricPoint(prev),
        after: metricPoint(next),
        observedAt,
      });
    }
  }

  const prevServing = prevTrusted.serving;
  const nextServing = nextTrusted.serving;
  if (
    prevServing.state !== "conflicting" &&
    nextServing.state !== "conflicting" &&
    (prevServing.value !== nextServing.value ||
      prevServing.unit !== nextServing.unit)
  ) {
    events.push({
      type: "serving_changed",
      field: "serving",
      before: servingPoint(prevServing),
      after: servingPoint(nextServing),
      observedAt,
    });
  }

  // -- variants ----------------------------------------------------------------

  const prevVariants = new Map(prevTrusted.variants.map((v) => [v.name, v]));
  const nextVariants = new Map(nextTrusted.variants.map((v) => [v.name, v]));

  for (const name of [...nextVariants.keys()].sort()) {
    if (!prevVariants.has(name)) {
      events.push({
        type: "variant_added",
        field: "variants",
        before: null,
        after: namedPoint(name),
        observedAt,
      });
    }
  }

  for (const name of [...prevVariants.keys()].sort()) {
    const prev = prevVariants.get(name);
    const next = nextVariants.get(name);
    if (!prev || !next) continue;

    if (prev.availability !== next.availability) {
      events.push({
        type: "variant_changed",
        field: `variant:${name}.availability`,
        before: namedPoint(prev.availability),
        after: namedPoint(next.availability),
        observedAt,
      });
    }

    const variantMetrics = [
      { key: "caffeineMg" as const, suffix: "caffeine_mg" },
      { key: "caloriesKcal" as const, suffix: "calories_kcal" },
      { key: "sugarG" as const, suffix: "sugar_g" },
    ];
    for (const { key, suffix } of variantMetrics) {
      if (metricsDiffer(prev[key], next[key])) {
        events.push({
          type: "variant_changed",
          field: `variant:${name}.${suffix}`,
          before: metricPoint(prev[key]),
          after: metricPoint(next[key]),
          observedAt,
        });
      }
    }

    if (
      prev.serving.value !== next.serving.value ||
      prev.serving.unit !== next.serving.unit
    ) {
      events.push({
        type: "variant_changed",
        field: `variant:${name}.serving`,
        before: servingPoint(prev.serving),
        after: servingPoint(next.serving),
        observedAt,
      });
    }
  }

  // -- flavours ------------------------------------------------------------------

  const prevFlavours = new Map(prevTrusted.flavours.map((f) => [f.name, f]));
  const nextFlavours = new Map(nextTrusted.flavours.map((f) => [f.name, f]));

  for (const name of [...nextFlavours.keys()].sort()) {
    if (!prevFlavours.has(name)) {
      events.push({
        type: "flavour_added",
        field: "flavours",
        before: null,
        after: namedPoint(name),
        observedAt,
      });
    }
  }

  for (const name of [...prevFlavours.keys()].sort()) {
    const prev = prevFlavours.get(name);
    const next = nextFlavours.get(name);
    if (!prev || !next) continue;

    if (prev.availability !== next.availability) {
      events.push({
        type: "flavour_state_changed",
        field: `flavour:${name}`,
        before: namedPoint(prev.availability),
        after: namedPoint(next.availability),
        observedAt,
      });
    }
  }

  return events;
}
