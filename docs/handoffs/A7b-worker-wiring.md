# A7b — Worker handler wiring (collection / ingest / validate / promote / leaderboards)

Branch: `agent/repo-safety` · Continues A7a (`docs/handoffs/A7a-worker-skeleton.md`).
Status: typecheck ✅ · unit tests ✅ (30 files, 433 passed) · lint ✅ (0 errors)

## What landed

The seven data-bearing `pulse.*` jobs are wired to real pipeline implementations.
`dispatch()` in `src/server/jobs/pulse-jobs.ts` is **unchanged** — same
fail-closed acceptance, same never-throws contract. The result union gained three
additive variants (`ok`, `skipped`, `failed`) alongside the existing
`not_implemented` / `handler_error`.

## Files

| File | Change |
| --- | --- |
| `src/server/jobs/pulse-handlers.ts` | NEW — handler wiring: runtime seam, seven handlers, registry factory |
| `src/server/jobs/pulse-jobs.ts` | Registry binds the seven jobs via `createDefaultPulseJobHandlers`; result union extended; explicit stubs remain for the remaining operations |
| `src/server/collection/bdata-client.ts` | SALVAGED + repaired: discovery query resolution, two new error codes |
| `src/server/ingestion/repo.ts` | SALVAGED + completed: `CollectionRunPatch.startedAt/pageFingerprint`, typed `InMemoryPulseRepo.__debug` test introspection |
| `src/server/products/queries.ts` | `getLeaderboard` prefers the latest snapshot tagged with `summary.boardKey` (legacy fallback kept) |
| `tests/unit/server/jobs/pulse-handlers.test.ts` | NEW — 25 tests over the handlers + bdata client |
| `tests/unit/server/jobs/pulse-jobs.test.ts` | Updated: stub assertions now cover only the still-unwired jobs; collect dispatch expects structured skip; worker-log expectation relaxed |
| `docs/handoffs/A7b-worker-wiring.md` | This file |

## Handler semantics

- **`pulse.ingest.run {runId}`** — zod-parses `raw_records.payload` rows into V1
  scrape rows, normalizes them, upserts products, and inserts one **candidate**
  observation per row. Idempotent on `(source, page_fingerprint)` and on the
  insert-level `(source, slug, observed_at)` unique constraint (both count as
  duplicates). Variant/flavour entity rows + observations are persisted per
  candidate. Unparsable payloads are counted and listed by record id, never fatal.
- **`pulse.validate.run {runId}`** — feeds every raw row through run-level
  checks (previous run count via `getPreviousRunRowCount` for contraction).
  Findings land in `collection_runs.report`; status flips to `validated` /
  `validation_failed` (+ errorCode/errorSummary on failure). Rows that fail the
  strict contract parse are re-inspected through a lenient structural guard so
  wrong-host / wrong-schemaVersion stay *findings* instead of silent drops;
  truly unshapeable payloads are counted as unparsable.
- **`pulse.promote.snapshot {runId}`** — promotes only CURRENTLY-candidate
  observations (re-dispatch is a no-op). Verdicts from `promoteCandidate`;
  **trusted** ⇒ observation normalized payload becomes the trusted record,
  other trusted records of the product are superseded,
  `products.current_trusted_observation_id` moves, and trusted→trusted diffs
  insert `change_events`. **Quarantined** ⇒ observation stays (quarantined), one
  incident opens per candidate summarizing the field incidents; prior trusted
  record remains public.
- **`pulse.rebuild.leaderboards {}`** — recomputes
  `highest-total-caffeine` (value or range lower bound),
  `highest-exact-concentration` (exact caffeine ÷ positive ml serving), and
  `caffeine-free` (explicit zero) from trusted observation payloads. Deterministic
  order: metric DESC, product slug ASC tiebreak; ranks 1..n. Eligibility flags:
  `value_<qualifier>` / `range`, `exact_caffeine`+`ml_normalized`,
  `explicit_zero`.
- **`pulse.collect.sample {url}` / `pulse.collect.refresh-batch {inputFile}` /
  `pulse.collect.discovery {query|inputFile}`**
  — flag-gated FIRST (`PULSERANK_COLLECTION_ENABLED` /
  `PULSERANK_DISCOVERY_ENABLED`): disabled ⇒ structured `skipped` result before
  any DB or network touch (defense-in-depth behind the worker's own gate). When
  enabled: tx 1 resolves the active collector and opens a `running`
  collection_run; the CLI runs OUTSIDE any transaction; tx 2 persists each JSON
  row into `raw_records` (per-row sha256 fingerprint, duplicates skipped) and
  finalizes the run BEFORE any processing; CLI failures mark the run `failed`
  with a stable code and return a structured failure.

## Transactionality

All DB-writing handlers execute inside one transaction via
`runtime.runTransaction` (default `runInPulseTransaction`, which resolves the
pooled db client lazily). Collection is the documented exception — open-run /
network / persist-raw are separate transactions so the run row can track an
in-flight or failed CLI attempt.

## Testability

`createPulseJobHandlers(runtime, notImplemented)` builds a full registry around
an injectable `PulseJobRuntime` (`runTransaction`, `flags`, `now`, `collect`);
unit tests bind an `createInMemoryPulseRepo()` and canned collectors — no test
touches postgres or spawns a process. The module-level default registry is
never mutated by tests.

## Assumptions & notes for reviewers

1. **Real-DB integration pending.** All persistence paths are unit-tested
   against the in-memory repo (which emulates the schema unique constraints).
   A live drizzle/postgres pass against migrated pulse tables is still to be
   run by an agent with database access.
2. **One snapshot PER BOARD per rebuild.** `leaderboard_entries` enforces
   `(snapshot_id, product_id)` uniqueness, so one snapshot cannot carry a
   product on two boards. Each rebuild therefore appends three snapshots, one
   per board, each carrying its key in `summary.boardKey`;
   `getLeaderboard` now selects "latest snapshot for that board" (with legacy
   fallback). Snapshot ids ride along in the job result as `details.snapshotIds`.
3. **Discovery input-file format.** The real `discover` subcommand has no
   `--input-file`; the client resolves the query locally: explicit `payload.query`
   wins, otherwise the first usable URL of `inputFile` (one URL per line, `#`
   comments skipped, or a JSON array of strings / `{"url": …}` objects).
   Missing/unreadable file ⇒ structured codes `BDATA_DISCOVERY_QUERY_MISSING` /
   `BDATA_INPUT_FILE_UNREADABLE`.
4. **CLI argv verified against @brightdata/cli 0.3.2 dist**: sample =
   `scraper run <collector_id> [url] [--input-file <path>] --json`; discovery =
   `discover <query> --json`. Token mapping `BRIGHTDATA_API_TOKEN →
   BRIGHTDATA_API_KEY` matches the healing service.
5. **Non-object collector output rows** (scalars/arrays) are counted
   (`nonObjectRowsSkipped`) but not stored — `raw_records.payload` is jsonb
   object-typed.
6. **Flags are read live at handler execution** from `pulserankFlags.server`
   (env at process/module start); changing env requires a worker restart, same
   as the Next.js server surfaces.
7. **Legacy jobs stay dead**: denylist rejection is asserted again in both test
   files after the wiring.

## Verification

```
bun run typecheck   # clean
bun run test        # 30 files, 433 passed, 4 todo, 0 failed
bun run lint        # 0 errors (1 pre-existing warning in judge actions.test)
```

No live collection was run; no dependencies were installed (the worktree
resolves toolchain packages through the main checkout's `node_modules`).
