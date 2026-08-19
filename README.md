# UNBROKEN

**A step-free trip should stay step-free.** UNBROKEN helps a San Francisco
Muni rider decide whether an elevator-dependent journey is usable *right now*.
It reads the official SFMTA elevator-status page through a custom Bright Data
Scraper Studio collector, checks the result deterministically, and publishes a
journey only when the evidence is trusted.

[Open the live app](https://unbroken.fifthavatar.com) · [Read the safety
architecture](docs/architecture/healing-safety.md) · [Read the synthetic judge
examples](artifacts/examples/README.md)

> UNBROKEN is a hackathon project and is not an official SFMTA service. A
> “Working” label describes the latest trusted source observation; it is not a
> guarantee that an elevator will remain available when a rider arrives.

## The rider experience

The public surface is deliberately small:

1. Choose a starting station and destination from the supported Muni Metro
   catalog.
2. See whether each required street, platform, direction, and transfer elevator
   is **Working**, **Out of service**, or **Status not confirmed**.
3. Get a conservative step-free plan only when every required dependency is
   verified against the latest trusted snapshot.

If the source is unavailable, stale, incomplete, or structurally different,
UNBROKEN holds the last trusted state and pauses route claims when freshness
cannot be confirmed. It never turns a missing field into “Working.” The initial
catalog covers the 11 stations represented by the SFMTA source; it does not
pretend to plan arbitrary Bay Area journeys.

### A judge-friendly demo

Use the live link above or run the app locally. A short walkthrough should show:

1. The landing page’s origin/destination form and its step-free explanation.
2. A status-page search for a station, including the source verification time
   and older-data warning when applicable.
3. A route attempt that either shows the verified station path or explains why
   planning is paused/fails closed.
4. An authenticated operator view of Operations, History, and an incident’s
   deterministic checks and evidence timeline.
5. The synthetic layout-drift example: publication is frozen, no service event
   is emitted, and no route recalculation is requested.

The final hackathon submission should pair this repository and live app with a
public demo recording. The recording URL is intentionally not fabricated in
source control; add the final recording link to the submission checklist before
judging.

## Architecture at a glance

```text
official SFMTA page
        │
        ▼
custom Bright Data Scraper Studio collector
        │ trigger + bounded polling
        ▼
Zod contract + source/freshness/coverage/identity/fingerprint gates
        │                         │
        │ accepted                └─ rejected: hold trusted snapshot + incident
        ▼                                      │
trusted PostgreSQL snapshot                     └─ bounded healing preview
        │                                               │
        ▼                                               ├─ deterministic preview gates
public status + reviewed route planner                 ├─ optional Fireworks advisory
                                                        └─ authenticated human decision
                                                           + fresh post-approval run
```

The web process serves rider and protected operator pages. A separate Bun
worker schedules five-minute collection buckets, claims queue jobs with
database locking, maintains a heartbeat, performs retention, and runs incident
actions. PostgreSQL is the source of job/idempotency/audit state; it is not a
substitute for a trusted SFMTA observation.

### Trust and safety contract

- The production collector stays `c_msyjsllt1r9ej5tdub` through collection,
  healing, approval, and verification.
- Every collection must pass the versioned contract, exact source identity,
  San Francisco timestamp/freshness, known-station coverage, plausible row
  count, unique equipment identities, allowed statuses, station consistency,
  and a stable structural fingerprint.
- Missing `equipment_status` is `unknown`, never `in_service`.
- Rejected, failed, or unfinished output writes evidence and a report but no
  observations, service events, trusted snapshot, or route recalculation.
- A newer rejected run cannot replace the last trusted snapshot. The public API
  omits collector IDs, source keys, raw fields, incidents, operator identity,
  and model output.
- A layout drift starts an incident; it is not treated as an elevator outage.

The full collection and accessibility boundaries are documented in
[trusted collection](docs/architecture/trusted-collection.md) and
[public accessibility semantics](docs/architecture/public-accessibility.md).

## Bright Data Scraper Studio integration

This project uses a **custom scraper created in Bright Data Scraper Studio**,
not a library scraper. The application keeps the production collector ID and
public SFMTA source URL fixed:

- Collector: `c_msyjsllt1r9ej5tdub`
- Source: [SFMTA Muni Metro elevator status](https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod)
- Trigger: Bright Data `POST /dca/trigger`
- Poll: Bright Data `GET /dca/dataset?id=...`
- Schedule: one PostgreSQL-backed job per five-minute UTC bucket

