# SF Citywide engineering map

This directory is the shared implementation reference for the SF Citywide implementation. Read `CONTEXT.md`, the relevant `docs/adr/` records, and the product spec before taking a ticket.

## Durable references

- `docs/product/sf-citywide-spec.md`: visible behavior and acceptance intent.
- `docs/engineering/sources.md`: authoritative sources, verified baseline, validation, cadence, and freshness.
- `docs/engineering/interfaces.md`: deep-module interfaces, public types, routes, schema ownership, and flags.
- `docs/engineering/ticket-catalog.md`: live local ticket state, blocking edges, ownership, tests, rollback, security, and accessibility.

## Phase gates

1. **Documentation and contracts**: every decision and ticket is fixed; the existing suite passes unchanged.
2. **Citywide data**: real import counts, source collectors, private OTP, and searchable places work while failed refreshes retain trusted data.
3. **Journey engine**: realtime and accessibility evidence deterministically select or reject candidates without an LLM.
4. **Public planner**: selection-only search, plain-language results, prominent source times, and unclustered CARTO/MapLibre behavior pass browser acceptance.
5. **Rider accounts**: Google-only public entry, atomic forty-account admission, role isolation, and two saved commutes pass concurrency and browser acceptance.
6. **Commute updates**: Pacific scheduling, deterministic messages, outbox idempotency, provider budgets, and controlled production delivery pass.
7. **Release**: coverage evidence, security, recovery, accessibility, performance, Coolify health, and the judge path pass on the deployed commit.

A phase is complete only after the primary agent reviews it, runs its complete gate, commits it, pushes it directly to `origin/main`, verifies deployment when available, and records verification and the commit SHA in the local ticket catalog.

## Role and model policy

- The primary agent owns architecture, dependency decisions, shared integration files, secondary review, full testing, commits, pushes, deployment, and browser verification.
- Implementation tickets may be delegated only to `gpt-5.6-sol` at high reasoning.
- First-pass review may be delegated only to `gpt-5.6-sol` at high reasoning.
- An implementation agent works from fixed ticket decisions, uses TDD at the specified seam, runs targeted checks, and reports its commit, changed files, checks, and risks. It never pushes or deploys.
- No agent changes stable collector IDs, treats unknown as confirmed, emits a service event from layout drift, calls automatic healing approval, generates rider instructions with AI, exposes a secret, or bypasses a phase gate.

## Integration ownership

Only the primary agent edits shared integration files: `package.json`, `bun.lock`, `.env.example`, `src/lib/env.ts`, `src/server/db/schema/index.ts`, `src/server/jobs/queue.ts`, `Dockerfile`, root navigation, and generated Drizzle metadata.

Area ownership:

| Area | Owned paths |
| --- | --- |
| Transit data | `src/domain/transit/**`, `src/server/transit/**`, transit schema |
| Journey planning | `src/domain/journey/**`, `src/server/journey/**` |
| Map | `src/components/map/**`, map hooks, map icons |
| Public experience | Public pages and non-admin components |
| Rider admission | `src/server/auth/**`, rider schema, public sign-in pages |
| Commute updates | `src/server/notifications/**`, `src/emails/**`, notification schema |
| OTP | `deploy/otp/**` |
| Quality | Fixtures, unit tests, Playwright tests, and runbooks |

## Rollout order

1. Deploy migrations and collectors with all new public flags off.
2. Import and validate the first GTFS snapshot.
3. Build and verify the private OTP graph.
4. Enable citywide planning for operators.
5. Enable the public planner.
6. Configure Google OAuth and enable rider signup.
7. Verify the Resend domain and enable controlled owner/judge sends.
8. Enable commute updates for all admitted riders.
9. Complete the deployed judge path and release audit.

No migration rollback is required to disable a surface. Feature flags turn off data refresh, public citywide planning, new Google admission, or sending independently while preserving stored evidence and existing operator access.
