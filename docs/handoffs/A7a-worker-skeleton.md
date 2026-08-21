# A7a Handoff — PulseRank Worker Dispatcher Skeleton (NO data binding)

**Status: DONE — fail-closed dispatcher + worker loop skeleton; every handler is a typed stub.**

Branch `agent/repo-safety` (worktree `.worktrees/repo-safety`), fast-forwarded onto
`pulserank-rebuild` (contracts, pulse schema, ingestion pipeline, UI primitives) before starting.

## What was created

| File | Purpose |
| --- | --- |
| `src/server/jobs/pulse-jobs.ts` | Dependency-free PulseRank job dispatcher: `PULSE_JOB_NAMES` / `PulseJobName` union (12 jobs), `LEGACY_JOB_DENYLIST` (7 legacy UNBROKEN names), `pulseJobHandlers` registry, and `dispatch()`. |
| `src/worker/pulse-worker.ts` | Polling worker skeleton mirroring the legacy worker lifecycle (`src/worker/index.ts`, which is intentionally NOT deleted — disposition REWRITE says it stays until the replacement is wired). In-process queue seam with TODO-REWIRE, collect-flag gating, graceful shutdown. |
| `tests/unit/server/jobs/pulse-jobs.test.ts` | 44 tests covering denylist rejection, unknown-name rejection, all 12 pulse.* acceptances, flag gating (pure gate + live worker-loop behavior). |

## Dispatcher contract (`pulse-jobs.ts`)

- `dispatch(job: { name, payload })` **fails closed**: only an exact,
  case-sensitive member of `PULSE_JOB_NAMES` is accepted. Everything else —
  denylisted legacy names, unknown names, casing tricks (`PULSE.COLLECT.SAMPLE`),
  whitespace suffixes, malformed requests (`undefined`, `42`, `{}`) — returns
  `{ accepted: false, reason: "legacy_or_unknown_job_rejected" }`. It never
  throws and never executes anything on rejection.
- Accepted jobs run their registry handler inside a try/catch; a throwing
  handler becomes `{ accepted: true, result: { status: "handler_error", ... } }`
  rather than an exception escaping the dispatch boundary.
- All 12 handlers are typed stubs returning
  `{ status: "not_implemented", job }`. The module imports nothing — importing
  it can never open a DB connection or socket.

Denylist (exact strings): `collect-elevator-status`, `refresh-gtfs`,
`refresh-accessibility-advisories`, `refresh-stop-relocations`,
`refresh-stop-guides`, `journey-refresh`, `commute-notification`.

## Worker skeleton (`pulse-worker.ts`)

Lifecycle copied from `src/worker/index.ts`: startup log banner (worker id +
flag states + poll interval), immediate first poll then interval polling,
lease-renewal timer around each claimed job, drain-in-flight-work stop, and
SIGTERM/SIGINT handlers that exit(0) after draining.

Deliberate seams (this file opens no sockets/databases):

1. **Queue** — minimal in-process `PulseJobQueue` interface
   (`claimNext` / `renewLease` / `settle`) plus `createInMemoryPulseJobQueue()`.
   **TODO-REWIRE:** swap for the Postgres primitives in
   `src/server/jobs/queue.ts` (`claimNextJob`, `renewJobLease`, succeeded/failed
   settlement). That file's disposition is RETAIN_AND_REFACTOR so locking,
   leases, retries, and idempotency carry over — but importing it today would
   drag the legacy dispatch graph and a live `postgres` client into this
   skeleton, violating "no data binding".
2. **Flags** — before ANY `pulse.collect.*` job, the worker consults
   `COLLECT_JOB_FLAG_REQUIREMENTS`: `sample`/`refresh-batch` require
   `PULSERANK_COLLECTION_ENABLED`, `discovery` requires
   `PULSERANK_DISCOVERY_ENABLED` (read through
   `src/config/pulserank-flags.ts`). Disabled ⇒ skip with a log line naming the
   env var; the job settles as `skipped_flag_disabled` and its handler never
   runs. Non-collect jobs are never gated.
3. **Handlers** — everything funnels through the fail-closed `dispatch()`; a
   claimed legacy/unknown name (should be impossible once the real queue lands)
   settles as `rejected`.

Entry point guard: `if (import.meta.main) startPulseWorker()` — running
`bun src/worker/pulse-worker.ts` starts the loop; tests/importers do not.
Programmatic `startPulseWorker(options)` accepts queue/flags/poll-interval/log
injections and defaults signal handlers off for embedders (the main-entry path
installs them).

## Verification

- `bun run test` from the worktree: **109 files / 1027 tests, all passing**
  (44 new).
- `bun run typecheck`: clean.
- Scoped `eslint` on the three new files: clean.

## Not done (by design)

- No deletion of `src/worker/index.ts`; no edits to `src/server/jobs/queue.ts`.
- No real collection, Bright Data calls, network, or DB wiring anywhere.
- No new dependencies installed.
