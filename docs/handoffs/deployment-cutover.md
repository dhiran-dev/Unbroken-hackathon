# PulseRank deployment cutover handoff

Status: local release candidate verified; production cutover pending owner
provisioning in Coolify.

Latest release commit: `3f765bd` (pushed to `origin/main`).

## Verified release candidate

- Canonical repository: `https://github.com/dhiran-dev/Unbroken-hackathon.git`
- Deployment branch: `main`
- Active collector: `c_mt33nlnkq376z132b` (Caffeine Informer only)
- Latest trusted run: `c4871ed7-21b1-42b8-a507-0a06c9067cb6`
- Latest trusted catalog count: 128 products
- Latest golden run: 30 rows collected, 30 validated, zero findings, 28 new
  observations promoted
- `PULSERANK_COLLECTION_ENABLED=false` and
  `PULSERANK_DISCOVERY_ENABLED=false` remain the safe defaults
- Three-dimensional enhancement remains disabled

The local release checks pass: lint (one pre-existing warning), typecheck, unit
tests, production build, release hygiene, and six Chromium desktop/mobile smoke
tests. Public API smoke confirms 100-page pagination, trusted attribution, three
leaderboard snapshots, and `/admin` returning 404.

## External boundary

`https://unbroken.fifthavatar.com` still serves the legacy UNBROKEN application.
It must not be changed by DNS or routing until the PulseRank web target passes
the deployment checklist. The configured Coolify API token was used only for
read-only inspection and currently returns no projects or applications, so
there is no safe target ID for an agent to deploy to.

An old scheduler is still inserting retired `collect_sfmta_elevators` queue
rows in the shared database. The PulseRank queue claim and lease-recovery SQL
now allow only exact `pulse.*` job names, so those rows are structurally
unrunnable and are retained only as audit history. The owner still needs to
stop the old scheduler at its source; do not treat the claim boundary as a
replacement for that operational cutover.

The owner must provision or identify the Coolify resources before cutover:

1. Web service from `main`, Dockerfile target `runtime`, port `3000`, health
   path `/api/health/ready`.
2. Private worker service from the same commit, Dockerfile target `worker`, no
   public port, with `/data/incidents` mounted to the configured private
   incident-artifact volume.
3. One-time `ops` migration run against the target PostgreSQL database.
4. The owner-selected HTTPS domain or a temporary `/pulse-preview` route.
   The PulseRank heal approval endpoint is available at
   `/api/pulse/heal/{sessionId}/approve`; keep judge mutations and its token
   disabled until the owner explicitly authorizes a live healing demo.

Runtime secrets and database URLs belong only in Coolify runtime environment
configuration. Keep judge mutations and automatic Bright Data approval off.

## Cutover order

1. Provision the two services and apply the environment invariants in
   `deploy/coolify.md`.
2. Run the `ops` migration target once; do not rewrite migration history.
3. Start web and worker services from the same commit.
4. Verify `/api/health/live`, `/api/health/ready`, `/`, `/explore`,
   `/leaderboards`, `/compare`, `/my-pulse`, `/changes`, `/live-data`, and
   `/judge` from the deployment origin.
5. Verify the worker private heartbeat/operations view and confirm no legacy
   job is queued.
6. If the owner enables a bounded collection, verify the run in Live Data and
   confirm it reaches `validated` before any promotion.
7. Only after those checks pass, route the owner-selected domain to the web
   service. Do not route the legacy government collector or its historical
   snapshots into the new product.

## Rollback

Redeploy the previous known-good image/commit and restore the previous route.
Do not delete the `pulse` schema, force-push, rewrite migrations, or move
quarantined/raw records into the trusted pointer during rollback.