Requests use bounded timeouts/retries. A result is not trusted because Bright
Data returned JSON; it must pass the deterministic gates above. When extraction
drift is detected, an authenticated operator can request a Bright Data healing
preview for the existing collector. Healing must stop at its preview/approval
gate. Production is unchanged until deterministic preview validation, an
explicit human decision, and a fresh live verification collection all succeed.

See [healing safety](docs/architecture/healing-safety.md) and the
[healing runbook](docs/runbooks/healing.md) for the operator sequence.

## Fireworks advisory review

After a deterministic preview passes, an operator may request a structured
advisory review from Fireworks:

- Provider: Fireworks AI
- Model: `accounts/fireworks/models/deepseek-v4-flash-0731`
- Reasoning effort: `high`
- Output: strict JSON schema with recommendation, confidence, risks, suspected
  inventions, missing identities, format compatibility, and required human
  checks

Fireworks is not the source of truth and cannot call approval, save the
collector, publish a snapshot, emit service events, or update routing. A failed
or unavailable review leaves the deterministic freeze in place. An authenticated
human still reads the evidence, types the exact decision phrase, and owns the
approval or rejection. The model is advisory only.

## Run locally with Bun

Requirements: Bun `1.3.14` or newer and PostgreSQL. Docker is not required for
local development.

```bash
git clone <repository-url>
cd brightdata_hackathon
bun install --frozen-lockfile
cp .env.example .env.local
```

Edit `.env.local` with local values. Generate a strong auth secret instead of
copying an example value:

```bash
openssl rand -base64 48
```

At minimum, set `DATABASE_URL`, `BETTER_AUTH_SECRET`, and the local auth/app
URLs. Add real Bright Data and Fireworks credentials only when you intend to
run collection or healing; blank values are deliberately safe for a docs-only
checkout but cannot authenticate those integrations.

Apply migrations and start the web process:

```bash
bun run db:migrate
bun run dev
```

In a second terminal, start the scheduler and queue worker when you want
five-minute collection, retries, retention, and incident jobs:

```bash
bun run worker
```

For one intentionally live synchronous collection (with integration credentials
configured), use:

```bash
bun run collect:run
```

The command reports an accepted/rejected result and exits non-zero for a safe
rejection. It does not bypass validation or human approval. Without a trusted
snapshot, the public UI truthfully reports that elevator information is
unavailable; synthetic examples are never loaded as live data.

### One-time protected accounts

Public sign-up is disabled. Set one or both pairs only in ignored
`.env.local`, run the bootstrap command once, then remove the plaintext
password variables:

```bash
bun run auth:bootstrap
```

- `OWNER_EMAIL` + `OWNER_PASSWORD`
- `JUDGE_ADMIN_EMAIL` + `JUDGE_ADMIN_PASSWORD`

Passwords must be at least 14 characters. Do not place bootstrap passwords in a
long-lived web/worker environment or in a demo recording.

## Environment variables

`.env.example` is intentionally blank for secrets. Never commit `.env.local`,
production environment files, API headers, database URLs, or incident bodies.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Yes | Public browser origin; safe to expose and embedded at build time. |
| `BETTER_AUTH_URL` | Yes | Auth origin; must be HTTPS in production. |
| `PRODUCTION_APP_URL` | Optional | Deployment metadata kept equal to the public origin; current runtime behavior uses the two URL variables above. |
| `BETTER_AUTH_SECRET` | Yes | Server-only session secret; use at least 32 random bytes. |
| `DATABASE_URL` | Yes | PostgreSQL; production requires `sslmode=require`, `verify-ca`, or `verify-full` except the documented owner-authorized legacy case. |
| `BRIGHTDATA_API_TOKEN` | For live collection/healing | Server-only Bright Data credential. |
| `BRIGHTDATA_COLLECTOR_ID` | Yes | Must remain `c_msyjsllt1r9ej5tdub`. |
| `SFMTA_SOURCE_URL` | Yes | Must remain the public SFMTA URL pinned in `.env.example`. |
| `FIREWORKS_API_KEY` | For advisory review | Server-only Fireworks credential. |
| `FIREWORKS_API_BASE_URL` | Yes | Fixed to the Fireworks inference API base. |
| `FIREWORKS_MODEL` | Yes | Fixed to the configured DeepSeek review model. |
| `FIREWORKS_REASONING_EFFORT` | Yes | Fixed to `high`; this is not an approval policy. |
| `INCIDENT_ARTIFACTS_DIR` | Production | Private, persistent worker path; use `/data/incidents` in Coolify. |
| `OWNER_*`, `JUDGE_ADMIN_*` | One-time only | Account bootstrap inputs; remove after bootstrap. |

