# Manual Coolify deployment

This deployment is performed by the owner through the Coolify interface. No Coolify API token is required by UNBROKEN and no deployment credential belongs in the application environment.

## Before deployment

1. Confirm `main` is green in GitHub Actions.
2. Choose the public application URL.
3. Set `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, and `PRODUCTION_APP_URL` to that HTTPS origin.
4. Generate a production-only `BETTER_AUTH_SECRET` with at least 32 random bytes.
5. Add the PostgreSQL, Bright Data, and Fireworks variables from `.env.example`.
6. Do not add `OWNER_PASSWORD` or `JUDGE_ADMIN_PASSWORD` to the long-lived web or worker environment after bootstrap.

### Build-time versus runtime variables

- Enable **Build Variable** only for `NEXT_PUBLIC_APP_URL`; Next.js intentionally
  embeds this public origin into browser assets.
- Keep `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, Bright Data,
  Fireworks, and bootstrap credentials runtime-only. The Dockerfile uses
  unreachable, non-secret placeholders solely while Next.js discovers routes;
  they are not copied into the runtime image environment.
- Never paste a database URL, API token, or password into a Docker build
  argument or deployment log.

## Web service

- Repository: `https://github.com/dhiran-dev/Unbroken-hackathon.git`
- Branch: `main`
- Build pack: Dockerfile
- Port: `3000`
- Health host: `127.0.0.1`
- Health path: `/api/health/ready`
- Health start period: `20` seconds
- Start command: image default (`bun server.js`)

## Worker service

Use the same repository, branch, Dockerfile, image, and environment variables.

- Docker build stage target: `worker`
- Keep the start command and custom Docker options empty. The worker target
  already starts `bun dist/worker.js`.
- Leave the Coolify UI healthcheck disabled. The worker image defines a
  lightweight process healthcheck for deployment readiness; ongoing worker
  health is measured by its database heartbeat in the private Operations page.
- Do not expose a public port.
- Do not attach a domain.
- The first heartbeat should appear within 30 seconds.
- Attach a persistent volume at `/data/incidents` and set
  `INCIDENT_ARTIFACTS_DIR=/data/incidents`. Healing previews and approval
  envelopes are private evidence and must survive worker restarts.

## Private OTP service

Use `deploy/otp/compose.json` as a manual Docker Compose service and follow `deploy/otp/README.md` for the pinned build and verification workflow.

- Attach one durable private volume through `OTP_STATE_DIR` for sources, candidate graphs, and the atomic `current` link.
- Give the private build task server-only `DATABASE_URL` access to the active trusted transit snapshot. Never pass a 511 token, GTFS file, or caller-supplied hash to the graph build.
- Do not attach a public domain or publish a host port. Join the web/worker consumers and `otp` service only to the internal network.
- Keep the pinned image digest, read-only root and graph mount, 4 GiB container limit, 3 GiB Java heap, dropped capabilities, and no-new-privileges settings unchanged.
- Run the candidate build with an explicit Muni service date and time. It must load and pass health, neutral-transit, and unknown-wheelchair probes before the `current` graph moves.
- Restart the private OTP service after a candidate is promoted, then run the private verifier again before enabling citywide planning.

## First release order

1. Apply the committed Drizzle migrations once.
2. Bootstrap the owner and judge-admin accounts once.
3. Remove bootstrap passwords from every long-lived environment.
4. Start the web service and verify `/api/health/live` and `/api/health/ready`.
5. Build, promote, and start the private OTP graph; verify its private health and sample candidate.
6. Start the worker and verify its heartbeat in the private operations page.

## Private migration and bootstrap target

The Dockerfile also provides an `ops` target for one-off database work. It contains the checked-in Drizzle migrations and bootstrap script, but it is not a public service. Run these commands from a temporary Coolify task or release job with the production runtime environment attached:

1. Build/select the Docker target `ops` and run `bun run db:migrate`.
2. Set one-time `OWNER_*` and/or `JUDGE_ADMIN_*` variables and run `bun run auth:bootstrap`.
3. Remove both bootstrap passwords from the task and every long-lived web/worker environment before starting services.

The production environment must keep the exact `BRIGHTDATA_COLLECTOR_ID=c_msyjsllt1r9ej5tdub` and SFMTA source URL from `.env.example`. The exact existing PostgreSQL endpoint is temporarily owner-authorized without `sslmode`; this exception is restricted in code to that host, port, and database. Every other database URL must use `sslmode=require`, `verify-ca`, or `verify-full`, and explicit weak modes are rejected. `BETTER_AUTH_URL` must be HTTPS. Do not print task environments or migration output containing credentials.

## Rollback

Redeploy the previous known-good Git commit. Database migrations are forward-only; do not manually delete tables or rewrite migration history.
