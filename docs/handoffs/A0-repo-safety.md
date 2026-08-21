# A0 — Repo & Safety Handoff (UNBROKEN runtime freeze → PulseRank)

**Agent:** A0 (repo-safety)
**Branch:** `agent/repo-safety`
**Worktree:** `.worktrees/repo-safety`
**Status:** Complete. All deliverables committed; working tree clean after commit.

## What this commit does

Stages the legacy UNBROKEN runtime freeze **on paper only**: every active-tree
file is classified for the coming transition, typed PulseRank feature flags are
introduced defaulting to off, and empty PulseRank module directories are
scaffolded. No runtime behavior changes in this commit — the legacy tree still
compiles and typechecks exactly as before.

## Deliverables

| Deliverable | Path |
|---|---|
| File disposition matrix | `docs/transition/file-disposition.csv` |
| Typed feature flags | `src/config/pulserank-flags.ts` |
| PulseRank scaffolding | `src/domain/product/index.ts`, `src/server/collection/index.ts`, `src/server/ingestion/index.ts`, `src/components/pulserank/.gitkeep` |
| This handoff | `docs/handoffs/A0-repo-safety.md` |

## 1. File disposition (`docs/transition/file-disposition.csv`)

All **433 tracked files** are classified (verified by script against
`git ls-files`; zero unclassified, zero invented paths). Columns:
`path, disposition, rationale, references_legacy_collector_id`.

| Disposition | Files | Meaning |
|---|---|---|
| `RETAIN` | 79 | Domain-neutral infra: root configs, applied `drizzle/**` migrations (permanent), `.agents/**` skills, `components/ui/*`, theme components, `db/client.ts`, legacy schema mirrors (`schema/{core,auth,commute,transit}.ts`) |
| `RETAIN_AND_REFACTOR` | 33 | Keep mechanics, replace semantics: job queue primitives (`server/jobs/queue.ts`), incident lifecycle (`domain/incidents/*`, `services/incident*`), Bright Data client/heal plumbing, Fireworks review, source-run persistence (`services/collection.ts`), admin data/export/judge helpers, health endpoints, `lib/env.ts`, Dockerfile |
| `REWRITE` | 24 | Product-facing entry points rebuilt cleanly per plan §5.3: README/AGENTS/CONTEXT/.env.example/package.json, `app/layout.tsx`, `app/page.tsx`, **`worker/index.ts`**, admin dashboard pages, brand/header chrome, `release-check.ts`, `run-collection.ts`, CI workflow, `deploy/coolify.md` |
| `DELETE_FROM_ACTIVE_TREE` | 297 | UNBROKEN-only runtime recovered via Git history: `server/transit|journey|citywide-status|commutes|notifications|auth/**`, matching domain models, MapLibre stack, commute email, rider/auth UI+APIs, GTFS/OTP scripts and `deploy/otp/**`, old docs/artifacts/tests |

Method: import graph built over all `src/scripts/tests/deploy` TS files
(resolving `@/` and relative specifiers), then each file classified against the
transition plan's four-bucket matrix (§5). Cross-module edges confirmed e.g.
`server/jobs/queue.ts → server/transit/run-*-refresh.ts` (dispatch coupling to
strip during rewrite) and that nothing outside `server/transit` imports it
except pages/APIs/tests that are themselves DELETE/REWRITE.

14 files carry a literal reference to legacy collector `c_msyjsllt1r9ej5tdub`
(`references_legacy_collector_id=yes`): `lib/env.ts`, `domain/judge/model.ts`,
`scripts/release-check.ts`, `deploy/coolify.md`, `.github/workflows/ci.yml`,
plus docs/tests. **None were edited** — flagged for L5's release scanner and
the rewriting agents.

## 2. Feature flags (`src/config/pulserank-flags.ts`)

Typed, frozen flag object read from env, **all defaulting to false**:

- Server: `PULSERANK_APP_ENABLED`, `PULSERANK_COLLECTION_ENABLED`,
  `PULSERANK_DISCOVERY_ENABLED`, `PULSERANK_PUBLIC_EXTENDED_FIELDS`,
  `PULSERANK_JUDGE_MUTATIONS_ENABLED`
- Public (build-inlined via direct `process.env.NEXT_PUBLIC_*` member access so
  Next.js can inline them into client bundles):
  `NEXT_PUBLIC_PULSERANK_3D_ENABLED` plus per-page
  `_HOME/_EXPLORE/_LEADERBOARDS/_COMPARE/_CHANGES/_JUDGE`.
- Global 3D flag overrides page flags (master plan §15.1); helper
  `isThreeDimensionalPageEnabled(page)` applies the override.
