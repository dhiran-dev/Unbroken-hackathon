# Contributing

Small, reviewable changes are welcome. Before opening a change:

1. Read `AGENTS.md` and preserve the fixed Bright Data collector ID and SFMTA
   source URL.
2. Keep the public product fail-closed: missing status is unknown, layout drift
   emits no service event, and AI output never approves or publishes a repair.
3. Keep secrets, raw production responses, local plans, and private incident
   artifacts out of Git. Use the synthetic examples for documentation.
4. Run the relevant checks, preferably the complete local gate:

   ```bash
   bun install --frozen-lockfile
   bun run check
   ```

   `bun run release:check` is offline and checks documentation presence,
   environment-example hygiene, stable integration pins, and synthetic JSON
   markers. Credentialed E2E mutation tests are opt-in; do not enable them
   against production.

Describe the rider-facing impact, operational impact, and test evidence in the
change description. Do not include private deployment URLs or credentials.
