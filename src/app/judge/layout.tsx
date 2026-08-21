import type { Metadata } from "next";

import { pulserankServerFlags } from "@/config/pulserank-flags";
import "@/components/pulserank/ui/tokens.css";

export const metadata: Metadata = {
  title: "Judge Cockpit",
  description:
    "HTML-first evidence cockpit for the PulseRank Bright Data healing pipeline: real artifacts, computed verdicts, flag-gated demo mutations.",
};

/**
 * Judge cockpit shell (Agent A12). Dark studio surfaces via the shared
 * PulseRank tokens; no client-side theming required — the cockpit is a
 * server-rendered document.
 */
export default function JudgeLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="min-h-screen bg-[var(--pr-surface-0)] text-[var(--pr-text-primary)]">
      <header className="border-b border-[var(--pr-accent-border)] bg-[var(--pr-surface-1)]">
        <div className="mx-auto flex max-w-5xl flex-col gap-1 px-4 py-6 sm:px-6">
          <p className="text-xs font-medium uppercase tracking-widest text-[var(--pr-accent-strong)]">
            PulseRank · Agent A12 · Judge Cockpit
          </p>
          <h1 className="text-xl font-semibold sm:text-2xl">
            Bright Data healing evidence — collector{" "}
            <span className="font-mono text-[var(--pr-accent-strong)]">c_mt2yacvcyvyvim56d</span>
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-[var(--pr-text-muted)]">
            Every value below is read from recorded CLI artifacts under{" "}
            <code className="font-mono">artifacts/scraper/</code> at request time, and every
            verdict is computed live by the production contract, validation, and promotion code.
            Nothing is mocked; missing artifacts render as explicitly unavailable. Mutation
            controls are fail-closed behind{" "}
            <code className="font-mono">PULSERANK_JUDGE_MUTATIONS_ENABLED</code> (currently{" "}
            <strong>{pulserankServerFlags.judgeMutationsEnabled ? "ENABLED" : "disabled"}</strong>).
          </p>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-5xl px-4 pb-10 pt-2 text-xs leading-relaxed text-[var(--pr-text-muted)] sm:px-6">
        <p>
          Read-only by default · demo mutations write only under{" "}
          <code className="font-mono">artifacts/demo/</code> · recorded evidence under{" "}
          <code className="font-mono">artifacts/scraper/</code> is never modified · legacy
          UNBROKEN admin routes are untouched.
        </p>
      </footer>
    </div>
  );
}
