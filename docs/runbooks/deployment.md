# Coolify deployment runbook

UNBROKEN deploys from `main` using the checked-in Dockerfile. The image has
separate `runtime` (web), `worker`, and `ops` targets. The owner performs the
Coolify actions; no Coolify API credential is needed by the application.

## Release checklist

1. Confirm the GitHub quality job and local `bun run check` pass. Run
   `bun run release:check` when reviewing a submission; it is offline and does
   not contact Bright Data, Fireworks, PostgreSQL, or Coolify.
2. Choose the HTTPS public origin and set `NEXT_PUBLIC_APP_URL`,
   `BETTER_AUTH_URL`, and any deployment metadata to that origin. Use a new
   `BETTER_AUTH_SECRET`; production database connections must use TLS as
   described in [Coolify configuration](../../deploy/coolify.md).
3. Set runtime-only database, Bright Data, Fireworks, and incident-volume
   variables. Keep the collector ID and SFMTA source URL pinned to the values
   in `.env.example`. Never put credentials in a Docker build argument or log.
4. Deploy the web target on port `3000` with `/api/health/ready`. Deploy the
   worker target from the same commit with no public port or domain. Mount a
   persistent private volume at `/data/incidents` and set
   `INCIDENT_ARTIFACTS_DIR=/data/incidents`.
5. Before serving traffic, run the `ops` target once for committed migrations,
   then bootstrap the owner/admin account once. Remove one-time bootstrap
   passwords from the task and all long-lived services.
6. Check `/api/health/live`, `/api/health/ready`, the worker heartbeat in
   `/admin/operations`, and an authenticated `/admin/history` page. Trigger a
   collection only when a live Bright Data run is intended.

## Rollback and verification

Redeploy the previous known-good commit if the web or worker release is bad;
database migrations are forward-only. After rollback or restart, verify the
worker heartbeat, queue state, public freshness, and a new trusted collection.
Do not delete database tables, rewrite migration history, or manually publish a
raw payload.

See [deploy/coolify.md](../../deploy/coolify.md) for the target-by-target
settings and [incident response](incident-response.md) for a held or rejected
collection.