- Truthy values: `"true"` / `"1"` (case-insensitive).

Not yet wired anywhere — wiring happens when each surface lands behind its flag.

## 3. Scaffolding

Created with placeholder `index.ts` / `.gitkeep`: `src/domain/product/`,
`src/server/collection/`, `src/server/ingestion/`,
`src/components/pulserank/`. **Already existed, left untouched:**
`src/domain/collection/` (holds legacy elevator contract files, classified
individually in the CSV) and `src/server/db/schema/` (legacy mirrors retained;
the future `pulse.ts` schema file will be added there by the DB agent).

## Tests run

- `bun run typecheck` → **pass (exit 0)**, run from the worktree.
- Worktree has no local `node_modules`; because the worktree is nested inside
  the main checkout (`.worktrees/repo-safety`), Bun resolves binaries and tsc
  resolves packages by walking up to `../../node_modules` (TypeScript 5.9.3).
  Cross-checked with `bun x tsc --noEmit -p tsconfig.json` → exit 0.
  **Typecheck therefore works from this worktree without installing anything.**
- Vitest/Playwright not run: per task scope only typecheck was required, and
  ~117 of the existing suites target modules this plan deletes; they are
  classified `DELETE_FROM_ACTIVE_TREE` and will be replaced by PulseRank suites.

## Compliance with MUST-NOT constraints

- ✅ No files deleted (dispositions are recorded, not executed).
- ✅ Nothing dropped (no DB access at all).
- ✅ `package.json` / `bun.lock` untouched.
- ✅ Legacy collector `c_msyjsllt1r9ej5tdub` referenced only in classification
  rows/notes; no code touching it was modified.
- ✅ Applied migrations (`drizzle/**`) untouched.

## Assumptions

1. Plan sections conflict in places (e.g. §5.2 "job queue primitives retain"
   vs §5.3 "`src/server/jobs/*` rewrite"). Resolution used: `queue.ts` =
   RETAIN_AND_REFACTOR (mechanics kept, all job types replaced);
   `incident-jobs.ts` = DELETE (its job names die with the legacy dispatcher).
   Similar call for public API routes: transit-shaped routes DELETE, generic
   patterns (health, admin run-trigger/incident-action) RETAIN_AND_REFACTOR.
2. `REWRITE` means *same path, content replaced wholesale*; if a successor
   lives at a new path instead, the old path is DELETE. Rewriting agents may
   downgrade REWRITE→DELETE when they build the replacement elsewhere.
3. Auth runtime (Better Auth) is removed from active runtime per plan §5.5;
   auth tables/migrations stay. Admin shell loses operator gating until the
   judge-mode gate replaces it.
4. `src/lib/env.ts` keeps compiling unchanged for now; stripping legacy
   collector/SFMTA/511 constants is explicitly deferred to the env-validation
   rewrite so this freeze commit stays inert.
5. The plans referenced live in the main checkout root (untracked); the CSV
   cites them by section number.

## Risks / watch-outs for downstream agents

- **R1 — Frozen-but-alive legacy runtime:** everything still compiles and the
  worker entry point still dispatches transit jobs if run. Do not start
  `bun run worker` / `collect:run` / `transit:*` scripts. Enforce via flags +
  dispatcher rewrite (L0/A0 follow-up) before any deploy.
- **R2 — Shared node_modules:** worktree builds depend on the main checkout's
  `node_modules` two levels up. If the worktree is ever moved out of
  `<repo>/.worktrees/`, run `bun install` locally first.
- **R3 — Schema mirror coupling:** `drizzle.config.ts` and migrations depend on
  the legacy `schema/*.ts` files staying until the post-hackathon cleanup;
  deleting them early breaks `drizzle-kit check`/fresh clones.
- **R4 — Collector-ID scan surface:** 14 files still contain
  `c_msyjsllt1r9ej5tdub`. L5's release scanner must treat the CSV's
  `references_legacy_collector_id` rows as the expected-residual list until the
  rewrites land, then require zero outside allowed locations.
- **R5 — `NEXT_PUBLIC_*` inlining:** per-page 3D flags are evaluated at build
  time; changing them requires a rebuild, not just an env restart.

## Suggested next steps

1. L0/A0 follow-up: rewrite `src/worker/index.ts` to PulseRank-only dispatch
   gated on `pulserankFlags.server.*` (fail-closed denylist for legacy names).
2. Env agent: rewrite `lib/env.ts` validation around the PULSERANK_* contract.
3. DB agent: add `src/server/db/schema/pulse.ts` (new file only).
