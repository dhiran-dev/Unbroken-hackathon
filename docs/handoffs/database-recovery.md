# PulseRank database recovery evidence

This runbook records the non-destructive database safety checks completed for
the PulseRank transition. It does not authorize a production restore or any
legacy-table deletion.

## Artifacts

- Pre-rebuild full dump: `backups/unbroken-before-pulserank-20260821-1808.dump`
- Pre-cutover schema-only dump:
  `backups/pulserank-schema-before-cutover-20260822-075626.sql`
- Schema dump SHA-256:
  `58d6128f6f01241cda9ae303d63da700ce154589f6e8a08f0f1aabef9f053fca`

The schema-only artifact was generated with `pg_dump --schema-only`. It
contains schema definitions but no `COPY` data statements. Both database
artifacts remain local, ignored handoff evidence and must not be committed.

## Isolated restore probe

On 2026-08-22, a fresh schema-only derivative was restored into a uniquely
named temporary database in the staging PostgreSQL instance using
`psql --set ON_ERROR_STOP=1 --single-transaction`. The probe passed and
reported two PulseRank-related namespaces (`pulse` and `drizzle`) and 16
PulseRank relations. The temporary database was removed immediately after the
verification; the trusted database and `pulse` data were not modified.

The probe deliberately used `--no-owner --no-acl` for the temporary restore so
it tested portability without depending on the original cluster roles. A
production recovery must use an isolated target first, verify the restored
schema and migration state, and receive explicit owner approval before any
route or runtime is changed.

## Owner recovery procedure

```bash
# Use an isolated database URL, never the live target.
pg_dump "$DATABASE_URL" --schema-only --file backups/pulserank-schema.sql
psql "$ISOLATED_DATABASE_URL" \
  --set ON_ERROR_STOP=1 \
  --single-transaction \
  --file backups/pulserank-schema.sql
psql "$ISOLATED_DATABASE_URL" -Atqc \
  "select to_regnamespace('pulse'), count(*) from pg_class where relnamespace = 'pulse'::regnamespace;"
```

Do not reverse migrations automatically, restore raw records into the trusted
pointer, restart the retired worker, or route the old government collector
during rollback. The safe rollback anchor is the immutable
`pulserank-checkpoint-1-safe` tag.
