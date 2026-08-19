# Scraper healing runbook

Healing is a bounded Bright Data repair workflow for the existing production
collector. It is not an automatic deployment and it never changes the public
snapshot by itself.

## Before requesting a repair

1. Sign in as an owner/admin and inspect the rejected run and incident reason
   codes. Confirm the problem is extraction or layout drift, not an ordinary
   elevator outage.
2. Confirm the production collector remains
   `c_msyjsllt1r9ej5tdub` and the configured source is the exact SFMTA elevator
   page in `.env.example`.
3. In the incident page, describe the observed fields/rows (at least 20
   characters). Do not ask Bright Data to invent stations, elevators, status,
   or timestamps.

## Preview and review

1. Choose **Request safe healing**. The request is queued and the current
   collector is left unchanged.
2. Wait for a preview with an approval gate. Inspect the private preview
   artifact and the deterministic checks: contract, source identity, freshness,
   coverage, uniqueness, status values, station consistency, stable structural
   fingerprint, and identity diff.
3. If any check fails, reject the proposal and keep the incident frozen. Do not
   use a preview to populate the database.
4. If all checks pass, **Request Fireworks advisory review** is optional. The
   configured model returns strict JSON with a recommendation, confidence,
   risks, suspected inventions, missing identities, and required human checks.
   It cannot approve, save, publish, or recalculate routes.

## Human decision and verification

1. Read the deterministic report and the advisory report together. A model
   recommendation is evidence, not authorization.
2. For an approval, type `APPROVE HEALED COLLECTOR` and choose **Approve and
   save**. For a rejection, type `REJECT HEALED COLLECTOR` and choose **Reject
   proposal**. Both actions require an authenticated human, an idempotency key,
   and an audit record.
3. After approval, wait for **Run post-approval verification**. Treat the
   incident as unresolved if the new live collection is rejected, times out,
   changes the collector identity, or fails the structural fingerprint gate.
4. Confirm the public status is based on the newly trusted snapshot and the
   Operations page is healthy. If approval is ambiguous, stop and escalate;
   never repeat the mutation blindly.

Full raw evidence is private, redacted on write, hashed, permission-restricted,
and retained for a bounded period. Use only the synthetic files under
`artifacts/examples/` in a demo or issue.
