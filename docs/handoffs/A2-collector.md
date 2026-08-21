# A2 Handoff — Bright Data Scraper Studio collector bootstrap

Agent: A2 (collector bootstrap) · Branch: `agent/collector` (worktree
`.worktrees/collector`) · Date: 2026-08-21

## Outcome

**New collector created, healed once, and verified end-to-end.**

- **Collector ID: `c_mt2yacvcyvyvim56d`** (template name `caffeine-pdp`)
- Dashboard: https://brightdata.com/cp/scrapers/c_mt2yacvcyvyvim56d
- Target: `https://www.caffeineinformer.com/caffeine-content/*` product pages
  (modeled on `/caffeine-content/sting`)
- Status: `done`, healed template **approved and saved** (steps
  `user_approval`, `save_new_template` completed)

Not blocked: the CLI supports fully non-interactive collector creation, so the
manual-dashboard path (`docs/collector/create-collector-manual.md`) was **not**
needed.

## CLI syntax verified (live)

Full reference: `docs/collector/cli-notes.md`. Auth quirk worth remembering:
the CLI reads **`BRIGHTDATA_API_KEY`**; the repo's `.env.local` stores the
token as `BRIGHTDATA_API_TOKEN` and must be mapped at load time (the healing
service already does this). Token never printed or committed.

```bash
node node_modules/@brightdata/cli/dist/index.js scraper create  <url> "<desc ≤500 chars>" --name <n> -o create.json   # 5–10 min AI build
node node_modules/@brightdata/cli/dist/index.js scraper run     <id> <url> --pretty -o run.json                       # async, polls
node node_modules/@brightdata/cli/dist/index.js scraper heal    <id> "<what's broken>" --url <verify-url> -o heal.json # stops at approval gate
node node_modules/@brightdata/cli/dist/index.js scraper approve <id> --auto-save --url <verify-url> -o approve.json    # resolve the gate
```

`--auto-approve` was never used; the heal stopped at `awaiting_approval` and
was resolved with an explicit `scraper approve` (same flow as
`src/server/services/bright-data-healing.ts`).

## Observed envelope shapes (real output)

- `create` → `{collector_id, name, status, completed_steps[], view_url, created_at}`
- `run` → **JSON array of records**, each record = extracted fields + an
  `input` echo: `{..., "input": {"url": "..."}}`
- `heal` → `{collector_id, status: "awaiting_approval", completed_steps[],
  prompt, view_url, next_step, preview_result[], diff_summary}`
- `approve` → `{collector_id, status: "done", completed_steps[], next_step, ...}`

Extraction schema produced by the AI (matches the PDP intent):
`product_name, brand, beverage_type, serving_size, caffeine_mg_per_serving,
caffeine_mg_per_100ml, caffeine_strength_level`.

## Heal incident (found & fixed — relevant for the healing service)

First standard run returned `caffeine_mg_per_serving: 72250` for the 250 ml
Sting page (~1000× wrong; mg/100ml field was correct at 28.79). A unit-conversion
bug in the AI-generated template. One `scraper heal` with a precise prompt fixed
it; post-heal verify run returns `caffeine_mg_per_serving: 72`. Lesson for
healing prompts: state the observed wrong value, the expected value, and the
page's ground truth explicitly — the fix landed on the first attempt.

## Artifacts (all real CLI output, in `artifacts/scraper/`)

| File | Content |
|---|---|
| `create.json` | create envelope, collector `c_mt2yacvcyvyvim56d` |
| `run-standard.json` | pre-heal run (shows the 72250 bug) |
| `heal.json` | heal envelope, `awaiting_approval` + fixed preview |
| `approve.json` | approve envelope, template saved |
| `run-standard-post-heal.json` | verify run, correct values |

Cost: 2 AI generations (create + heal), 2 collection runs (pre/post heal),
1 approve — within the ≤5-run budget.

## Guardrails compliance

- Legacy collector `c_msyjsllt1r9ej5tdub` and any SFMTA URL: never touched.
- `--auto-approve`: never used.
- No fabricated artifacts; every JSON above is a real CLI envelope.
- Token: loaded at runtime from `.env.local`, never printed/committed.

## Suggested next steps

1. Wire `scraper run` + `--input-file` (supports `{"url": ...}` arrays) into
   the collection service for batch `/caffeine-content/*` runs.
2. Add a contract check on run output: `caffeine_mg_per_serving` must be
   within a sane range of `caffeine_mg_per_100ml × serving_size` (this exact
   class of unit bug already occurred once).
3. Batch-run a handful of additional PDPs (`monster-energy`, `red-bull`,
   `coca-cola`) to validate schema stability across pages before scaling.
