import { cn } from "@/lib/utils";

/**
 * Server-rendered JSON viewer with syntax coloring, built from a <pre> of
 * React spans (no dangerouslySetInnerHTML, no client JS — the coloring is
 * computed at request time on the server).
 *
 * Token classes: keys (accent purple), strings (green), numbers (amber),
 * literals (info blue), punctuation (muted).
 */

const MAX_JSON_CHARS = 20_000;

const TOKEN_PATTERN =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

type JsonToken = { text: string; kind: "key" | "string" | "number" | "literal" | "plain" };

function tokenize(text: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(TOKEN_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ text: text.slice(lastIndex, index), kind: "plain" });
    }
    if (match[1] !== undefined) {
      if (match[2] !== undefined) {
        tokens.push({ text: match[1], kind: "key" });
        tokens.push({ text: match[2], kind: "plain" });
      } else {
        tokens.push({ text: match[1], kind: "string" });
      }
    } else if (match[3] !== undefined) {
      tokens.push({ text: match[3]!, kind: "literal" });
    } else if (match[4] !== undefined) {
      tokens.push({ text: match[4]!, kind: "number" });
    }
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) {
    tokens.push({ text: text.slice(lastIndex), kind: "plain" });
  }
  return tokens;
}

const TOKEN_CLASS: Record<JsonToken["kind"], string | null> = {
  key: "text-[var(--pr-accent-strong)]",
  string: "text-[var(--pr-success)]",
  number: "text-[var(--pr-warn)]",
  literal: "text-[var(--pr-info)]",
  plain: null,
};

export interface JsonViewerProps {
  value: unknown;
  /** Accessible label for the block (rendered as the heading/caption). */
  label: string;
  className?: string;
  /** Render the raw value as-is instead of pretty-printing. */
  rawText?: string;
}

export function JsonViewer({ value, label, className, rawText }: JsonViewerProps) {
  const full = rawText ?? JSON.stringify(value, null, 2);
  const truncated = full.length > MAX_JSON_CHARS;
  const text = truncated ? `${full.slice(0, MAX_JSON_CHARS)}\n… truncated (${full.length} chars total)` : full;

  return (
    <figure
      className={cn(
        "overflow-hidden rounded-md border border-[var(--pr-accent-border)] bg-black/40",
        className,
      )}
    >
      <figcaption className="border-b border-[var(--pr-accent-border)] bg-[var(--pr-accent-subtle-bg)] px-3 py-1.5 text-xs font-medium uppercase tracking-wide text-[var(--pr-accent-strong)]">
        {label}
      </figcaption>
      <pre
        data-testid="json-viewer"
        className="max-h-96 overflow-auto p-3 text-xs leading-relaxed text-[var(--pr-text-muted)]"
      >
        <code>
          {tokenize(text).map((token, i) => {
            const cls = TOKEN_CLASS[token.kind];
            return cls === null ? (
              <span key={i}>{token.text}</span>
            ) : (
              <span key={i} className={cls}>
                {token.text}
              </span>
            );
          })}
        </code>
      </pre>
    </figure>
  );
}
