import { cva, type VariantProps } from "class-variance-authority";

import type { FieldState } from "@/domain/product/contracts/field-states";
import { cn } from "@/lib/utils";

import "./tokens.css";

/** The four states a badge represents; "present" renders values instead. */
export type NonPresentFieldState = Exclude<FieldState, "present">;

/**
 * Visible short label plus the full sentence-level explanation exposed to
 * assistive tech via aria-label.
 */
export const FIELD_STATE_BADGE_COPY: Record<
  NonPresentFieldState,
  { label: string; explanation: string }
> = {
  not_published: {
    label: "Not published",
    explanation: "the source never publishes this field",
  },
  unparseable: {
    label: "Temporarily unavailable",
    explanation:
      "the source usually publishes this field, but its current value could not be parsed",
  },
  conflicting: {
    label: "Conflicting values",
    explanation: "independent source values disagree for this field",
  },
  not_applicable: {
    label: "N/A",
    explanation: "this field does not apply to products of this kind",
  },
};

/** Marker glyph per state so states never rely on color or shape alone. */
const FIELD_STATE_GLYPH: Record<NonPresentFieldState, string | null> = {
  not_published: null,
  unparseable: "!",
  conflicting: "≠",
  not_applicable: null,
};

const fieldStateBadgeVariants = cva(
  "inline-flex max-w-full items-center gap-1 whitespace-nowrap border font-medium leading-none",
  {
    variants: {
      /** Distinct color AND shape per state (see tokens.css mapping notes). */
      state: {
        // Dashed square: quiet absence.
        not_published:
          "rounded-sm border-dashed bg-[var(--pr-state-not-published-bg)] border-[var(--pr-state-not-published-border)] text-[var(--pr-state-not-published-fg)]",
        // Filled pill with "!" marker.
        unparseable:
          "rounded-full border-solid bg-[var(--pr-state-unparseable-bg)] border-[var(--pr-state-unparseable-border)] text-[var(--pr-state-unparseable-fg)]",
        // Sharp rectangle with "≠" marker.
        conflicting:
          "rounded-none border-solid bg-[var(--pr-state-conflicting-bg)] border-[var(--pr-state-conflicting-border)] text-[var(--pr-state-conflicting-fg)]",
        // Hollow pill: deliberate "not applicable".
        not_applicable:
          "rounded-full border-solid bg-[var(--pr-state-not-applicable-bg)] border-[var(--pr-state-not-applicable-border)] text-[var(--pr-state-not-applicable-fg)]",
      },
      size: {
        sm: "px-1.5 py-px text-[11px]",
        md: "px-2 py-0.5 text-xs",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

export interface FieldStateBadgeProps
  extends VariantProps<typeof fieldStateBadgeVariants> {
  state: NonPresentFieldState;
  className?: string;
}

/**
 * Renders one of the four non-present FieldState values.
 *
 * "present" never reaches this badge — call sites render the actual value
 * instead (see ObservationValue / ServingLine).
 *
 * Accessibility: the visible short label is duplicated for assistive tech as
 * `<short label>: <full explanation>` via role="img" + aria-label, so screen
 * reader users get the complete meaning without the long copy cluttering the
 * visual UI.
 */
export function FieldStateBadge({
  state,
  size,
  className,
}: FieldStateBadgeProps) {
  const { label, explanation } = FIELD_STATE_BADGE_COPY[state];
  const glyph = FIELD_STATE_GLYPH[state];

  return (
    <span
      aria-label={`${label}: ${explanation}`}
      className={cn(fieldStateBadgeVariants({ state, size }), className)}
      data-size={size ?? "md"}
      data-state={state}
      role="img"
    >
      {glyph ? (
        <span aria-hidden="true" className="font-semibold">
          {glyph}
        </span>
      ) : null}
      <span aria-hidden="true">{label}</span>
    </span>
  );
}
