import type { NumberObservation } from "@/domain/product/contracts/observations";
import type { ProductScrapeRowV1 } from "@/domain/product/contracts/product-scrape-row";
import { type NonPresentFieldState, FieldStateBadge } from "@/components/pulserank/ui/field-state-badge";
import { ObservationValue } from "@/components/pulserank/ui/observation-value";
import { ServingLine } from "@/components/pulserank/ui/serving-line";
import { cn } from "@/lib/utils";

import { CopyButton } from "./copy-button";
import { Mono } from "./bits";

/**
 * Renders the RAW Bright Data collector record fields verbatim (the artifact's
 * own values), flagging the field that carries the unit bug when present.
 * Values that map onto contract observations additionally render through the
 * shared PulseRank primitives (ObservationValue / ServingLine /
 * FieldStateBadge) so state rendering never diverges from the product UI.
 */

function RawValue({ value }: { value: unknown }) {
  if (value === undefined) return <span className="text-[var(--pr-text-muted)]">absent</span>;
  if (value === null) return <span className="text-[var(--pr-text-muted)]">null</span>;
  return <span>{typeof value === "object" ? JSON.stringify(value) : String(value)}</span>;
}

const RECORD_FIELDS = [
  "product_name",
  "brand",
  "beverage_type",
  "serving_size",
  "caffeine_mg_per_serving",
  "caffeine_mg_per_100ml",
  "caffeine_strength_level",
] as const;

export interface CollectorRecordTableProps {
  record: Record<string, unknown>;
  /** Collector fields to visually flag (e.g. the buggy caffeine figure). */
  flaggedFields?: readonly string[];
  /** Mapped contract observations shown beside their raw source fields. */
  caffeineObservation?: NumberObservation | null;
  servingObservation?: ProductScrapeRowV1["primary"]["serving"] | null;
  sourceUrl?: string | null;
}

export function CollectorRecordTable({
  record,
  flaggedFields = [],
  caffeineObservation,
  servingObservation,
  sourceUrl,
}: CollectorRecordTableProps) {
  return (
    <div className="overflow-hidden rounded-md border border-[var(--pr-accent-border)]">
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">Bright Data collector record fields</caption>
        <thead>
          <tr className="bg-[var(--pr-accent-subtle-bg)] text-left text-xs uppercase tracking-wide text-[var(--pr-accent-strong)]">
            <th scope="col" className="px-3 py-2 font-medium">
              Collector field
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Published value (verbatim)
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Contract mapping
            </th>
          </tr>
        </thead>
        <tbody>
          {RECORD_FIELDS.map((field) => {
            const flagged = flaggedFields.includes(field);
            return (
              <tr key={field} className="border-t border-white/5 align-top">
                <th
                  scope="row"
                  className="px-3 py-2 text-left font-mono text-xs text-[var(--pr-text-muted)]"
                >
                  {field}
                  {flagged ? (
                    <span className="mt-1 block normal-case text-[11px] font-semibold text-[var(--pr-danger)]">
                      ⚠ flagged by validation
                    </span>
                  ) : null}
                </th>
                <td
                  className={cn(
                    "px-3 py-2 font-mono text-[13px]",
                    flagged ? "text-[var(--pr-danger)]" : "text-[var(--pr-text-primary)]",
                  )}
                >
                  <RawValue value={record[field]} />
                </td>
                <td className="px-3 py-2">
                  {field === "caffeine_mg_per_serving" && caffeineObservation ? (
                    <span className="inline-flex items-center gap-2">
                      <ObservationValue observation={caffeineObservation} unit="mg" size="sm" />
                      {caffeineObservation.candidates.length > 0 ? (
                        <span className="font-mono text-[11px] text-[var(--pr-text-muted)]">
                          candidates [{caffeineObservation.candidates.join(", ")}]
                        </span>
                      ) : null}
                    </span>
                  ) : field === "serving_size" && servingObservation ? (
                    <ServingLine serving={servingObservation} />
                  ) : (
                    <span className="text-[13px] text-[var(--pr-text-muted)]">—</span>
                  )}
                </td>
              </tr>
            );
          })}
          {sourceUrl !== null && sourceUrl !== undefined ? (
            <tr className="border-t border-white/5 align-top">
              <th scope="row" className="px-3 py-2 text-left font-mono text-xs text-[var(--pr-text-muted)]">
                input.url
              </th>
              <td colSpan={2} className="px-3 py-2">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Mono>{sourceUrl}</Mono>
                  <CopyButton text={sourceUrl} label="Copy URL" />
                </span>
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

/** Compact list of the not-published contract fields for a mapped row. */
export function NotPublishedList({
  states,
}: {
  states: ReadonlyArray<{ label: string; state: NonPresentFieldState }>;
}) {
  return (
    <ul className="flex flex-wrap gap-2">
      {states.map(({ label, state }) => (
        <li key={label} className="inline-flex items-center gap-2 text-xs text-[var(--pr-text-muted)]">
          <FieldStateBadge state={state} size="sm" />
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}
