"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

export interface CopyButtonProps {
  text: string;
  label?: string;
  className?: string;
}

/**
 * Progressive-enhancement copy button. The cockpit is fully readable with JS
 * disabled — this button merely copies the adjacent evidence text; it never
 * carries content that isn't already visible in the page.
 */
export function CopyButton({ text, label = "Copy", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions / no JS runtime niceties): stay quiet.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      data-copied={copied || undefined}
      aria-label={`Copy ${label}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-md border border-[var(--pr-accent-border)] bg-[var(--pr-accent-subtle-bg)] px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-[var(--pr-accent-strong)] hover:bg-[var(--pr-accent-deep)]/30",
        className,
      )}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
