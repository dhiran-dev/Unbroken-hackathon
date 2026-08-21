import { cn } from "@/lib/utils";

/** The four states a judge pipeline step can be in. */
export type JudgeStepStatus = "ok" | "attention" | "failed" | "unavailable";

const STATUS_COPY: Record<JudgeStepStatus, { label: string; className: string; glyph: string }> = {
  ok: {
    label: "Verified",
    className:
      "bg-[var(--pr-success-bg)] border-[var(--pr-success-border)] text-[var(--pr-success)]",
    glyph: "✓",
  },
  attention: {
    label: "Attention",
    className: "bg-[var(--pr-warn-bg)] border-[var(--pr-warn-border)] text-[var(--pr-warn)]",
    glyph: "!",
  },
  failed: {
    label: "Failed",
    className:
      "bg-[var(--pr-danger-bg)] border-[var(--pr-danger-border)] text-[var(--pr-danger)]",
    glyph: "✕",
  },
  unavailable: {
    label: "Unavailable",
    className: "bg-transparent border-dashed border-[var(--pr-text-muted)] text-[var(--pr-text-muted)]",
    glyph: "–",
  },
};

export function JudgeStatusChip({
  status,
  label,
}: {
  status: JudgeStepStatus;
  /** Optional more-specific visible label (e.g. the real computed verdict). */
  label?: string;
}) {
  const copy = STATUS_COPY[status];
  return (
    <span
      data-status={status}
      aria-label={`${copy.label}: ${label ?? copy.label}`}
      role="img"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium uppercase leading-none tracking-wide",
        copy.className,
      )}
    >
      <span aria-hidden="true">{copy.glyph}</span>
      <span aria-hidden="true">{label ?? copy.label}</span>
    </span>
  );
}

export interface JudgeStepCardProps {
  /** 1-based position in the pipeline stepper. */
  index: number;
  /** Stable DOM id (also the anchor target for mutation redirects). */
  id: string;
  title: string;
  status: JudgeStepStatus;
  statusLabel?: string;
  summary: string;
  children?: React.ReactNode;
}

/**
 * One card of the 10-step evidence pipeline. Everything renders as plain
 * server HTML: the cockpit stays fully readable with JavaScript disabled.
 */
export function JudgeStepCard({
  index,
  id,
  title,
  status,
  statusLabel,
  summary,
  children,
}: JudgeStepCardProps) {
  return (
    <section
      id={`step-${id}`}
      data-step-id={id}
      aria-labelledby={`step-${id}-title`}
      className="scroll-mt-24 rounded-lg border border-[var(--pr-accent-border)] bg-[var(--pr-surface-1)] p-4 sm:p-5"
    >
      <header className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <span
          aria-hidden="true"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--pr-accent-border)] bg-[var(--pr-accent-subtle-bg)] text-sm font-semibold text-[var(--pr-accent-strong)]"
        >
          {index}
        </span>
        <h2
          id={`step-${id}-title`}
          className="text-base font-semibold text-[var(--pr-text-primary)] sm:text-lg"
        >
          {index}. {title}
        </h2>
        <JudgeStatusChip status={status} label={statusLabel} />
      </header>
      <p className="mb-4 max-w-3xl text-sm leading-relaxed text-[var(--pr-text-muted)]">
        {summary}
      </p>
      {children ? <div className="space-y-4">{children}</div> : null}
    </section>
  );
}
