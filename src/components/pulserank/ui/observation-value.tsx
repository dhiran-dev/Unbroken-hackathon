import type { NumberObservation } from "@/domain/product/contracts/observations";
import { cn } from "@/lib/utils";

import { FieldStateBadge } from "./field-state-badge";
import { QualifierTag, type NumberQualifier } from "./qualifier-tag";
import "./tokens.css";

/** The subset of the NumberObservation contract this primitive renders. */
export type ObservationValueInput = Pick<
  NumberObservation,
  "state" | "value" | "min" | "max" | "qualifier"
>;

function formatNumber(value: number): string {
  // Integers stay integers; decimals are trimmed of trailing zeros and capped
  // at 2 places so collector noise ('95.00000001') never reaches riders.
  return Number.isInteger(value)
    ? String(value)
    : String(Number(value.toFixed(2)));
}

export interface ObservationValueProps {
  observation: ObservationValueInput;
  /** Unit appended after the number: mg / g / kcal / ml … */
  unit?: string;
  /** Matches FieldStateBadge sizing when tags or badges are rendered. */
  size?: "sm" | "md";
  className?: string;
}

/**
 * Renders a NumberObservation per the PulseRank V1 contract:
 *
 * - present + exact        -> plain number            ("75 mg")
 * - present + range        -> en-dash bounded span    ("75–80 mg" + Range tag)
 * - present + approximate  -> tilde prefix            ("~95 kcal" + Approx. tag)
 * - present + estimated    -> est. prefix             ("est. 12 g" + Est. tag)
 * - any non-present state  -> FieldStateBadge (never a fabricated value)
 *
 * Defensive fallbacks (documented in docs/handoffs/A9a-ui-primitives.md):
 * a "range" observation missing bounds degrades to its single value; a
 * "present" observation with no usable number renders an em-dash placeholder.
 */
export function ObservationValue({
  observation,
  unit,
  size = "md",
  className,
}: ObservationValueProps) {
  const { state, value, min, max, qualifier } = observation;

  if (state !== "present") {
    return (
      <FieldStateBadge state={state} size={size} className={className} />
    );
  }

  let text: string;
  let tagQualifier: NumberQualifier = qualifier;

  if (qualifier === "range") {
    text =
      min !== null && max !== null
        ? `${formatNumber(min)}–${formatNumber(max)}`
        : value !== null
          ? formatNumber(value)
          : "—";
  } else if (qualifier === "approximate") {
    text = value !== null ? `~${formatNumber(value)}` : "—";
  } else if (qualifier === "estimated") {
    text = value !== null ? `est. ${formatNumber(value)}` : "—";
  } else if (qualifier === "unknown") {
    text = value !== null ? formatNumber(value) : "—";
  } else {
    // exact: no prefix, no tag.
    text = value !== null ? formatNumber(value) : "—";
    tagQualifier = "exact";
  }

  return (
    <span
      className={cn("inline-flex items-baseline gap-1", className)}
      data-qualifier={qualifier}
      data-state="present"
    >
      <span>{text}</span>
      {unit ? (
        <span className="text-[var(--pr-text-muted)]">{unit}</span>
      ) : null}
      <QualifierTag qualifier={tagQualifier} size={size} />
    </span>
  );
}
