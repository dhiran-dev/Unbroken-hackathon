import { healPreviewAction, rerunCollectorAction } from "@/server/judge/actions";
import { Callout } from "./bits";

/**
 * Flag-gated mutation controls for /judge.
 *
 * When PULSERANK_JUDGE_MUTATIONS_ENABLED is false (the default), every form is
 * replaced by a locked-state panel explaining exactly which flag and token
 * unlock it. When enabled, the form posts to the server action with a token
 * field; the action re-verifies the gate server-side before any service call.
 * Plain form POST + redirect: works with JavaScript disabled.
 */

export interface MutationControlsProps {
  kind: "heal-preview" | "rerun";
  enabled: boolean;
  /** Default target page (the collector's registered Sting PDP). */
  sourceUrl: string;
  /** Real recorded heal prompt, offered as the prefilled draft. */
  defaultPrompt?: string;
}

export function MutationControls({ kind, enabled, sourceUrl, defaultPrompt }: MutationControlsProps) {
  if (!enabled) {
    return (
      <Callout tone="info" title="Mutations locked (read-only cockpit)">
        <p>
          Live heal previews and collector reruns are disabled because{" "}
          <code className="font-mono">PULSERANK_JUDGE_MUTATIONS_ENABLED</code> is{" "}
          <code className="font-mono">false</code> (the safe default). Everything on this page is
          the recorded artifact history and is fully auditable without mutations.
        </p>
        <p className="mt-2">
          To unlock demo mutations, an operator must set{" "}
          <code className="font-mono">PULSERANK_JUDGE_MUTATIONS_ENABLED=true</code> AND configure a
          server-side{" "}
          <code className="font-mono">PULSERANK_JUDGE_TOKEN</code>, then submit that token with the
          form. Even then, results are written only under{" "}
          <code className="font-mono">artifacts/demo/</code> — recorded evidence under{" "}
          <code className="font-mono">artifacts/scraper/</code> is never modified.
        </p>
      </Callout>
    );
  }

  const action = kind === "heal-preview" ? healPreviewAction : rerunCollectorAction;

  return (
    <form action={action} className="rounded-md border border-[var(--pr-warn-border)] bg-[var(--pr-warn-bg)] p-3">
      <p className="mb-3 text-[13px] leading-relaxed text-[var(--pr-warn)]">
        Mutations are <strong>enabled</strong>. This runs against the live collector
        {" "}<code className="font-mono">c_mt2yacvcyvyvim56d</code> and writes the envelope under{" "}
        <code className="font-mono">artifacts/demo/</code>. The token is re-verified server-side.
      </p>
      <input type="hidden" name="sourceUrl" value={sourceUrl} />
      {kind === "heal-preview" ? (
        <label className="mb-3 block text-xs uppercase tracking-wide text-[var(--pr-text-muted)]">
          Heal prompt (what is broken and what the page really says)
          <textarea
            name="prompt"
            rows={4}
            required
            minLength={10}
            maxLength={2000}
            defaultValue={defaultPrompt}
            className="mt-1 w-full rounded border border-[var(--pr-accent-border)] bg-black/40 p-2 font-mono text-[13px] text-[var(--pr-text-primary)]"
          />
        </label>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-xs uppercase tracking-wide text-[var(--pr-text-muted)]">
          Judge token
          <input
            type="password"
            name="token"
            required
            autoComplete="off"
            className="mt-1 block w-56 rounded border border-[var(--pr-accent-border)] bg-black/40 px-2 py-1.5 font-mono text-sm text-[var(--pr-text-primary)]"
          />
        </label>
        <button
          type="submit"
          className="rounded-md border border-[var(--pr-accent-border)] bg-[var(--pr-accent-deep)] px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--pr-accent-foreground)] hover:bg-[var(--pr-accent)]"
        >
          {kind === "heal-preview" ? "Request heal preview" : "Rerun same collector"}
        </button>
      </div>
    </form>
  );
}
