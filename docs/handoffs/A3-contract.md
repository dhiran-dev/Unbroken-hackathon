# A3 Handoff — Provisional V1 Product Data Contract

**Status: PROVISIONAL — do not build ranking or persistence on top of this yet.**

This contract is drafted from §8.2–§8.6 of `PULSERANK_MASTER_IMPLEMENTATION_PLAN.md`
and is **pending two inputs before freeze at G3**:

1. **A1 page-shape matrix** — the real set of caffeineinformer page layouts may
   force additional field states, template families, or evidence sections.
2. **A2 real collector output** — actual collector rows may not fit these shapes;
   any mismatch means the contract changes *before* G3, not after.

Freeze happens at G3. Until then this is a working draft for parallel work.

## What was created

Branch `agent/data-contract` (worktree `.worktrees/data-contract`):

| File | Purpose |
| --- | --- |
| `src/domain/product/contracts/field-states.ts` | `FieldState` union (§8.2, verbatim) |
| `src/domain/product/contracts/observations.ts` | `NumberObservation` (§8.3) + `ServingObservation` (§8.4), verbatim |
| `src/domain/product/contracts/product-scrape-row.ts` | `ProductScrapeRowV1` (§8.5), verbatim |
| `src/domain/product/contracts/product-scrape-row.schema.ts` | Zod schemas mirroring all of the above |
| `src/domain/product/fixtures/*.json` | 11 fixtures (see coverage below) |
| `tests/unit/domain/product/product-scrape-row.test.ts` | Vitest contract tests |

No fields were invented beyond the §8 spec. The static types are copied verbatim
from the plan.

## Validation semantics added (no new fields)

The bare §8 shapes cannot reject the negative fixture classes required by §8.6,
so the Zod layer adds three refinements:

- **Non-negativity**: `value`, `min`, `max`, `candidates[]`, and `normalizedMl`
  must be `>= 0` when present. A negative milligram/gram reading is a parser bug,
  never data → rejects `invalid-negative.json`.
- **`min <= max`** when both are present.
- **Host pinning**: `source.url` must resolve to `caffeineinformer.com` (or a
  subdomain) → rejects `wrong-host.json`. `observedAt` must be ISO 8601.

These preserve the plan's core guarantees: `0` still parses as
`state: "present", value: 0` (zero ≠ missing); per-item units pass through
untouched (`unit: "mint"`, `normalizedMl: null`); ranges keep `value: null` with
explicit `min`/`max`; conflicts stay `state: "conflicting"` with `value: null`
and both candidates listed.

## Zod vs hand-written validators

`zod@4.4.3` was already a dependency of the repo, so real Zod schemas were written
(`product-scrape-row.schema.ts`). The fallback hand-written
`validate-scrape-row.ts` was **not** needed and does not exist.

## Fixture coverage

10 fixture classes were tasked; 11 files exist (`multi-variant.json` plus the ten
named ones). Relative to the full §8.6 matrix, these are **deferred to A2
integration**, where real page output will exercise them better than synthetic
fixtures: `per-item-candy.json`, `flavour-list.json`,
`struck-through-flavours.json`, `missing-serving.json`. (Strikethrough flavour
evidence is partially covered inside `conflicting-variant.json`.)

## Test run

Vitest resolves from the parent checkout's `node_modules` (the worktree has none
of its own); `bun run test` / `vitest run` picks up
`tests/unit/**/*.test.ts` per `vitest.config.ts`. Result recorded below.

<!-- TEST_RUN -->

```
$ bun run test            # vitest 4.1.11, run 2026-08-21 from the worktree
Test Files  98 passed (98)   # full suite, includes the new contract file
     Tests  828 passed (828)

$ vitest run tests/unit/domain/product/product-scrape-row.test.ts --reporter=verbose
Test Files  1 passed (1)
     Tests  17 passed (17)
  - 9/9 positive fixtures parse against productScrapeRowV1Schema
  - 6 semantic guarantees hold (zero != missing, per-item unit preserved,
    range/estimated qualifiers explicit, conflicts unranked)
  - invalid-negative.json rejected (negative caffeineMg path)
  - wrong-host.json rejected (caffeineinformer.com host message)
```

## Open decisions for the G3 freeze

1. **Object strictness** — schemas currently strip unknown keys silently. If we
   want layout drift to fail loudly instead, switch to strict objects at freeze.
2. **Qualifier consistency** — should `qualifier: "range"` require non-null
   `min`/`max`? Left unenforced provisionally so sparse real data isn't rejected.
3. **`media.imageUrl` host policy** — currently any valid URL; pin to
   caffeineinformer.com only if publication rules demand it.
4. **Fixture completion** — add the four deferred §8.6 fixture classes once A2
   output shows their real shape.
