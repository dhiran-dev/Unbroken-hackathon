import type { ServingObservation } from "@/domain/product/contracts/observations";
import { cn } from "@/lib/utils";

import { FieldStateBadge } from "./field-state-badge";
import "./tokens.css";

/** Volume/mass units render as "<value> <unit>" — "250 ml", "60 g". */
type ServingUnit = NonNullable<ServingObservation["unit"]>;

const VOLUME_MASS_UNIT_LABELS = {
  ml: "ml",
  fl_oz: "fl oz",
  oz: "oz",
  g: "g",
} as const satisfies Partial<Record<ServingUnit, string>>;

/** Container units render as "<normalizedMl> ml <container>" — "250 ml can". */
const CONTAINER_UNIT_LABELS = {
  can: "can",
  bottle: "bottle",
  cup: "cup",
  shot: "shot",
} as const satisfies Partial<Record<ServingUnit, string>>;

/** Per-item units render as "per <item>" — "per mint", "per candy piece". */
const ITEM_UNIT_LABELS = {
  mint: "mint",
  candy: "candy piece",
  gum_piece: "gum piece",
  tablet: "tablet",
  packet: "packet",
  serving: "serving",
  item: "item",
} as const satisfies Partial<Record<ServingUnit, string>>;

export type ResolvedServingLine =
  | { kind: "text"; text: string }
  | { kind: "unparseable" };

/**
 * Pure resolver behind ServingLine, exported for reuse and direct testing.
 *
 * Priority per unit family:
 * - container (can/bottle/cup/shot): "<normalizedMl> ml <container>", falling
 *   back to rawText, then "<value> <container>", then the bare container word;
 * - volume/mass (ml/fl_oz/oz/g): "<value> <unit>", falling back to rawText;
 * - per-item (mint/candy/gum_piece/tablet/packet/serving/item): "per <item>";
 * - unknown/null unit: rawText verbatim, else "unparseable" so the line never
 *   invents a serving size.
 */
export function resolveServingLine(
  serving: Pick<ServingObservation, "unit" | "value" | "normalizedMl" | "rawText">,
): ResolvedServingLine {
  const { unit, value, normalizedMl, rawText } = serving;

  if (unit !== null && unit in ITEM_UNIT_LABELS) {
    return {
      kind: "text",
      text: `per ${ITEM_UNIT_LABELS[unit as keyof typeof ITEM_UNIT_LABELS]}`,
    };
  }

  if (unit !== null && unit in CONTAINER_UNIT_LABELS) {
    const container =
      CONTAINER_UNIT_LABELS[unit as keyof typeof CONTAINER_UNIT_LABELS];

    if (normalizedMl !== null) {
      return { kind: "text", text: `${normalizedMl} ml ${container}` };
    }
    if (rawText !== null) {
      return { kind: "text", text: rawText };
    }
    return {
      kind: "text",
      text: value !== null ? `${value} ${container}` : container,
    };
  }

  if (unit !== null && unit in VOLUME_MASS_UNIT_LABELS) {
    const label =
      VOLUME_MASS_UNIT_LABELS[unit as keyof typeof VOLUME_MASS_UNIT_LABELS];

    if (value !== null) {
      return { kind: "text", text: `${value} ${label}` };
    }
    if (rawText !== null) {
      return { kind: "text", text: rawText };
    }
    return { kind: "text", text: label };
  }

  // Unknown or missing unit: rawText is the honest fallback; without it the
  // observation cannot be represented as a value, so degrade to a badge.
  if (rawText !== null) {
    return { kind: "text", text: rawText };
  }
  return { kind: "unparseable" };
}

export interface ServingLineProps {
  serving: ServingObservation;
  className?: string;
}

/**
 * Renders a ServingObservation as a compact serving-size line:
 * "250 ml can", "per mint", "per candy piece", "60 g". Non-present states and
 * unrepresentable values render FieldStateBadge instead — never a guess.
 *
 * The `form` field is intentionally not rendered in these V1 primitives; it
 * informs future layout work (e.g. product-type icons), not the line copy.
 */
export function ServingLine({ serving, className }: ServingLineProps) {
  if (serving.state !== "present") {
    return <FieldStateBadge state={serving.state} className={className} />;
  }

  const resolved = resolveServingLine(serving);

  if (resolved.kind === "unparseable") {
    return <FieldStateBadge state="unparseable" className={className} />;
  }

  return (
    <span
      className={cn(
        "inline-flex items-baseline text-[var(--pr-text-primary)]",
        className,
      )}
      data-unit={serving.unit ?? "unknown"}
    >
      {resolved.text}
    </span>
  );
}
