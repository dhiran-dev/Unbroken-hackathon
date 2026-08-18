# Healing safety

UNBROKEN treats scraper repair as an incident workflow, not an automatic code deployment. Invalid collection output is frozen before incident handling begins, so failure in detection, Bright Data, Fireworks, or the worker cannot publish uncertain elevator data.

## Safety invariants

- The production collector remains `c_msyjsllt1r9ej5tdub` through run, heal, approval, and verification.
- A missing equipment status is unknown extraction, never in service.
- Layout drift emits no elevator service event and requests no route recalculation.
- Bright Data healing must stop at its review gate.
- The healed preview passes the same schema, coverage, freshness, identity, and structural-fingerprint checks as production data.
- Fireworks is advisory. It cannot call the approval endpoint, save a collector, publish a snapshot, or update routing.
- Approval and rejection require an authenticated human, an exact typed phrase, an idempotency key, and an audit record.
- Production is trusted again only after a new live collection passes every deterministic gate.

## Workflow

```text
rejected collection
  -> incident detected
  -> human acknowledges
  -> Bright Data creates a draft repair
  -> deterministic preview validation
       -> invalid: reject draft and remain frozen
       -> valid: optional Fireworks advisory review
  -> human approves or rejects
       -> reject: production remains unchanged
       -> approve: save the reviewed repair
  -> live post-approval collection
       -> pass: incident verified
       -> fail: incident remains open
```

Healing, advisory review, approval, rejection, and verification are queue jobs. Mutating Bright Data jobs have one attempt so a network retry cannot repeat a human decision. Advisory review and verification may retry safely.

## Evidence

Private evidence is written below `INCIDENT_ARTIFACTS_DIR/<incident-id>/` with strict names, secret redaction, SHA-256 hashes, and file permissions. The database retains the incident timeline, hashes, model identity, recommendation, human actor, and state transitions. Full evidence files expire after 90 days; audit metadata remains.

The production worker should use a persistent private volume. Incident evidence and raw payloads are excluded from Git. Only synthetic, sanitized judge examples may be committed under `artifacts/examples/`.

## Official integration references

- [Bright Data Scraper Studio self-healing overview](https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/overview)
- [Trigger self-healing](https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/trigger-self-healing)
- [Self-healing progress and approval gate](https://docs.brightdata.com/api-reference/scraper-studio-api/ai-flow/self-healing-job-progress)
- [Bright Data official CLI](https://github.com/brightdata/cli)
- [Fireworks structured response formatting](https://docs.fireworks.ai/structured-responses/structured-response-formatting)
- [Fireworks chat completions API](https://docs.fireworks.ai/api-reference/post-chatcompletions)
