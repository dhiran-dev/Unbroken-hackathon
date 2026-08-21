# Bright Data CLI — collector subcommand notes (verified)

Discovered empirically against `@brightdata/cli@0.3.2` on 2026-08-21 (agent A2).
All syntax below was taken from the CLI's own `--help` output; auth behavior was
verified with a live read-only API call (`budget` → authenticated 403 scope
response, i.e. token valid, endpoint not in token's permission scope).

## Invocation & auth

```bash
# CLI entrypoint (repo dependency @brightdata/cli@0.3.2, binary name: bdata)
node node_modules/@brightdata/cli/dist/index.js <command>
npx bdata <command>   # equivalent when installed

# Auth: the CLI reads BRIGHTDATA_API_KEY (NOT BRIGHTDATA_API_TOKEN).
# The repo's .env.local stores the token as BRIGHTDATA_API_TOKEN, so map it:
export BRIGHTDATA_API_KEY="$BRIGHTDATA_API_TOKEN"
```

Verified: with the token exported, the CLI performs real authenticated API
calls. `src/server/services/bright-data-healing.ts` uses the same mapping
(`BRIGHTDATA_API_KEY: env.BRIGHTDATA_API_TOKEN` in the child-process env).

Never print, log, or commit the token. Never pass it via `-k` on a command line
visible in process listings or shell history.

## `scraper` command group (Scraper Studio collectors)

```
brightdata scraper create  <url> <description>   # AI-build a new collector
brightdata scraper run     <collector_id> [url]  # trigger a collection run
brightdata scraper heal    <collector_id> <prompt>  # AI self-heal in place
brightdata scraper approve <collector_id>        # approve/reject a pending heal
```

### `scraper create` — build a collector (non-interactive, AI-driven)

```bash
node node_modules/@brightdata/cli/dist/index.js scraper create <url> "<description>" \
  --name <template-name> \
  --pretty -o create.json
```

- `url` — target page to model the collector on.
- `description` — natural-language extraction spec, max 500 chars.
- `--name <name>` — template name (default `cli-scraper-<timestamp>`).
- `--deliver-webhook <url>` — delivery webhook (default is a stub).
- `--timeout <seconds>` — polling timeout, default 600.
- `--max-retries <n>` — retries on AI-Flow 429 concurrent-job cap (default 4).
- AI generation takes **5–10 minutes**; the command polls and returns an
  envelope `{collector_id, name, status, ...}` (use `--legacy-output` for the
  pre-v0.3 bare payload).

Note: there is **no direct structured-input flag** (e.g. `{url, mode: pdp,
max_products: 1}`) on `create` — the natural-language description is the only
way to steer extraction. Structured inputs apply at **run** time (below).

### `scraper run` — trigger a collection

```bash
# single URL, async (polls until done; default timeout 600s)
... scraper run <collector_id> https://example.com/page --pretty -o run.json

# multiple URLs as one batch (routes via /dca/trigger)
... scraper run <collector_id> --urls "https://a.example,https://b.example"

# input file: one URL per line (# comments ok), OR JSON array of strings,
# OR JSON array of {"url": "..."} objects
... scraper run <collector_id> --input-file urls.txt

# synchronous mode (server-side 25–50s cap; single-URL only, small pages)
... scraper run <collector_id> <url> --sync --sync-timeout 50

# options: --name <job-name>  --version <e.g. "dev">  --timeout <seconds>
# output: -o <path> (extension picks format), --json, --pretty
```

### `scraper heal` — AI self-healing (approval-gated)

```bash
... scraper heal <collector_id> "<what is broken, max 1000 chars>" \
  --url <verify-url> --timeout 600 --json -o heal.json
```

- Stops at an approval gate by default (`awaiting_approval`) — **auto-approve
  is OFF unless `--auto-approve` is passed. Project policy: keep it OFF.**
- `--auto-save` (only meaningful with `--auto-approve`) also saves the healed
  template automatically. Do not use without explicit human approval.

### `scraper approve` — resolve a pending heal

```bash
... scraper approve <collector_id> --url <verify-url>        # approve
... scraper approve <collector_id> --reject                  # reject the fix
# --auto-save: save template automatically after a successful approve
```

## Related commands

- `status <job-id>` — check an async Web Scraper snapshot job.
- `pipelines <type|list> [params...]` — fixed dataset pipelines
  (`--format json|csv|ndjson|jsonl`, `--timeout <s>`, `-o <path>`).
  `brightdata pipelines list` enumerates available types.
- `zones`, `budget`, `config`, `browser` — account/session utilities
  (token may lack permission scope for some; `budget` returned an
  authenticated 403 on this token).

## Observed envelope shapes (live, 2026-08-21)

- `create` → `{"collector_id","name","status":"done","completed_steps":[],"view_url","created_at"}`
- `run` → JSON **array** of records; each record carries the extracted fields
  plus an `input` echo: `{"<field>": ..., "input": {"url": "..."}}`
- `heal` → `{"collector_id","status":"awaiting_approval","completed_steps":[],
  "prompt","view_url","next_step","preview_result":[],"diff_summary"}`
- `approve` → `{"collector_id","status":"done","completed_steps":[...,
  "user_approval","save_new_template"],"next_step", ...}`

Live lifecycle exercised on collector `c_mt2yacvcyvyvim56d`: create → run →
heal (unit bug: mg/serving returned ~1000×; heal prompt cited wrong value +
expected value + page ground truth, fixed first try) → approve --auto-save →
verify run correct. See `docs/handoffs/A2-collector.md`.

## Project guardrails (from AGENTS.md — binding)

- **Never invoke or reuse legacy collector `c_msyjsllt1r9ej5tdub`** or its
  SFMTA source URL; it is quarantined audit identity only.
- Keep `--auto-approve` disabled for demo runs.
- Government-targeting Bright Data jobs stay disabled.
- Archive only real CLI envelopes; never fabricate JSON artifacts.