## Coolify deployment

The owner deploys the same repository and commit as two services:

- **Web:** Docker target `runtime`, port `3000`, `/api/health/ready`, no secrets
  baked into the image.
- **Worker:** Docker target `worker`, no public port/domain, persistent private
  `/data/incidents` volume, database heartbeat shown in Operations.
- **Ops:** Docker target `ops` for one-off committed migrations and account
  bootstrap before starting long-lived services.

Set `NEXT_PUBLIC_APP_URL` as the only build variable. Keep database, auth,
Bright Data, Fireworks, and bootstrap inputs runtime-only. Run migrations and
bootstrap in the documented order, remove bootstrap passwords, then verify both
health endpoints and the worker heartbeat. See the detailed
[Coolify guide](deploy/coolify.md) and [deployment runbook](docs/runbooks/deployment.md).

## Verification and release hygiene

The repository has an offline release check plus code/test/build checks:

```bash
bun run release:check  # docs, pins, synthetic examples, secret/artifact hygiene
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:e2e
bun run check          # lint + typecheck + unit tests + build + release check
```

The production build intentionally enforces HTTPS for `BETTER_AUTH_URL` and TLS
for `DATABASE_URL`. If a local `.env.local` uses HTTP PostgreSQL development
values, use CI-style non-secret placeholders for the build check:

```bash
env BETTER_AUTH_URL=https://127.0.0.1:3000 \
  DATABASE_URL="postgres://unbroken:unbroken@127.0.0.1:5432/unbroken?sslmode=require" \
  BETTER_AUTH_SECRET=ci-only-secret-not-used-at-runtime-0123456789abcdef \
  BRIGHTDATA_API_TOKEN=ci-placeholder \
  BRIGHTDATA_COLLECTOR_ID=c_msyjsllt1r9ej5tdub \
  SFMTA_SOURCE_URL="https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod" \
  FIREWORKS_API_KEY=ci-placeholder \
  FIREWORKS_API_BASE_URL=https://api.fireworks.ai/inference/v1 \
  FIREWORKS_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731 \
  FIREWORKS_REASONING_EFFORT=high \
  bun run check
```

`bun run db:check` verifies migration metadata and is run in CI. E2E tests start
a local web server and skip credentialed operator mutations unless
`E2E_AUTH_EMAIL`, `E2E_AUTH_PASSWORD`, and the explicit `E2E_RUN_NOW=1` opt-in
are supplied. Do not use production credentials for tests. The CI quality job
runs frozen dependency installation, migration metadata, lint, typecheck, unit
tests, production build, and the offline release check; it does not call live
Bright Data or Fireworks.

Health endpoints:

- `GET /api/health/live` checks that the web process serves requests.
- `GET /api/health/ready` checks database reachability.

Operational procedures live in [incident response](docs/runbooks/incident-response.md),
[healing](docs/runbooks/healing.md), and [deployment](docs/runbooks/deployment.md).

## Scope, limits, and privacy

UNBROKEN does not predict failures, estimate walking time, invent alternate
cross-network routes, or replace official SFMTA communications. Reviewed station
topology is explicit and finite. Public endpoints intentionally exclude source
keys, collector/run IDs, fingerprints, incidents, operator identity, and LLM
output. Private raw payloads and healing evidence are redacted, hashed,
permission-restricted, retained for a bounded period, and excluded from Git.

## Attribution and AI disclosure

- Rider data comes from the public [SFMTA Muni Metro elevator status
  page](https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod) and
  reviewed SFMTA accessibility guidance linked from
  [public accessibility semantics](docs/architecture/public-accessibility.md).
- Collection uses a custom Bright Data Scraper Studio collector. Bright Data
  API references are listed in [trusted collection](docs/architecture/trusted-collection.md).
- The optional review uses Fireworks AI; the official structured-output and chat
  API references are listed in [healing safety](docs/architecture/healing-safety.md).
- The design language was informed by T3 Code at the pinned commit documented in
  [design provenance](docs/design/t3-code-reference.md). See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **AI-assisted development:** OpenAI Codex was used during the hackathon for
  implementation and documentation assistance. The project code, safety
  contract, and operational decisions are human-reviewed and explainable from
  this repository; the product Fireworks model is a separate advisory feature.

This repository is distributed under the [MIT License](LICENSE). Security
handling is documented in [SECURITY.md](SECURITY.md), and contribution checks
are in [CONTRIBUTING.md](CONTRIBUTING.md).
