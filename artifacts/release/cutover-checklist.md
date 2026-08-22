# PulseRank cutover checklist

This checklist contains no credentials or production payloads.

## Owner-only provisioning

- [ ] Identify/provision the Coolify project and web application.
- [ ] Identify/provision the private worker application.
- [ ] Configure the runtime environment from `.env.example`.
- [ ] Mount the private incident-artifact volume at `/data/incidents`.
- [ ] Confirm the final HTTPS origin.

## Agent-verifiable release candidate

- [x] Active collector is `c_mt33nlnkq376z132b`.
- [x] Latest trusted run is recorded in `docs/coordination/state.yaml`.
- [x] Latest golden run has zero validation findings.
- [x] Public queries are trusted-only and attributed to Caffeine Informer.
- [x] Collection/discovery and judge mutation flags default to false.
- [x] Three-dimensional enhancement is disabled by default.
- [x] Legacy runtime references pass `bun run release:check`.
- [x] Desktop/mobile public smoke tests pass.

## Deployment verification

- [ ] Run `ops` migrations once against the target database.
- [ ] Verify web live/readiness health.
- [ ] Verify worker startup, lease polling, and private heartbeat.
- [ ] Verify the public route matrix and `/admin` 404.
- [ ] Verify the live-data collector ID and trusted run.
- [ ] Record the deployed commit/image digest and origin in the owner release log.
- [ ] Keep the old route available for rollback until the smoke window closes.

## Rollback trigger

Rollback if readiness fails, the worker cannot claim/settle jobs, a public query
exposes non-trusted data, a layout drift is treated as a service event, or any
legacy government collection path becomes runnable.
