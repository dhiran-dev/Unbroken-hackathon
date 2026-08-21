import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Small shared presentational bits for the judge cockpit (server-rendered). */

export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "break-all rounded bg-black/40 px-1.5 py-0.5 font-mono text-[13px] text-[var(--pr-text-primary)]",
        className,
      )}
    >
      {children}
    </span>
  );
}

export type VerdictTone = "pass" | "fail" | "warn" | "info";

const VERDICT_CLASS: Record<VerdictTone, string> = {
  pass: "bg-[var(--pr-success-bg)] border-[var(--pr-success-border)] text-[var(--pr-success)]",
  fail: "bg-[var(--pr-danger-bg)] border-[var(--pr-danger-border)] text-[var(--pr-danger)]",
  warn: "bg-[var(--pr-warn-bg)] border-[var(--pr-warn-border)] text-[var(--pr-warn)]",
  info: "bg-[var(--pr-info-bg)] border-[var(--pr-info-border)] text-[var(--pr-info)]",
};

export function VerdictChip({
  tone,
  children,
}: {
  tone: VerdictTone;
  children: ReactNode;
}) {
  return (
    <span
      data-tone={tone}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide",
        VERDICT_CLASS[tone],
      )}
    >
      {children}
    </span>
  );
}

export function KeyValue({
  label,
  children,
  mono,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
      <dt className="shrink-0 text-xs uppercase tracking-wide text-[var(--pr-text-muted)]">
        {label}
      </dt>
      <dd className={mono ? "break-all font-mono text-[13px] text-[var(--pr-text-primary)]" : "text-sm text-[var(--pr-text-primary)]"}>
        {children}
      </dd>
    </div>
  );
}

export function KeyValueList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col gap-2", className)}>{children}</dl>
  );
}

export function Callout({
  tone,
  title,
  children,
}: {
  tone: VerdictTone;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      data-tone={tone}
      className={cn(
        "rounded-md border px-3 py-2.5 text-sm leading-relaxed",
        VERDICT_CLASS[tone],
      )}
    >
      <p className="font-semibold">{title}</p>
      <div className="mt-1 text-[13px] opacity-90">{children}</div>
    </div>
  );
}
