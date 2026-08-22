# A12 Handoff — Judge Cockpit (`/judge`)

Agent: A12 (judge routes and demo actions) · Branch: `agent/judge` (worktree
`.worktrees/judge`) · Date: 2026-08-21

## Outcome

**HTML-first evidence cockpit at `/judge` rendering the REAL Bright Data
healing evidence recorded by A2, with every verdict computed live by the
production contract/validation/promotion code, and fail-closed demo mutations.**

- Worktree rebased: `git merge --ff-only pulserank-rebuild` (94f423f → ad1bd8c).
- All ten pipeline steps render plain server HTML from `artifacts/scraper/`:
  Collector → Structured Output → Contract → Incident → Heal Preview →
  Validation → Approval → Same Collector Rerun → Recovery → Ranking Impact.
- No JS required to read anything essential (the only client component is a
  copy button); nothing essential is drawn on canvas.
- Mutations are **disabled by default**: both actions refuse unless
  `PULSERANK_JUDGE_MUTATIONS_ENABLED=true` AND the submitted form token equals
  `PULSERANK_JUDGE_TOKEN`. Successful envelopes are written ONLY under
  `artifacts/demo/`; `artifacts/scraper/` is never modified. Legacy UNBROKEN
  admin routes were only read for convention, never changed.
- No dependencies added; lockfile untouched (`bun install --frozen-lockfile`
  was used to materialize the committed lockfile inside the worktree so
  Turbopack could build — same setup as sibling worktrees).

## The honest evidence story (no fabricated numbers)

The interesting finding of this task: **the V1 zod contract does NOT catch the
72250 unit bug** (it is shape-valid and non-negative), and neither do the A5
run-level checks. What actually protects the boards:

1. The collector publishes TWO caffeine figures (`caffeine_mg_per_serving`,
   `caffeine_mg_per_100ml`). The mapper (`to-scrape-row.ts`) cross-checks them:
   implied = 28.79 mg/100ml × 250 ml = **71.975 mg** vs published **72250 mg**
   (~1003.8× off). Beyond the documented tolerance (±1 mg or 5% relative), the
   row maps caffeine as contract state `conflicting`, keeping both readings in
   `candidates` plus a computed row warning.
2. `promoteCandidate` (imported live from `src/server/ingestion`) then outputs
   verdict `conflict`, `rankable=false`, and serving verdict
   `totalCaffeineEligible=false` for the pre-heal record — the broken record
   was **total-caffeine ineligible**, exactly as the master plan's healing
   script requires. Conflicts are valid reviewed data: no incident,
   record-level outcome stays `trusted`.
3. Post-heal (72 mg vs implied 71.975 — within rounding): maps `present`/exact,
   promotes `rankable=true`, `exactBoardEligible=true`,
   `totalCaffeineEligible=true`, concentration computed **28.8 mg/100ml**.

Every number above is computed at request time by the real code paths and shown
side-by-side in step 10.

## Files created

| File | Purpose |
|---|---|
| `src/server/judge/artifacts.ts` | Safe artifact reader: flat-name allowlist + resolved-path prefix check (path traversal impossible), size-capped reads, JSON.parse only — content is never executed. |
| `src/server/judge/to-scrape-row.ts` | Collector record → `ProductScrapeRowV1`. Unpublished collector fields map to `not_published`; two-figure unit-consistency rule; slug/fingerprint derivation; pure (observedAt injected). |
| `src/server/judge/evidence.ts` | Request-time assembly: reads artifacts (fail-soft per file), maps rows, runs zod schema + `validateRun` + `normalizeRow`/`promoteCandidate`. |
| `src/server/judge/mutation-gate.ts` | Pure fail-closed gate: flag AND timing-safe token compare (sha256 digests + `timingSafeEqual`). Missing server token ⇒ locked even with flag true. |
| `src/server/judge/mutations.ts` | Single mutation funnel with injected deps; URL allowlist (caffeineinformer.com only), prompt bounds, artifacts/demo-only writes, outcome→redirect URL builder. |
| `src/server/judge/demo-artifacts.ts` | Writer confined to `<cwd>/artifacts/demo/` (name grammar + resolved-prefix double check). |
| `src/server/judge/actions.ts` | `"use server"` actions `healPreviewAction` / `rerunCollectorAction`: heal-preview → existing `requestBrightDataHealing`; rerun → existing `collectBrightData` (same collector id). Redirect back to `/judge` with outcome params so results render without JS. |
| `src/app/judge/layout.tsx` / `page.tsx` | Cockpit shell + 10-step stepper, `dynamic = "force-dynamic"` (fs read per request). Locked-state panels replace forms when the flag is off. |
| `src/components/pulserank/judge/*` | `step-card` (+status chip), `json-viewer` (server-side syntax coloring into a `<pre>` of spans, no dangerouslySetInnerHTML), `copy-button` (client, progressive enhancement), `collector-record-table` (reuses FieldStateBadge/ObservationValue/ServingLine), `mutation-controls`, `bits` (VerdictChip/KeyValue/Callout/Mono). |
| `tests/fixtures/judge/run-standard{,-post-heal}.json` | Copies of the real artifacts so tests never depend on `artifacts/`. |
| `tests/unit/server/judge/{artifacts,to-scrape-row,evidence,actions}.test.ts` | See below. |

