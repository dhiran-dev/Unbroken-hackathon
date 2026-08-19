# UNBROKEN agent notes

## Bright Data collector

- Production collector ID: `c_msyjsllt1r9ej5tdub` (Bright Data-assigned stable identifier; do not rename)
- Target source: `https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod`
- Keep the Collector ID stable across `run`, `heal`, `approve`, and verification.
- Never use `--auto-approve` in the judged workflow.
- Save CLI envelopes under an incident artifact directory when the live integration is enabled.

## Safety contract

- Missing `equipment_status` is unknown extraction, never `in_service`.
- A layout drift must not emit a service event.
- A service event requires a valid contract and a stable structural fingerprint.
- Preview output must pass the same contract before approval.

## Git delivery

- Canonical remote: `https://github.com/dhiran-dev/Unbroken-hackathon.git`.
- Primary branch: `main`.
- Work locally, verify each completed checkpoint, create a local Git commit, and push it directly to `origin/main`.
- Do not create pull requests unless the owner explicitly changes this instruction.
- Never commit or push secrets, local plans, raw production payloads, or unsanitized incident artifacts.
- Do not force-push or rewrite published history unless the owner explicitly requests it.

## LLM review

- Provider: Fireworks AI.
- Model: `accounts/fireworks/models/deepseek-v4-flash-0731`.
- Use high reasoning effort and a strict structured-output contract.
- Do not silently fall back to another provider or model.
- The model is advisory only; deterministic gates and explicit human approval remain mandatory.

## Agent skills

### Issue tracker

Citywide specs and implementation tickets are tracked in committed local documentation. See `docs/agents/issue-tracker.md`.

### Domain docs

UNBROKEN uses one shared domain glossary and a single system-wide decision record. See `docs/agents/domain.md`.

### Citywide engineering

Read `docs/engineering/README.md` before changing citywide transit, journey, map, rider, quota, or notification behavior.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
