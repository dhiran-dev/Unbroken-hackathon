# A5 Handoff — Deterministic Normalization, Run Validation, Promotion, Change Detection

**Status: COMPLETE — all pure ingestion logic implemented, tested, and committed.**

Branch `agent/validation` (worktree `.worktrees/validation`). This agent completed
the A5 pipeline stage of `docs/plans/pulserank-master-implementation-plan.md` §"Agent A5":

```text
parsed V1 rows → run validation → deterministic normalization
→ field-level promotion → trusted-to-trusted change detection
```

## What was created

| File | Purpose |
| --- | --- |
| `src/server/ingestion/normalize.ts` | `ProductScrapeRowV1` → `NormalizedCandidate` (kept from the previous run; see "Repairs" below) |
| `src/server/ingestion/validate-run.ts` | Pure run-level checks over an array of parsed rows |
| `src/server/ingestion/promote.ts` | Field-level promotion decisions + the `TrustedProductRecord` shape |
| `src/server/ingestion/change-detection.ts` | Trusted-to-trusted diff emitting the 13 planned event types |
| `src/server/ingestion/index.ts` | Public module surface (replaces the A0 placeholder) |
| `tests/unit/server/ingestion/normalize.test.ts` | 19 tests — fixtures + category mapping + concentration rules |
| `tests/unit/server/ingestion/validate-run.test.ts` | 24 tests — every check incl. exact threshold boundaries |
| `tests/unit/server/ingestion/promote.test.ts` | 19 tests — every row of the promotion table |
| `tests/unit/server/ingestion/change-detection.test.ts` | 23 tests — all 13 event types + gate + shape |

**Verification: `bun run test` → 102 files / 913 tests passing (85 new), `bun run typecheck`
clean, ESLint clean on all new files.**

## Purity mandate (held everywhere)

No database access, no network access, **no clock reads**: there is no `Date.now`
or `new Date()` anywhere in `src/server/ingestion/`. Every timestamp —
`observedAt` on records and on every change event — is a caller-supplied
parameter. Identical input always yields identical output (asserted by
determinism tests in every suite).

## validate-run.ts — run-level checks

`validateRun(rows, { previousRunCount? })` → `{ ok, findings }`, where each
finding is `{ check, severity: "fail" | "warn", detail }` and `ok === true`
exactly when no finding is a fail.

| Check | Severity | Trigger |
| --- | --- | --- |
| `expected_host` | fail | any `source.url` not resolving to `caffeineinformer.com` (subdomains OK; mirrors the A3 zod rule) |
| `schema_version` | fail | any row with `schemaVersion !== "1.0"` |
| `duplicate_slug_rate` | fail | duplicate slugs > 2% of the run (exactly 2% passes) |
| `invalid_caffeine_values` | fail | negative or non-finite caffeine value/min/max on a present observation |
| `row_contraction` | fail | run shrank > 10% vs `previousRunCount` (exactly 10% passes) |
| `zero_value_spike` | warn | > 30% zeros among *present* primary sugar/calorie observations |
| `unknown_unit_spike` | warn | > 20% unknown/null units among all servings (primary + variants + flavours) |

The input type `ValidatableRow` is deliberately looser than `ProductScrapeRowV1`
(a run must be inspectable even when it is wrong about host/schema version);
any `ProductScrapeRowV1` assigns to it directly. Findings are emitted in a fixed
order and slug lists are sorted, so output is independent of input ordering.

## promote.ts — field-level promotion

`promoteCandidate(candidate, { previousTrusted?, pageMissing? })` →
`{ fieldVerdicts: { caffeine_mg, calories_kcal, sugar_g, serving }, overall,
incidents, sourceStatus, preservePrior, record }`.

The plan's field table is implemented exactly:

