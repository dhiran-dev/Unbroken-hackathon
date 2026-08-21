# PulseRank File Ownership

Subagents must not modify another agent's exclusive scope without orchestrator approval.

| Owner | Exclusive scope |
|---|---|
| Orchestrator | `package.json`, `AGENTS.md`, `.env.example`, shared exports, deployment files, `docs/coordination/state.yaml`, lockfile, dependency installs |
| A0 | legacy shutdown classification, feature flags, new skeleton dirs |
| A1 | `docs/source/**` |
| A2 | `src/server/collection/**`, `artifacts/scraper/**` |
| A3 | `src/domain/product/contracts/**` |
| A4 | `src/server/db/schema/pulse*`, migrations |
| A5 | normalization, validation, promotion, change logic |
| A6 | fixtures and replay tests |
| A7 | worker/jobs |
| A8 | public API and DTO query services |
| A9 | design tokens, generic images, primitive components |
| A10 | consumer routes and page components |
| A11 | browser-local state |
| A12 | judge routes and demo actions |
| T0–T6 | Three.js visual-stage modules only |
| A13 | E2E, accessibility, release checks, deployment verification |
| A14 | README, architecture, sample output, demo script |

## Merge protocol

Each agent must:
1. Commit on its own `agent/<name>` branch inside its worktree.
2. Run scope tests (`bun run typecheck` minimum; `bun run test` for code scopes).
3. Write `docs/handoffs/<agent>.md`: files changed, tests run, assumptions, risks.
4. Request merge via `docs/coordination/merge-queue.md` (orchestrator merges).

Merge order:
`A0 → A1/A2/A3 → A4/A5/A6 → A7/A8 → A9/A10/A11 → A12 → CP1 tag → T0/T1/T2 → T3/T4/T5/T6 → A13 → A14`

## Hard rules

- Only the orchestrator edits the lockfile or installs dependencies into the main checkout.
- No agent may self-approve a gate. Only the orchestrator approves gates.
- Legacy collector `c_msyjsllt1r9ej5tdub` / SFMTA: never invoke, heal, approve, or rename.
- No agent may drop legacy tables, delete applied migrations, or force-push.
