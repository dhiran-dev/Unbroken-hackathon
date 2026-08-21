import type { NumberObservation } from "@/domain/product/contracts/observations";
import { cn } from "@/lib/utils";

import "./tokens.css";

export type NumberQualifier = NumberObservation["qualifier"];

/**
 * Short chip copy per qualifier. "exact" maps to null — exact numbers carry no
 * tag, the number speaks for itself.
 */
export const QUALIFIER_TAG_COPY: Record<NumberQualifier, string | null> = {
  exact: null,
  range: "Range",
  approximate: "Approx.",
  estimated: "Est.",
  unknown: "Unknown",
};

const qualifierTagVariants = {
  sm: "px-1 py-px text-[10px]",
  md: "px-1.5 py-0.5 text-[11px]",
} as const;

export interface QualifierTagProps {
  qualifier: NumberQualifier;
  size?: keyof typeof qualifierTagVariants;
  className?: string;
}

/**
 * Precision chip rendered next to numbers: "75–80 mg" gains a Range tag,
 * "~95 mg" an Approx. tag, "est. 12 g" an Est. tag. Exact values render
 * nothing. Styling stays inside the neutral accent family on purpose — a
 * qualifier is metadata about confidence, not a field state, so it must never
 * be confused with FieldStateBadge severity colors.
 */
export function QualifierTag({
  qualifier,
  size = "md",
  className,
}: QualifierTagProps) {
  const label = QUALIFIER_TAG_COPY[qualifier];

  if (label === null) {
    return null;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border bg-[var(--pr-accent-subtle-bg)] border-[var(--pr-accent-border)] font-medium uppercase leading-none tracking-wide text-[var(--pr-accent-strong)]",
        qualifierTagVariants[size],
        className,
      )}
      data-qualifier={qualifier}
      data-size={size}
    >
      {label}
    </span>
  );
}
