# Manual Coolify deployment

This deployment is performed by the owner through the Coolify interface. No Coolify API token is required by UNBROKEN and no deployment credential belongs in the application environment.

## Before deployment

1. Confirm `main` is green in GitHub Actions.
2. Choose the public application URL.
3. Set `NEXT_PUBLIC_APP_URL`, `BETTER_AUTH_URL`, and `PRODUCTION_APP_URL` to that HTTPS origin.
4. Generate a production-only `BETTER_AUTH_SECRET` with at least 32 random bytes.
5. Add the PostgreSQL, Bright Data, and Fireworks variables from `.env.example`.
6. Do not add `OWNER_PASSWORD` or `JUDGE_ADMIN_PASSWORD` to the long-lived web or worker environment after bootstrap.

## Web service

- Repository: `https://github.com/dhiran-dev/Unbroken-hackathon.git`
- Branch: `main`
- Build pack: Dockerfile
- Port: `3000`
- Health path: `/api/health/ready`
- Start command: image default (`bun server.js`)

## Worker service

Use the same repository, branch, Dockerfile, image, and environment variables.

- Start command override: `bun dist/worker.js`
- Do not expose a public port.
- The first heartbeat should appear within 30 seconds.

## First release order

1. Apply the committed Drizzle migrations once.
2. Bootstrap the owner and judge-admin accounts once.
3. Remove bootstrap passwords from every long-lived environment.
4. Start the web service and verify `/api/health/live` and `/api/health/ready`.
5. Start the worker and verify its heartbeat in the private operations page.

## Rollback

Redeploy the previous known-good Git commit. Database migrations are forward-only; do not manually delete tables or rewrite migration history.
