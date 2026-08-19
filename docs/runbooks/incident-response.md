# Incident response runbook

This runbook is for an authenticated owner or admin when a collection is
rejected, the public status is held/stale, or an incident appears in the
private Operations and Incidents pages.

## Guardrails

Treat the last trusted snapshot as the only publishable state. Do not edit
production tables, paste raw source payloads into tickets, or approve a repair
because a model recommended it. A missing status remains unknown, and a layout
change must not create a service event.

## Triage

1. Open `/admin/operations` and record the component state, worker heartbeat,
   queue depth, latest trusted source time, and freshness message.
2. Open `/admin/history` and inspect the newest run. Note its classification,
   failed checks, source timing, row/station counts, and structural fingerprint.
3. Open `/admin/incidents/<incident-id>` and confirm the incident state and
   evidence timeline. Keep full artifacts under the private
   `INCIDENT_ARTIFACTS_DIR`; share only redacted summaries.
4. If the worker is not heartbeating, check the worker service and database
   connectivity before requesting a scraper repair. Restarting the worker does
   not make a rejected collection trusted.

## Recovery decision

- **Transient source or network failure:** leave publication frozen, allow the
  bounded worker retry, and wait for a fresh deterministic collection.
- **Contract or layout drift:** acknowledge the incident and follow the
  [healing runbook](healing.md). The current collector remains unchanged until
  a valid preview and an explicit human decision.
- **Application or deployment failure:** follow the
  [deployment runbook](deployment.md), then run a fresh collection and verify
  public freshness. Do not repair data by hand.

## Close-out

An incident is not recovered when a draft exists. Confirm that a new live
collection passes the contract and stable-fingerprint checks, that the
post-approval verification job succeeds, and that the Operations page shows a
healthy worker and current source. Record the incident ID, decision, evidence
hashes, and verification time in the owner’s normal change log. Never commit
the private artifact directory.
