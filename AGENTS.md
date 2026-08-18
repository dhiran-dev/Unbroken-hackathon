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