## Tests (`bun run test` — all green, repo-wide suite included)

- `artifacts.test.ts` — path-traversal matrix (18 hostile names incl. `../`,
  backslashes, absolute paths, null bytes, dot segments, encoded tricks),
  containment assertions, missing/non-file errors, listing filters, mtime stats.
- `to-scrape-row.test.ts` — full mapping of the post-heal fixture (72 mg):
  present/exact + candidates `[72, 71.975]`, serving 250 ml → normalizedMl 250,
  not_published fields, audit_only media, provenance block, zod PASS;
  pre-heal fixture maps `conflicting` with candidates `[72250, 71.975]` and
  still passes zod (contract checks shape, not plausibility); parser edge cases.
- `evidence.test.ts` — pins the whole ranking story: conflict ⇒
  `totalCaffeineEligible=false` pre-heal; healed row ⇒ eligible with
  concentration 28.8; observedAt from artifact stats; missing artifacts degrade
  to explicit unavailable states.
- `actions.test.ts` — gate truth table (flag off / token unconfigured /
  token missing / mismatch / match), services provably unreachable when gated,
  happy paths write exactly one demo artifact each, host-allowlist refusals,
  service failure → error outcome without writes, redirect URL encoding.

Verification run from the worktree:

```
bun run typecheck   # clean
bun run test        # 29 files, 412 passed (includes all pre-existing suites)
bun --bun next build  # production build compiles (turbopack)
```

## Assumptions & decisions

- **Conflict mapping is the honest bridge** between "zod passes 72250" and the
  plan's "total-caffeine eligibility appears only after healing": two
  contradicting published figures ARE conflicting evidence per the V1 field
  states. The tolerance (±1 mg / 5% rel.) absorbs the 2-dp rounding of the
  published per-100ml value and cleanly separates rounding noise from the
  ~1000× bug. Rule + tolerance are documented in code and rendered on the page.
- **Rerun action uses `collectBrightData`** (existing collection service) rather
  than adding a CLI wrapper: it triggers + downloads the SAME configured
  collector id and keeps `bright-data-healing.ts` untouched (A2 scope).
- **Outcome feedback via redirect query params** keeps the flow fully functional
  without client JS (plain form POST → server action → redirect → banner).
- **`observedAt` = artifact file mtime** (injected into the pure mapper): the
  collector envelope carries no timestamp; mtime is real recorded history, not
  a clock read.
- **Worktree deps**: Turbopack rejects out-of-root node_modules symlinks, so the
  committed lockfile was materialized inside the worktree with
  `--frozen-lockfile` (no version changes; `bun.lock` diff is empty), matching
  sibling worktrees' local installs.

## Risks / follow-ups

- Live mutations are long-running (rerun polls up to ~4.5 min) — acceptable for
  an operator demo tool; a queued job path exists via `pulse.*` jobs if needed.
- The demo artifacts under `artifacts/demo/` are runtime-written and untracked;
  CI/release gates should keep ignoring that directory.
- Discovery-mode heal attempts remain blocked upstream ("Another refactor job
  is still in progress") — shown verbatim in the cockpit's additional-evidence
  section; retry belongs to A2/A14 once the dashboard queue clears.

## PulseRank queued healing binding

The worker-side `pulse.heal.preview` and `pulse.heal.verify` stages now use the
same collector identity and the frozen V1 contract. Preview rows are validated
before a `pulse.heal_sessions` row is stored; verification refuses to collect
until an explicit human approval is persisted. Approval is performed through
the token/origin-gated `POST /api/pulse/heal/{sessionId}/approve` endpoint and
never through an automatic approval flag. The HTML-first `/judge` artifact
cockpit remains the read-only evidence surface and its existing live demo
actions continue to write only under `artifacts/demo/`.

## Current active-collector G7 evidence (local, approval completed)

On 2026-08-22 the active collector `c_mt33nlnkq376z132b` ran against the
consented Caffeine Informer `viter-mints` page and returned one structured
record. A non-approving heal on that same collector reached
`awaiting_approval`; the provider envelope recorded no automatic approval. The
preview was mapped with the production `toScrapeRow` function, passed
`productScrapeRowV1Schema`, and returned `validateRun: ok` with zero findings.

The bounded evidence is retained under the ignored
`artifacts/incidents/pulserank-g7-current/` directory. On the owner's finish
instruction, the exact active-collector approval completed without
`--auto-approve` or `--auto-save`. A one-page same-URL rerun then collected one
row, but the deterministic row-contraction guard rejected promotion because
the prior trusted run had 30 rows. The approved collector was subsequently
rerun against `docs/source/golden-urls.json`: 30 rows collected, 30 parsed, 0
validation findings, 0 collector errors, 0 new promotions (all 30 were
expected duplicates), and all three leaderboards rebuilt successfully.

The recorded non-automatic provider action was:

```bash
bdata scraper approve c_mt33nlnkq376z132b --url https://www.caffeineinformer.com/caffeine-content/viter-mints
```

The command was not replaced with `--auto-approve` or a different collector.
