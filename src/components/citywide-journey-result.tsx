"use client";

import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Clock3,
  ExternalLink,
  Info,
  Route,
} from "lucide-react";
import { useEffect, useRef } from "react";

import {
  presentJourneyResult,
  type JourneyResultView,
} from "@/domain/journey/journey-result";
import { formatPacific } from "@/lib/format";

export type CitywideJourneyResultProps = {
  plan: unknown;
};

const WALK_CAVEAT =
  "This path avoids mapped stairs. Some sidewalk details may be missing.";

function formatInstant(value: string | null) {
  return formatPacific(value ? new Date(value) : null);
}

function formatMinutes(value: number) {
  return `${value} minute${value === 1 ? "" : "s"}`;
}

function StatusIcon({ status }: Pick<JourneyResultView, "status">) {
  const Icon =
    status === "confirmed"
      ? CircleCheck
      : status === "check_details"
        ? CircleAlert
        : status === "unavailable"
          ? CircleHelp
          : Info;
  return <Icon aria-hidden="true" className="size-5 shrink-0" />;
}

function SourceCard({
  source,
  index,
}: {
  source: JourneyResultView["sources"][number];
  index: number;
}) {
  return (
    <li
      className="min-w-0 rounded-lg border bg-background/65 p-3 text-sm"
      key={`source-${index}-${source.sourceLabel}`}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="break-words font-semibold">{source.sourceLabel}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">
              {source.freshnessLabel}
            </span>
          </p>
        </div>
        <a
          className="inline-flex w-fit shrink-0 items-center gap-1 font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          href={source.sourceUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Official source
          <ExternalLink aria-hidden="true" className="size-3.5" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <div className="mt-3 flex min-w-0 flex-col gap-1 text-xs leading-5 text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-4">
        <span className="break-words">
          <strong className="font-semibold text-foreground">
            Checked by UNBROKEN at
          </strong>{" "}
          {source.checkedAt ? (
            <time dateTime={source.checkedAt}>
              {formatInstant(source.checkedAt)}
            </time>
          ) : (
            "Unavailable"
          )}
        </span>
        {source.sourceUpdatedAt && (
          <span className="break-words">
            <strong className="font-semibold text-foreground">
              SFMTA updated at
            </strong>{" "}
            <time dateTime={source.sourceUpdatedAt}>
              {formatInstant(source.sourceUpdatedAt)}
            </time>
          </span>
        )}
      </div>
    </li>
  );
}

function JourneyStep({
  leg,
  index,
}: {
  leg: JourneyResultView["legs"][number];
  index: number;
}) {
  return (
    <li
      className="min-w-0 rounded-xl border bg-background/65 p-4"
      key={`leg-${index}`}
    >
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-semibold">{leg.typeLabel}</h3>
        <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Clock3 aria-hidden="true" className="size-3.5" />
          {formatMinutes(leg.durationMinutes)}
        </span>
      </div>
      <p className="mt-3 flex min-w-0 items-start gap-2 break-words text-sm font-medium">
        <span className="min-w-0">{leg.from}</span>
        <ArrowRight
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0">{leg.to}</span>
      </p>
      <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
        {leg.instruction}
      </p>
      {leg.route && (
        <p className="mt-2 break-words text-sm">
          <span className="font-medium">{leg.route.name}</span>
          <span className="text-muted-foreground">
            {" "}
            toward {leg.route.destination}
          </span>
        </p>
      )}
      <p className="mt-3 break-words text-xs leading-5 text-muted-foreground">
        <time dateTime={leg.startAt}>{formatInstant(leg.startAt)}</time>
        {" – "}
        <time dateTime={leg.endAt}>{formatInstant(leg.endAt)}</time>
      </p>
      <p className="mt-2 break-words text-xs font-medium text-foreground">
        {leg.accessibilityLabel}
      </p>
      {leg.typeLabel === "Walk" && (
        <p className="mt-3 break-words rounded-lg bg-muted/60 p-3 text-xs leading-5 text-muted-foreground">
          {WALK_CAVEAT}
        </p>
      )}
    </li>
  );
}

