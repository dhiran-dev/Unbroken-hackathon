# UNBROKEN

UNBROKEN is an elevator-aware accessibility product for San Francisco Muni. It publishes step-free information only after source data passes deterministic trust checks, and it keeps the last trusted state when the source or extraction fails.

The application is currently developed with:

- Bun 1.3.14
- Next.js 16 and React 19
- PostgreSQL and Drizzle ORM
- Better Auth
- Tailwind CSS 4 and shadcn-style base-mira components
- Bright Data Scraper Studio
- Fireworks AI with `accounts/fireworks/models/deepseek-v4-flash-0731`

## Localhost setup

1. Install Bun 1.3.14 or newer.
2. Copy `.env.example` to `.env.local` and add local credentials.
3. Install dependencies:

   ```bash
   bun install
   ```

4. Apply committed migrations:

   ```bash
   bun run db:migrate
   ```

5. Start localhost:

   ```bash
   bun run dev
   ```

6. Open <http://localhost:3000>.

No Docker installation is required for local development.

## Initial protected accounts

Set one or both credential pairs in ignored `.env.local`, then run the command once:

```bash
bun run auth:bootstrap
```

Supported pairs:

- `OWNER_EMAIL` and `OWNER_PASSWORD`
- `JUDGE_ADMIN_EMAIL` and `JUDGE_ADMIN_PASSWORD`

Passwords must contain at least 14 characters. Public sign-up is disabled. Remove the plaintext bootstrap password variables after the accounts are created.

## Trusted collection

Run one production-collector cycle synchronously:

```bash
bun run collect:run
```

Run the five-minute scheduler, retry queue, retention job, and worker heartbeat:

```bash
bun run worker
```

The private Operations and History pages expose trusted timing, decisions, and evidence to authenticated owners/admins. Collection details and safety behavior are documented in [docs/architecture/trusted-collection.md](docs/architecture/trusted-collection.md).

Incident detection, safe Bright Data healing, Fireworks advisory review, explicit human approval, and post-approval verification are documented in [docs/architecture/healing-safety.md](docs/architecture/healing-safety.md).

## Verification

```bash
bun run lint
bun run typecheck
bun run test
bun run build
bun run test:e2e
```

Health endpoints:

- `GET /api/health/live` confirms the web process is serving requests.
- `GET /api/health/ready` confirms the application can reach PostgreSQL.

## Deployment

The owner deploys through Coolify. See [deploy/coolify.md](deploy/coolify.md). The repository contains one image definition for two processes: the web application and the worker.

## Design provenance

The design-language reference and pinned T3 Code commit are documented in [docs/design/t3-code-reference.md](docs/design/t3-code-reference.md). Third-party notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
