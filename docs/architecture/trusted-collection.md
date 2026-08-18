# Trusted collection pipeline

UNBROKEN collects the official SFMTA elevator table through the production Bright Data Scraper Studio collector every five minutes. Collection and publication are deliberately separate: receiving JSON does not make it trusted.

## Fixed integration

- Collector ID: `c_msyjsllt1r9ej5tdub`
- Source: `https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod`
- Trigger: `POST /dca/trigger`
- Result polling: `GET /dca/dataset?id={collection_id}`
- Schedule: one PostgreSQL-backed job per five-minute UTC bucket
- Raw evidence retention: 90 days; hashes and decision metadata remain after body expiry

Bright Data's trigger returns a collection ID. The dataset endpoint can return the collector record directly for this single-input collector, so the client accepts that documented record shape only when it contains the expected `elevators` array. It does not broadly coerce arbitrary objects.

Official references:

- [Scraper Studio API quickstart](https://docs.brightdata.com/datasets/scraper-studio/quickstart)
- [Job data endpoint](https://docs.brightdata.com/api-reference/scraper-studio-api/job-data)
- [List jobs endpoint](https://docs.brightdata.com/api-reference/scraper-studio-api/list-jobs)

## Trust decision

A collection is publishable only when all deterministic checks pass:

1. The outer payload and every elevator row satisfy the versioned Zod contract.
2. The source URL is exact and consistent.
3. The source-valid timestamp is consistent, parseable in San Francisco time, recent, and not implausibly in the future.
4. All 11 known stations appear exactly as expected.
5. The row count is plausible and equipment identities are unique.
6. Every station and equipment status uses an allowed value.
7. No critical value is missing or unknown.
8. Station-level accessibility is internally consistent.
9. The structural fingerprint matches the last trusted structure.

A missing `equipment_status` is extraction uncertainty, never `in_service`. Rejected data stores evidence and a report but writes no observations, service events, or route recalculation.

## Publication behavior

An accepted collection is saved atomically with:

- its raw payload hash and temporary raw body;
- normalized station and equipment observations;
- the source-valid, collected, and accepted timestamps;
- its validation report and structural fingerprint;
- a trusted snapshot.

The first valid snapshot establishes the baseline and creates no outage or recovery event. Later service events require a valid contract, stable structure, and a real status difference from the previous trusted snapshot. Only affected equipment can request a route recalculation.

If Bright Data or SFMTA is unavailable, the run is marked failed and the previous trusted snapshot remains authoritative.

## Scheduling and concurrency

The worker creates idempotent scheduled jobs for five-minute buckets, claims work with `FOR UPDATE SKIP LOCKED`, maintains a heartbeat, and applies bounded retry backoff. A PostgreSQL advisory lock prevents overlapping collections across workers and manual requests. Daily retention jobs remove expired raw bodies without deleting their hashes or audit metadata.

The owner-only Run now control creates an idempotent, audited job. It does not bypass the worker or validation gates.

## Operator evidence

The protected History page lists every run and trust decision. Each run can be inspected for coverage, source timing, duration, deterministic checks, raw hash, and retention expiry. The Operations page reports the latest trusted source time, queue depth, worker heartbeat, and component state.

Raw payload bodies, API tokens, and local incident artifacts are never exposed in the public product or committed to Git.

## Local commands

Run one collection synchronously:

```bash
bun run collect:run
```

Start the scheduler and queue worker:

```bash
bun run worker
```

Start the web app separately:

```bash
bun run dev
```

No local Docker installation is required.