function NoticeList({
  title,
  items,
  kind,
}: {
  title: string;
  items: string[];
  kind: "warning" | "change";
}) {
  if (items.length === 0) return null;
  const Icon = kind === "warning" ? CircleAlert : Info;
  const headingId = `journey-${kind}-heading`;

  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <h3
        className="flex items-center gap-2 text-base font-semibold"
        id={headingId}
      >
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {title}
      </h3>
      <ul className="space-y-2 text-sm leading-6">
        {items.map((item, index) => (
          <li
            className="flex min-w-0 items-start gap-2 rounded-lg border bg-muted/30 p-3"
            key={`${kind}-${index}`}
          >
            <span
              aria-hidden="true"
              className="mt-2 size-1.5 shrink-0 rounded-full bg-current"
            />
            <span className="min-w-0 break-words">{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CitywideJourneyResult({ plan }: CitywideJourneyResultProps) {
  const result = presentJourneyResult(plan);
  const resultRef = useRef<HTMLElement>(null);
  const previousResultKey = useRef<string | null>(null);
  const didMount = useRef(false);

  useEffect(() => {
    const resultKey = result
      ? `${result.status}|${result.departureAt}|${result.arrivalAt}|${result.summary}`
      : null;
    if (
      result &&
      didMount.current &&
      (previousResultKey.current === null ||
        previousResultKey.current !== resultKey)
    ) {
      resultRef.current?.focus({ preventScroll: true });
    }
    previousResultKey.current = resultKey;
    didMount.current = true;
  }, [result]);

  if (!result) return null;

  const headingId = "citywide-journey-result-heading";

  return (
    <section
      aria-label="Journey result"
      className="min-w-0 space-y-5 border-t pt-5"
      ref={resultRef}
      role="region"
      tabIndex={-1}
    >
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 items-start gap-2 text-base font-semibold">
          <StatusIcon status={result.status} />
          <h2 className="min-w-0 break-words" id={headingId}>
            {result.statusLabel}
          </h2>
        </div>
        <p aria-live="polite" className="sr-only" role="status">
          {result.statusLabel}
        </p>
        <p className="break-words text-sm leading-6 text-muted-foreground">
          {result.summary}
        </p>
        <div className="grid gap-3 rounded-xl border bg-muted/25 p-4 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Estimated arrival
            </p>
            <time
              className="mt-1 block break-words text-base font-semibold"
              dateTime={result.arrivalAt}
            >
              {formatInstant(result.arrivalAt)}
            </time>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
              Duration
            </p>
            <p className="mt-1 break-words text-base font-semibold">
              {formatMinutes(result.durationMinutes)}
            </p>
          </div>
        </div>
      </div>

      <section aria-labelledby="journey-sources-heading" className="space-y-3">
        <div className="flex items-center gap-2">
          <Route aria-hidden="true" className="size-4 shrink-0" />
          <h3 className="text-base font-semibold" id="journey-sources-heading">
            Sources checked
          </h3>
        </div>
        {result.sources.length > 0 ? (
          <ul
            className="grid min-w-0 gap-3 sm:grid-cols-2"
            aria-label="Journey sources"
          >
            {result.sources.map((source, index) => (
              <SourceCard
                index={index}
                key={`source-${index}`}
                source={source}
              />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            Source details are unavailable.
          </p>
        )}
      </section>

      <section aria-labelledby="journey-steps-heading" className="space-y-3">
        <h3 className="text-base font-semibold" id="journey-steps-heading">
          Journey steps
        </h3>
        {result.legs.length > 0 ? (
          <ol className="grid min-w-0 gap-3" aria-label="Journey steps">
            {result.legs.map((leg, index) => (
              <JourneyStep index={index} key={`leg-${index}`} leg={leg} />
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
            No confirmed steps are available for this result.
          </p>
        )}
      </section>

      {(result.warnings.length > 0 || result.changes.length > 0) && (
        <div className="grid min-w-0 gap-5 sm:grid-cols-2">
          <NoticeList items={result.warnings} kind="warning" title="Warnings" />
          <NoticeList items={result.changes} kind="change" title="Changes" />
        </div>
      )}
    </section>
  );
}

export default CitywideJourneyResult;
