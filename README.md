# PulseRank

PulseRank is a caffeine product observatory. It turns one consented Caffeine
Informer source into a browsable, provenance-first catalog with deterministic
eligibility rules and browser-local personal tools.

The public experience is deliberately transparent:

- Home shows only real trusted-catalog counts and featured records.
- Explore filters trusted products and plots exact numeric observations.
- Product passports preserve qualifiers, sparse states, source URLs, and
  observed timestamps.
- Leaderboards are immutable snapshots for highest total caffeine, highest
  exact concentration, and explicit caffeine-free products.
- Compare, My Pulse, recent products, and My Day stay in the user’s browser.
- Changes and Live Data show trusted history and real pipeline counters.
- Judge is a read-only-by-default HTML-first evidence cockpit.

No product model, generated brand image, confidence score, or fabricated
catalog row is used. The optional Checkpoint 2 visual enhancement is implemented
as a local-image Three.js layer, but remains off by default; the public product
is always complete HTML/CSS with an accessible fallback.

## Trust contract

The active collector is `c_mt33nlnkq376z132b`, registered only for the
Caffeine Informer source. The retired government-targeting collector and its
source remain audit history and are never invoked.

Raw collector output lands in the isolated `pulse` schema first. A row becomes
public only after the sequence:

```text
Bright Data v2 collector
        → pulse.raw_records
        → V1 contract mapping + validation
        → candidate observation
        → deterministic promotion
        → trusted pointer + leaderboard snapshot
```

Missing fields remain `not_published`; explicit zero remains zero; conflicting
or unparseable values never become a ranking value. Concentration requires
exact caffeine and a positive serving normalized to milliliters. No human or
model can bypass those gates. Fireworks, when configured, is advisory only and
uses the pinned model `accounts/fireworks/models/deepseek-v4-flash-0731` with
high reasoning effort.

## Run locally

Requirements: Bun 1.3.14+, Node 24+, and PostgreSQL.

```bash
bun install --frozen-lockfile
cp .env.example .env.local
# set DATABASE_URL and the server-only integration values you intend to use
bun run db:migrate
bun run dev
```

The application is available at `http://localhost:3000`. The feature flags
default to false for worker collection and judge mutations. To run the
explicit Caffeine Informer collection path, set the credentials in ignored
`.env.local` and run:

```bash
bun run collect:pulse
```

The command registers the source and v2 collector, runs either the listing
stage or a direct product stage, persists raw output, then runs ingest,
validate, promote, and leaderboard rebuild. It accepts `--mode sample
--url https://www.caffeineinformer.com/caffeine-content/...` for a bounded
single-product run. It rejects non-Caffeine Informer hosts and has no
auto-approval path. A failed external run remains visible in Live Data and
does not create public products.

For a controlled multi-page verification, pass a line-oriented URL file (or
the committed golden corpus object, which the runner normalizes into a private
temporary URL file):

```bash
bun run collect:pulse -- --mode sample \
  --input-file docs/source/golden-urls.json --timeout-ms 1200000
```

The production worker uses the Postgres queue claim/lease/retry path by
default. The in-memory queue is only a test seam; rejected legacy or unknown
jobs settle terminally and cannot be retried into a retired collector.

Checkpoint 2 is opt-in. It uses the original local observatory atlas under
`public/pulserank/` as textured planes only—never a product model or an
unapproved remote image. The shared stage is dynamically loaded in the browser,
caps device pixel ratio, pauses when the tab is hidden, and falls back for
reduced motion, WebGL errors, texture errors, or a disabled flag. Product
metrics, commands, JSON, and navigation remain HTML.

The remaining PulseRank stages are explicit and fail-closed: change events and
quarantine incidents are recorded atomically during promotion, raw retention is
skipped until an owner-approved policy exists, and heal preview/verification
use `pulse.heal_sessions`. A preview must pass the V1 contract and run checks,
stops at `awaiting_approval`, and can be approved only through the
origin/flag/token-gated `POST /api/pulse/heal/{sessionId}/approve` endpoint.
Verification refuses to collect until that human approval is persisted, then
reruns the same active collector through the normal trusted pipeline.

Useful checks:

```bash
bun run lint
bun run typecheck
bun run test
node node_modules/next/dist/bin/next build
bun run release:check
bun run test:e2e
```

## Environment

Never commit `.env.local`, production payloads, API tokens, database URLs, or
incident bodies. Use `.env.example` as the variable contract.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | Public browser origin. |
| `DATABASE_URL` | PostgreSQL connection; production requires TLS except the documented owner-authorized exception. |
| `BRIGHTDATA_API_TOKEN` | Server-only Bright Data credential. |
| `BRIGHTDATA_COLLECTOR_ID` | Must equal `c_mt33nlnkq376z132b`. |
| `FIREWORKS_API_KEY` | Optional advisory-review credential. |
| `FIREWORKS_MODEL` | Must equal the pinned Fireworks model. |
| `FIREWORKS_REASONING_EFFORT` | Must be `high`. |
| `INCIDENT_ARTIFACTS_DIR` | Private persistent incident/evidence directory. |
| `PULSERANK_JUDGE_TOKEN` | Server-only token required for explicit heal approval; never expose it to the browser. |
| `PULSERANK_*` | Fail-closed application, collection, public-field, and judge flags. |
| `NEXT_PUBLIC_PULSERANK_3D_ENABLED` | Global Checkpoint 2 kill switch; `false` by default. |
| `NEXT_PUBLIC_PULSERANK_3D_HOME` … `NEXT_PUBLIC_PULSERANK_3D_JUDGE` | Per-page image-stage flags; each is subordinate to the global switch and defaults to `false`. |

## Deployment

The canonical remote is
`https://github.com/dhiran-dev/Unbroken-hackathon.git`; the release branch is
`main`. Coolify should build the Dockerfile from `main` and provide the
runtime-only environment at deploy time.

- Web target: Docker target `runtime`, port `3000`, health path
  `/api/health/ready`.
- Worker target: Docker target `worker`, no public port, with a persistent
  private incident-artifact volume.
- Ops target: run `bun run db:migrate` once against the same runtime database.
- Keep `PULSERANK_JUDGE_MUTATIONS_ENABLED=false` and
  `--auto-approve` disabled for demonstrations.

See [deploy/coolify.md](deploy/coolify.md) for the release order, environment
boundary, rollback, and safe deployment notes. The owner sets the final public
domain; no unverified deployment URL is hard-coded here.

The current cutover evidence and owner-only provisioning boundary are recorded
in [docs/handoffs/deployment-cutover.md](docs/handoffs/deployment-cutover.md)
and [artifacts/release/cutover-checklist.md](artifacts/release/cutover-checklist.md).

When the owner is ready to clear the remaining Cloudflare Access/Coolify
boundary, run `ENV_FILE=.env.local ./scripts/pulserank-cutover-wizard.sh`. It
captures only the owner-provided Access and resource identifiers locally, then
walks through legacy shutdown and the final smoke-check confirmation. It never
starts services, changes DNS, or enables automatic Bright Data approval.

## Design

The approved mockups are consolidated in [DESIGN.md](DESIGN.md), with machine-
readable extensions in `.impeccable/design.json`. The visual language is a
dark observatory: void navy surfaces, violet signal accents, cyan operational
markers, compact data tables, and explicit state badges.
