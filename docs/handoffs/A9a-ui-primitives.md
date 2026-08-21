# A9a Handoff — PulseRank Field-State UI Primitives

**Status: DONE — semantics-first primitives with placeholder tokens; reskin-ready.**

Branch `agent/design-system` (worktree `.worktrees/design-system`), fast-forwarded
onto `pulserank-rebuild` before starting.

## What was created

Under `src/components/pulserank/ui/`:

| File | Purpose |
| --- | --- |
| `tokens.css` | `:root`-scoped `--pr-*` custom properties: near-black surfaces (`#050208` / `#0a0612`), purple accent family anchored on `#a855f7`, success/warn/danger/info, text primary/muted, and a FieldState → visual mapping layer. |
| `field-state-badge.tsx` | `FieldStateBadge` — renders one of the four non-present `FieldState` values. `present` never reaches it; call sites render values instead (via `ObservationValue` / `ServingLine`). |
| `qualifier-tag.tsx` | `QualifierTag` — precision chip for number qualifiers: Range / Approx. / Est. / Unknown; `exact` renders nothing. |
| `observation-value.tsx` | `ObservationValue` — renders a `NumberObservation`-shaped object per the contract. |
| `serving-line.tsx` | `ServingLine` (+ pure `resolveServingLine` helper) — renders a `ServingObservation` as a serving-size line. |

Tests (repo component-test pattern: `react-dom/server` `renderToStaticMarkup`
assertions, `.test.tsx` + one-line `.test.ts` shim so the existing vitest glob
`tests/unit/**/*.test.ts` picks them up — no vitest config changes):

| File | Coverage |
| --- | --- |
| `tests/unit/components/pulserank/ui/field-state-badge.test.tsx` | All four states: label, `aria-label` = label + full explanation, pairwise-distinct styling, shape/glyph markers, sm/md sizes. |
| `tests/unit/components/pulserank/ui/qualifier-tag.test.tsx` | All five qualifiers; exact → empty output; data attributes; sizes. |
| `tests/unit/components/pulserank/ui/observation-value.test.tsx` | All five states + exact/range/approximate/estimated/unknown rendering, unit appending, decimal-noise trimming. |
| `tests/unit/components/pulserank/ui/serving-line.test.tsx` | `250 ml can`, `500 ml bottle`, `per mint`, `per candy piece`, `60 ml`/`3 g`, rawText fallback, unparseable degradation, non-present states; resolver unit-tested directly. |

`26 tests / 4 files`, all passing. `bun run typecheck` and scoped `eslint` clean.

## Rendering contract (encodes the data contract)

`ObservationValue` (`{state, value, min, max, qualifier}` + optional `unit`):

| Input | Output |
| --- | --- |
| present + exact | `75` (+ unit → `75 mg`), no tag |
| present + range | `75–80 mg` + `Range` tag (en dash) |
| present + approximate | `~95 kcal` + `Approx.` tag |
| present + estimated | `est. 12 g` + `Est.` tag |
| present + unknown | `5 ml` + muted `Unknown` tag |
| any non-present state | `FieldStateBadge` — never a fabricated value |

`ServingLine`:

| Unit family | Output |
| --- | --- |
| container (`can`/`bottle`/`cup`/`shot`) | `<normalizedMl> ml <container>` → `250 ml can` |
| volume/mass (`ml`/`fl_oz`/`oz`/`g`) | `<value> <unit>` → `60 ml`, `3 g` |
| per-item (`mint`/`candy`/`gum_piece`/`tablet`/`packet`/`serving`/`item`) | `per <item>` → `per mint`, `per candy piece` |
| unknown/null unit | `rawText` verbatim, else `unparseable` badge |

## Accessibility

- Badge `role="img"` + `aria-label="<short label>: <full explanation>"` (e.g.
  "Conflicting values: independent source values disagree for this field");
  visible copy is `aria-hidden` to avoid double announcement.
- States are distinguishable without color: distinct shapes (dashed square /
  filled pill / sharp rectangle / hollow pill) plus `!` / `≠` marker glyphs.
- `data-state` / `data-qualifier` / `data-size` / `data-unit` hooks on every
  primitive for styling, testing, and future e2e selectors.

## Reskin guide

All colors live in `tokens.css` as `--pr-*` variables; components reference them
via Tailwind arbitrary values (`bg-[var(--pr-…)]`) and never hardcode hex values.
Final aesthetics from owner mockups = edit `tokens.css` only (values, not names).
Token names are stable API: `--pr-surface-*`, `--pr-accent-*`, `--pr-success|warn|danger|info*`,
`--pr-text-*`, `--pr-state-<field_state>-*`.

Import model: every primitive imports `./tokens.css` (repo precedent:
`citywide-stop-map.tsx` imports its CSS directly); the bundler dedupes the graph
so the sheet ships exactly once. No global stylesheet or Tailwind config was
touched.

## Decisions & deviations

- **Filenames are kebab-case** (`field-state-badge.tsx`, not `FieldStateBadge.tsx`)
  to match every existing file under `src/components/`; exports are PascalCase
  as specified.
- **Types come from the contracts** (`FieldState`, `NumberObservation`,
  `ServingObservation`); `ObservationValue` accepts `Pick<NumberObservation, …>`
  so callers don't need `rawText`/`candidates` to render a value. No contract
  file was modified.
- **Defensive fallbacks**: a `range` observation missing bounds degrades to its
  single value; a present observation with no usable number renders an em-dash.
- **Unknown serving with no rawText** renders the `unparseable` badge — the
  source published something we cannot represent structurally, which is exactly
  that state's meaning; the line never invents a serving size.
- **`form` is not rendered** in V1 primitives (it informs future layout/icon
  work, not line copy); `resolveServingLine` is exported pure for reuse.
- **Qualifier tags stay in the neutral accent family** — qualifier is metadata
  about confidence and must never read as a severity color.
- No deps installed; no tailwind/global style files touched; contracts untouched.

## Verification

```
bun run test tests/unit/components/pulserank   # 26 passed (4 files)
bun run typecheck                              # clean
bunx eslint src/components/pulserank/ui tests/unit/components  # clean
```
