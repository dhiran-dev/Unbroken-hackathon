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

## First release order

1. Apply the committed Drizzle migrations once.
2. Bootstrap the owner and judge-admin accounts once.
3. Remove bootstrap passwords from every long-lived environment.
4. Start the web service and verify `/api/health/live` and `/api/health/ready`.
5. Start the worker and verify its heartbeat in the private operations page.

## Rollback

Redeploy the previous known-good Git commit. Database migrations are forward-only; do not manually delete tables or rewrite migration history.