| Condition | Decision |
| --- | --- |
| state `not_published` | verdict `sparse` — valid data, no incident, never quarantines |
| present value `0` | verdict `zero` — explicit zero is DATA; caffeine gets `caffeineFreeBoardEligible: true` |
| `unparseable` | verdict `preserved_prior` — prior trusted value carried forward (`preservePrior: true`) + incident opened (`openIncident: true`) |
| serving absent/not_published | `totalCaffeineEligible: true`, `concentrationEligible: false` |
| qualifier `range` | verdict `range` — displayable as a range, `exactBoardEligible: false` |
| `conflicting` | verdict `conflict` — metric excluded from every board; raw text evidence retained; no incident |
| page missing | record-level `preservePrior: true` + `sourceStatus: "missing"` |

Additional deterministic rules:

- **Invalid readings** (negative/non-finite on a `present` observation — the
  `invalid-negative.json` class) are parser bugs, never data: treated like
  unparseable (preserve prior + incident, code `invalid_value`).
- **`overall`** is `"quarantined"` exactly when an incident was opened
  (unparseable/invalid fields). This matches the plan's heal flow: failed
  candidate quarantined, prior trusted product remains public, incident visible.
  Sparse, zeros, ranges, and excluded conflicts never quarantine.
- **Concentration eligibility** = exact caffeine AND positive `normalizedMl`
  (per-item servings and estimates keep it false), consistent with normalize's
  `computeConcentration`.
- The promoted **`record: TrustedProductRecord`** is emitted alongside the
  decision so the next stage can diff without re-deriving anything. Variant and
  flavour metrics promote as their normalized points (evidence kept).

## change-detection.ts — trusted-to-trusted events

`diffTrustedRecords(prevTrusted, nextTrusted, observedAt)` → `ChangeEvent[]`,
each `{ type, field?, before, after, observedAt }` where before/after points are
`{ value, qualifier, unit }` (plus `min`/`max` only for range observations;
`null` before-point for additions).

- **Gate:** events exist ONLY when both records are non-null trusted records of
  the same slug. First observation → `[]`; nothing newly trusted → `[]`.
  Page disappearance arrives as the preserved prior record with
  `sourceStatus: "missing"`, yielding exactly one `page_missing`.
- **Types (exactly the 13 planned):** `caffeine_changed`, `serving_changed`,
  `calories_changed`, `sugar_changed`, `source_level_changed`, `variant_added`,
  `variant_changed`, `flavour_added`, `flavour_state_changed`,
  `conflict_introduced`, `conflict_resolved`, `product_renamed`, `page_missing`.
- Conflict transitions take precedence over plain metric changes (a conflicting
  metric that stays conflicting emits nothing). Qualifier-only changes (exact →
  estimated) count as changes because board eligibility moves.
- Entity paths: `variant:<name>.<metric>` / `variant:<name>.availability` /
  `flavour:<name>`; additions use `field: "variants" | "flavours"` with the name
  as the after-value.
- Output order is fixed (record-level → primary metrics → variants/flavours
  sorted by name); same inputs always produce deep-equal output.

## Repairs to existing code

- `normalize.ts` (kept as instructed): it did not compile — lines 57–66 held a
  dead, syntactically broken `CATEGORY_RULES` literal (a leftover superseded by
  `CATEGORY_RULES_FINAL`). Only that dead block was removed; every live line of
  the previous agent's normalization logic is untouched and now covered by tests.
- `index.ts`: replaced the A0 freeze placeholder with re-exports of the four
  modules (placeholder constant removed; nothing imported it).

## Fixture coverage

All named fixture classes are exercised: `standard-full`, `standard-sparse`,
`explicit-zero-caffeine`, `explicit-zero-sugar`, `per-item-mint`,
`range-caffeine`, `estimated-caffeine`, `multi-variant`,
`conflicting-variant`, `wrong-host` (run validation), `invalid-negative`
(run validation + promotion), plus inline minimal cases (threshold boundaries,
conflict transitions, page-missing, determinism).

## Not in scope (deliberately)

- Persistence into `pulse.*`, incident storage, and the heal/approval flow —
  later agents; this module exposes pure decisions only.
- `template-specific field collapse` and `discovery URL correctness` beyond the
  zero-spike/host checks above need real A2 collector telemetry to calibrate.
