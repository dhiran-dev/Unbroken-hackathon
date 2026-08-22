# A13a Handoff — PulseRank Release Compliance Gate

**Status: DONE — gate implemented, 31/31 unit tests green, and the current
PulseRank tree passes all failure checks.**

Branch `agent/qa-release` (worktree `.worktrees/qa-release`), fast-forwarded onto
`pulserank-rebuild` at `c6b71b5` before starting.

## What was created

| File | Purpose |
| --- | --- |
| `scripts/release-check.ts` | Full rewrite: PulseRank release gate. Six checks over static analysis + fs only; zero runtime deps beyond node builtins (`node:fs/promises`, `node:path`), so it also runs against bare temp-dir fixtures. CLI entry unchanged: `bun scripts/release-check.ts` (also wired as `bun run release:check`). |
| `tests/unit/release/release-check.test.ts` | 31 vitest cases driving every check against throwaway temp dirs with violating/clean fixtures per check, plus aggregation tests for `runReleaseChecks`. |

Handoff doc: this file.

## The six checks

Fail ⇒ exit 1 with findings listed (file:line). Warn ⇒ reported, never blocks.

1. **`legacy-runtime-references`** — scans `src/`, `scripts/`, `.github/`, `deploy/`
   for prohibited legacy runtime references:
   - SFMTA source URLs (`sfmta.com`),
   - GTFS refresh invocations (`refresh-gtfs`, `gtfs-refresh`, `refreshGtfs`,
     `GtfsRefresh`, `transit:refresh`, …),
   - legacy collector ID `c_msyjsllt1r9ej5tdub`.
   Allowed homes for legacy identity are documentation paths (`docs/legacy/`,
   `docs/handoffs/`, `docs/source/`, migration history, AGENTS.md), which sit
   outside the scanned roots by construction. The checker excludes
   `scripts/release-check.ts` itself so its own detection patterns never trip
   the gate. The active PulseRank collector is `c_mt33nlnkq376z132b`.
2. **`pulserank-flags`** — `src/config/pulserank-flags.ts` exists and every
   binding inside the `pulserankFlags` initializer provably defaults to false:
   each operand must be a safe reader call (`readServerFlag(…)` /
   `readPublicFlag(…)`, TRUTHY-set lookups that default false), an identifier
   initialized from one, or literal `false`. Bare `true`, negated readers,
   and arbitrary expressions fail.
3. **`product-contracts`** — `src/domain/product/contracts` modules exist
   (`product-scrape-row.schema.ts`, `product-scrape-row.ts`, `field-states.ts`,
   `observations.ts`); required exports present (`productScrapeRowV1Schema`
   const + zod import; types `ProductScrapeRowV1`, `FieldState`,
   `NumberObservation`, `ServingObservation`); golden fixture
   `src/domain/product/fixtures/standard-full.json` is valid JSON,
   `schemaVersion === "1.0"`, and carries every top-level section the schema's
   `z.object` declares (keys are parsed from the schema source, not mirrored).
4. **`db-schema-boundary`** — every table under `src/server/db/schema/` resolves
   to a known PostgreSQL schema: `public` (the existing app schemas
   auth/core/transit/commute via bare `pgTable`) or `pulse` (via the declared
   `pgSchema("pulse")` namespace). Flags new `pgSchema(...)` namespaces, tables
   bound to undeclared schema variables, and dotted `"schema.table"` names
   outside the known set. Known set is parameterizable
   (`checkDatabaseSchemas(root, { knownSchemas })`).
5. **`package-metadata`** *(WARN-only)* — package.json name/description/
   keywords mentioning "pulserank". The current package name is intentionally
   retained for repository continuity, so this remains a tolerated warning.
6. **`backup-artifact`** *(WARN-only)* — the `db_backup:` path referenced in
   `docs/coordination/state.yaml` (expected shape
   `backups/unbroken-before-pulserank-*.dump`) exists on disk.

## Exported API

Pure functions, all rooted at a directory argument:

```ts
scanLegacyReferences(root, opts?)      // Check 1 (fail)
checkFlags(root)                       // Check 2 (fail)
checkContracts(root)                   // Check 3 (fail)
checkDatabaseSchemas(root, opts?)      // Check 4 (fail)
checkPackageMetadata(root)             // Check 5 (warn)
checkBackupArtifacts(root)             // Check 6 (warn)
runReleaseChecks(root, opts?)          // aggregate → ReleaseReport { results, ok }
```

Shared types: `CheckResult`, `Finding`, `CheckStatus` (`"pass" | "warn" | "fail"`),
`ReleaseReport`; constants `LEGACY_COLLECTOR_ID`, `PULSERANK_COLLECTOR_ID`.

## Current-tree status

`bun scripts/release-check.ts` currently reports the same zero-failure result as
`bun run release:check`.
As of 2026-08-22, `bun run release:check` passes with zero failures:

- legacy runtime references: pass
- fail-closed PulseRank flags: pass
- product contract and golden fixture: pass
- database schema boundary: pass
- pre-rebuild backup artifact: pass
- package metadata: one tolerated warning because the package name remains
  `pulserank`

The release gate is intentionally static and offline. It does not prove the
owner-only Coolify cutover, Bright Data dashboard pause, or production worker
shutdown; those remain in `docs/handoffs/deployment-cutover.md`.

## Design decisions & caveats

- **Static layering for check 3**: the authoritative zod parse of all positive
  fixtures remains `tests/unit/domain/product/product-scrape-row.test.ts`. The
  gate does fast structural pre-validation (declared keys × fixture sections) so
  it needs no dependency resolution — required for temp-dir testability.
- **No git dependency**: unlike the previous release-check, file discovery is a
  plain fs walk (deterministic order, text-extension filter, 2 MB cap, NUL-byte
  binary guard), so it works in non-git temp fixtures.
- The former replay-tooling type error noted during the initial handoff is no
  longer present; the current full-tree typecheck passes.
- Runtime cost measured at ~0.13 s wall clock; no network, no DB.

## Verification performed

- `bunx vitest run tests/unit/release/release-check.test.ts` → 31/31 pass.
- `bun run typecheck` → only the pre-existing `tools/replay/adapters.ts` error;
  zero diagnostics attributable to A13a files.
- `bunx eslint scripts/release-check.ts tests/unit/release/release-check.test.ts`
  → clean.
- CLI run on the current tree → exit code 0 (0 failures, 1 tolerated warning).
