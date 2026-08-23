import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  FileWarning,
  Layers3,
  Palette,
  Plus,
  Ruler,
  ShieldAlert,
  Type,
  Wheat,
  Zap,
} from "lucide-react";

import type { ChangeEventDto } from "@/server/products/queries";

import {
  eventLabel,
  fieldLabel,
  formatObservedAt,
  formatRelativeTime,
  pointQualifierText,
  pointValueText,
} from "./changes-model";
import styles from "./changes.module.css";

const EVENT_ICONS: Readonly<Record<string, typeof CircleDot>> = Object.freeze({
  caffeine_changed: Zap,
  serving_changed: Ruler,
  calories_changed: Wheat,
  sugar_changed: Wheat,
  source_level_changed: Layers3,
  variant_added: Plus,
  variant_changed: Layers3,
  flavour_added: Palette,
  flavour_state_changed: Palette,
  conflict_introduced: ShieldAlert,
  conflict_resolved: CheckCircle2,
  product_renamed: Type,
  page_missing: FileWarning,
});

function ChangePointView({
  value,
  side,
}: {
  value: ChangeEventDto["before"];
  side: "before" | "after";
}) {
  const qualifier = pointQualifierText(value);
  return (
    <span className={styles.point} data-side={side}>
      <span className={styles.pointValue}>{pointValueText(value, side)}</span>
      {qualifier ? <span className={styles.pointQualifier}>{qualifier}</span> : null}
    </span>
  );
}

function ChangeEntry({ change }: { change: ChangeEventDto }) {
  const Icon = EVENT_ICONS[change.eventType] ?? CircleDot;
  const observedAt = formatObservedAt(change.occurredAt);

  return (
    <article className={styles.entry} aria-labelledby={`change-${change.id}`}>
      <div className={styles.entryMarker} aria-hidden="true">
        <Icon size={19} strokeWidth={1.8} />
      </div>
      <div className={styles.entryWhen}>
        <time dateTime={change.occurredAt} title={observedAt}>
          {formatRelativeTime(change.occurredAt)}
        </time>
        <span>{observedAt}</span>
      </div>
      <div className={styles.card}>
        <div className={styles.cardLabel}>
          <Icon size={13} aria-hidden="true" />
          <span>{eventLabel(change.eventType)}</span>
        </div>
        <div className={styles.cardGrid}>
          <div className={styles.productColumn}>
            <Link
              className={styles.productLink}
              href={`/products/${change.slug}`}
              id={`change-${change.id}`}
              aria-label={`Open ${change.productName} product passport`}
            >
              <span className={styles.productGlyph} aria-hidden="true">
                <Icon size={17} strokeWidth={1.8} />
              </span>
              <span>
                <strong>{change.productName}</strong>
                <small>Product passport</small>
              </span>
            </Link>
          </div>

          <div className={styles.deltaColumn}>
            <span className={styles.fieldLabel}>{fieldLabel(change.field)}</span>
            <div className={styles.pointPair} aria-label={`${fieldLabel(change.field)} before and after`}>
              <ChangePointView value={change.before} side="before" />
              <ArrowRight className={styles.arrow} size={17} aria-hidden="true" />
              <ChangePointView value={change.after} side="after" />
            </div>
          </div>

          <div className={styles.sourceColumn}>
            <span className={styles.fieldLabel}>Source snapshot</span>
            {change.sourceUrl ? (
              <a href={change.sourceUrl} className={styles.contextLink} target="_blank" rel="noreferrer noopener">
                Caffeine Informer source <ArrowUpRight size={13} aria-hidden="true" />
              </a>
            ) : <span className={styles.sourceUnavailable}>Source URL not published</span>}
          </div>
        </div>
      </div>
    </article>
  );
}

export function ChangesLedger({ items }: { items: ChangeEventDto[] }) {
  return (
    <div className={styles.timeline} aria-label="Trusted product changes">
      {items.map((change) => <ChangeEntry change={change} key={change.id} />)}
    </div>
  );
}

export function ChangesEmptyState({ filtered, hasCursor, hasNextPage, rawPageHasItems }: { filtered: boolean; hasCursor: boolean; hasNextPage: boolean; rawPageHasItems: boolean }) {
  const cursorAtEnd = hasCursor && !rawPageHasItems && !hasNextPage;
  const title = cursorAtEnd
    ? "No more trusted events in history"
    : filtered && rawPageHasItems
      ? "No loaded events match this filter"
      : "No trusted changes recorded";
  return (
    <section className={styles.emptyState} aria-labelledby="changes-empty-title">
      <div className={styles.emptyIcon} aria-hidden="true"><AlertTriangle size={21} /></div>
      <div>
        <h2 id="changes-empty-title">
          {title}
        </h2>
        <p>
          {cursorAtEnd
            ? "This cursor page is beyond the last available trusted event. Return to the first page to review the newest history."
            : filtered && rawPageHasItems
            ? "Try another event group or return to all loaded events."
              : "A change appears only when a later trusted observation differs from the previous trusted record. Candidate, quarantined, and failed runs never enter this ledger."}
        </p>
        {(filtered || hasCursor) ? <Link href="/changes" className={styles.textLink}>Show all loaded events <ArrowRight size={13} aria-hidden="true" /></Link> : null}
      </div>
    </section>
  );
}
