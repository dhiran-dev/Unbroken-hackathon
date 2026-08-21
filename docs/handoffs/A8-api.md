# A8 Handoff — Public Read-Only Product API over the Pulse Schema

**Status: COMPLETE — trusted-only queries, publication-policy DTO mapper, 8 route
handlers, unit tests; typecheck + full suite green.**

Branch `agent/api` (worktree `.worktrees/api`), fast-forwarded onto
`pulserank-rebuild` (worker dispatcher A7a, release gate A13a, ingestion,
contracts, fixtures) before starting. The previous run's untracked
`src/server/products/dto.ts` + `queries.ts` were reviewed, kept, and repaired
rather than rewritten.

## What was created / changed

| File | Purpose |
| --- | --- |
| `src/server/products/query-options.ts` | NEW: sort options (`name`, `caffeine-desc`, `caffeine-asc`, `newest`) + page bounds (`DEFAULT_PAGE_LIMIT=24`, `MAX_PAGE_LIMIT=100`) in a db-free module so parameter parsing never imports the database client. |
| `src/server/products/queries.ts` | Trusted-only read queries over `pulse.*`: `listProducts` (all spec filters + keyset cursor), `getProductBySlug`, `searchProducts`, `listCategories`, `getLeaderboard`, `listChanges`, `getLiveDataStats`. Repairs below. |
| `src/server/products/dto.ts` | Pure DTO mapper enforcing the publication policy. Repair below. |
| `src/server/products/request-params.ts` | NEW: pure `URLSearchParams` parsers shared by every route; strict validation (known param + bad value ⇒ 400), plus `jsonPublic`/`badRequest`/`notFound` helpers and the `public, s-maxage=60` cache policy constant. |
| `src/app/api/public/products/route.ts` | GET list: filters → `listProducts` → DTOs → `{ schemaVersion, items, nextCursor }`. |
| `src/app/api/public/products/[slug]/route.ts` | GET one via `params: Promise<{slug}>` (Next 16 convention); 404 when absent or not yet trusted. |
| `src/app/api/public/search/route.ts` | GET with required non-empty `q`; same filter surface as list. |
| `src/app/api/public/categories/route.ts` | GET canonical categories with real distinct product counts. |
| `src/app/api/public/leaderboards/route.ts` | GET `?board=` entries from the newest immutable snapshot; 404 when none exists; never computes a board on the fly. |
| `src/app/api/public/changes/route.ts` | GET recent change events (metadata only — before/after bodies never leave the server); keyset-paged. |
| `src/app/api/public/live-data/route.ts` | GET REAL counters only: observation counts by status (trusted/candidate/quarantined/rejected/superseded), last collection-run time, open incident count, active collector ids, schema version. No derived scores exist anywhere. |
| `src/app/api/public/source-methodology/route.ts` | GET static JSON: one-source policy, Caffeine Informer attribution, no-derived-scores statement, sparse-states/flag-gating/image rules, `schemaVersion "1.0"`. |
| `tests/unit/server/products/dto.test.ts` | 20 active tests + skipped DB-integration block. |

## Trust model (by construction)

Every product-facing query inner-joins `pulse.products` to
`pulse.product_observations` on **both** `products.current_trusted_observation_id`
**and** `observations.status = 'trusted'`. There is no parameter that can relax
either condition, so candidate/quarantined/rejected/superseded rows are
unreachable through this module.

## Publication policy enforced in the mapper

- Sparse states are preserved AS STATES: `not_published` stays
  `{ value: null, state }`; an explicit published zero stays the number 0 with
  state `present`. Never coerced between the two.
- Ranges pass through verbatim (`min`/`max`, qualifier `range`); `mg` stays null
  — a range is never collapsed into a point value.
- Concentration is eligible ONLY for exact finite non-negative caffeine AND a
  positive ml-normalized serving; the stored concentration block is honored only
  when eligibility re-derives true, so a buggy writer cannot leak an unearned
  number.
- `calories`/`sugar` keys are OMITTED entirely unless
  `PULSERANK_PUBLIC_EXTENDED_FIELDS` (or per-call option) enables them.
- Images surface only for `publicationState: "allowed"`; `audit_only`/`blocked`
  suppress to null.
- `rawText` never leaves the server; source attribution ("Caffeine Informer") is
  on every record; `schemaVersion` is `"1.0"` everywhere.

## Repairs to the inherited files

1. `dto.ts`: null-safe read of the stored concentration block
   (`payload.concentration?.mgPer100Ml ?? null`) — a writer that persisted
   `concentration: null` would previously have thrown.
2. `queries.ts`: a pagination cursor minted for one sort is now rejected
   (`InvalidCursorError`) instead of being silently applied under another
   ordering, which produced wrong pages.
3. `queries.ts`: sort options/page limits moved to db-free
   `query-options.ts` (re-exported, public API unchanged) and an unused
   `ilike` import dropped — keeps `request-params.ts` importable without the
   database client.
4. `queries.ts` cursor tiebreak for `newest` sorts uses id-descending keysets;
   verified consistent with its `orderBy`.

## Verification

- `bun run typecheck`: clean.
- `bun run test`: **111 files / 1080 tests passing, 4 todo** (was 109 files /
  1027 tests after A7a).
- Scoped `eslint` on all new files: clean.
- New tests cover: trusted-only mapping + rawText leak check, sparse-as-state
  and explicit-zero preservation, range passthrough + malformed-range
  suppression, concentration eligibility matrix (exact+ml / exact+non-ml /
  range+ml / bogus stored block / null stored block), extended-fields gating
  (off omits keys entirely), image audit_only/blocked/allowed, observedAt
  resolution, determinism.

## Not done / hand-off seams (deliberate)

- DB-integration tests are `describe.skip` with a **TODO-DB-SEED** note listing
  exactly what a seed harness must insert (trusted pointer + sibling
  candidate/quarantined rows, aliases, change events, leaderboard snapshot +
  entries, incidents, collection runs, collectors).
- No leaderboard snapshot writer exists yet (A8 reads snapshots; building them
  belongs to a later agent), so `/api/public/leaderboards` returns 404 until
  then.
- Routes are thin by design; there are no route-level tests beyond the pure
  parser/mapper suites — the legacy repo pattern (route-matrix tests) can be
  extended once the seed harness lands.
