# Coolify deployment

PulseRank deploys from the canonical repository
`https://github.com/dhiran-dev/Unbroken-hackathon.git`, branch `main`. The
owner supplies the final HTTPS domain in Coolify; it is intentionally not
invented in source control.

## Environment boundary

Use the variables in `.env.example`. Only `NEXT_PUBLIC_APP_URL` is a build
variable. Database, Bright Data, Fireworks, incident, and feature-flag values
are runtime-only. Never put tokens, database URLs, API headers, or production
payloads in Docker build arguments or logs.

Required runtime invariants:

- `BRIGHTDATA_COLLECTOR_ID=c_mt33nlnkq376z132b`.
- The source is Caffeine Informer; government-targeting Bright Data jobs stay
  disabled.
- `FIREWORKS_MODEL=accounts/fireworks/models/deepseek-v4-flash-0731`.
- `FIREWORKS_REASONING_EFFORT=high`.
- `PULSERANK_JUDGE_MUTATIONS_ENABLED=false` for demos.
- `INCIDENT_ARTIFACTS_DIR` points to a private persistent volume.

## Web service

- Build pack: Dockerfile
- Target: `runtime`
- Port: `3000`
- Health path: `/api/health/ready`
- Start command: image default (`bun server.js`)
- Domain: owner-selected HTTPS origin

## Worker service

Create a second Coolify service from the same commit and environment:

- Target: `worker`
- No public port and no domain
- Start command: image default (`bun dist/worker.js`)
- Private persistent volume mounted at `/data/incidents`
- `INCIDENT_ARTIFACTS_DIR=/data/incidents`

The worker’s collection flag is fail-closed. A collection run is an explicit
operator action or scheduled job, and never auto-approves a Bright Data heal.

## Release order

1. Verify the commit on `main` with lint, typecheck, tests, Node-based Next
   build, and `release:check`.
2. Build the `ops` target and run `bun run db:migrate` once against the target
   database.
3. Start the web target and verify `/api/health/live` and
   `/api/health/ready`.
4. Start the worker target and verify its private heartbeat/operations view.
5. Run a bounded Caffeine Informer collection only when the owner has enabled
   the integration flag and accepted the source terms.
6. Check `/live-data`, `/judge`, and the public home before sharing the URL.

Do not copy raw collection payloads or incident artifacts into the image or
Git. Existing collector records and snapshots remain quarantined audit
history unless a fresh, valid run passes the deterministic pipeline.

## Rollback

Redeploy the previous known-good commit. Database migrations are forward-only;
do not delete the `pulse` schema, rewrite migration history, force-push, or
route old records into the trusted pointer during rollback.
