# A14 Handoff — Dual-mode Caffeine Informer collector (v2, production)

Agent: A14 (collector v2, human-driven build) · Date: 2026-08-21 · Mode: user drove
the Scraper Studio UI, orchestrator specified schemas/gates and verified outputs.

## Outcome

**New dual-mode collector built, schema-locked, saved, and live on production.**
**Status at pause: PDP mode VERIFIED · Discovery mode FAILING (fix specified, not yet applied).**

- **Collector ID: `c_mt33nlnkq376z132b`** (IDE automation template, draft promoted
  and saved via the "Update schema" flow)
- Studio URL: https://brightdata.com/cp/data_collector/collectors/c_mt33nlnkq376z132b
- Replaces the PDP-only collector `c_mt2yacvcyvyvim56d` (`caffeine-pdp`), which
  remains archived as fallback until the 100-product batch run validates v2.
- Supersedes two failed heal attempts on the old collector
  (`artifacts/scraper/heal-discovery*.json`, both `heal_trigger_failed`) — the
  AI healer could not add a second page-mode in place; a fresh build could.

## Output schema (13 fields, frozen for this collector)

| Field | Type | PDP row | Discovery row |
|---|---|---|---|
| product_name | text | h1 name | exact link text |
| brand | text | first word of name (naive) | — |
| beverage_type | text | site breadcrumb ("Caffeine in Drinks") | — |
| serving_size | text | `#serving-size` `data-mls` (e.g. "250 ml") | — |
| caffeine_mg_per_serving | number | mg per container | null |
| caffeine_mg_per_100ml | number | 2 decimals | null |
| caffeine_strength_level | text | LOW/MODERATE/HIGH/EXTREME | null |
| calories_kcal | number | optional | null |
| sugar_g | number | optional | null |
| caffeine_raw_text | text | verbatim printed amount ("80 mg") | null |
| image_url | url | `.db-img img` absolute URL | null |
| product_url | url | null | absolute `/caffeine-content/*` URL |
| category | text | null | label near link, if shown |

Mode dispatch: URL contains `/caffeine-content/` → one PDP row; listing/index
URL → one row per product link, never the index itself.

## How it was built (brief)

1. **Seed + spec**: AI-builder seeded on `/caffeine-content/sting`; the 954-char
   dual-mode brief went into "additional instructions" (both modes, field types,
   ground-truth examples, "omit rather than guess").
2. **First schema proposal declined**: it produced PDP-only fields (the same
   failure mode as both heal attempts — the builder latches onto the seed page
   type). Declined and re-prompted; second proposal carried all fields.
3. **Field additions negotiated in two steps**: base 7 (proven schema from
   `c_mt2yacvcyvyvim56d`, see `docs/handoffs/A2-collector.md`) + `product_url`,
   `category` (discovery), + `image_url` (evidence-only, per
   `ProductScrapeRowV1.media.imageUrl`), + `calories_kcal`, `sugar_g`,
   `caffeine_raw_text` (deterministic qualifier parsing downstream).
4. **Code refactor accepted**: extraction hardened to clone `.db-info-data`,
   strip nested divs, then read text — closing the digit-concatenation class of
   bug that produced `72250` in the old collector's first run.
5. **Schema-drift catch**: on save, Studio flagged the 3 new fields as
   "Output schema mismatch"; resolved with **Update schema** (declared schema
   synced to actual output — same contract-parity principle as our G3 freeze).
6. Saved → production.

## Verification results (real outputs)

### PDP gate — PASS

Input: `https://www.caffeineinformer.com/caffeine-content/28-energy-drink-black-white`

```json
{"product_name":"28 Black Energy Drink","brand":"28",
 "beverage_type":"Caffeine in Drinks","serving_size":"250 ml",
 "caffeine_mg_per_serving":80,"caffeine_mg_per_100ml":31.98,
 "caffeine_strength_level":"MODERATE","calories_kcal":125,"sugar_g":30,
 "caffeine_raw_text":"80 mg",
 "image_url":"https://www.caffeineinformer.com/wp-content/caffeine/28-energy-drink-black-white.jpg",
 "product_url":null,"category":null,
 "product_page_url":"https://www.caffeineinformer.com/caffeine-content/28-energy-drink-black-white"}
```

All values verified against page ground truth (80 mg / 31.98 / MODERATE /
125 kCal / 30 g / verbatim "80 mg" / exact image path). No unit-scaling bug.
Note: `serving_size` comes from the site's `data-mls` ("250 ml") while the page
prints "8.46 fl oz" — imperial-print archetype still uncaptured (post-G3
candidate: `serving_raw_text`).

### Discovery gate — FAIL (first attempt, 2026-08-21)

Input: `https://www.caffeineinformer.com/the-caffeine-database`

Actual output — exactly **one** row, and it is the index page extracted as if it
were a product (the exact anti-pattern mode B forbids):

```json
{"product_name":"Caffeine Content of Drinks","brand":"Caffeine",
 "beverage_type":"","serving_size":null,"caffeine_mg_per_serving":null,
 "caffeine_mg_per_100ml":null,"caffeine_strength_level":"","calories_kcal":null,
 "sugar_g":null,"caffeine_raw_text":null,"product_url":null,"category":null,
 "product_page_url":"https://www.caffeineinformer.com/the-caffeine-database"}
```

**Root cause (diagnosed, fix specified but NOT yet applied):** the database page
injects its drink table via JS after load ("Loading data…" in static HTML). The
static DOM contains zero `/caffeine-content/*` anchors at parse time, so mode B
had nothing to enumerate and the parser fell back to single-row PDP-style
extraction on the page itself. This is a timing/render problem, not a dual-mode
logic failure — PDP mode is unaffected.

**Fix prompt (written, to paste into the builder chat next session):**

```
Discovery mode failed on /the-caffeine-database: the drink table loads asynchronously after page load, so the run found zero /caffeine-content/ links and wrongly emitted the index page itself as a product row.

Fix the interaction flow for listing URLs (input does NOT contain /caffeine-content/):
1. After load, slowly scroll down the page and WAIT until anchors matching a[href*="/caffeine-content/"] exist (allow up to 30 seconds).
2. Only then collect every such anchor and emit ONE ROW PER LINK: product_name = exact anchor text, product_url = absolute href, category = nearest section heading when shown.
3. NEVER emit the listing/index page itself as a product row; leave caffeine/serving/calorie/image fields empty on link rows.

PDP behavior for URLs containing /caffeine-content/ stays exactly as-is.
```

Then re-run the same preview. Pass = 50+ rows, every row a real
`/caffeine-content/*` `product_url`, caffeine/serving/calorie/image fields null,
no self-row, `category` where shown.

**Plan B if the wait still yields zero rows** (table may come from an XHR the
runner won't trigger): keep ONE collector, change the discovery *seed* —
Caffeine Informer's static list pages (e.g. `most-caffeinated-energy-drinks`,
outlet-coffee charts) carry hundreds of `/caffeine-content/*` links in plain
HTML. Feed those to discovery, skip the database page; record the deviation for
G3. Do not loop retries blindly; do not force the 100-product batch through a
failing discovery gate.

## Known deviations (accepted, log for G3 review)

- `beverage_type` carries the site breadcrumb, not a normalized drink type —
  V1 contract has no `beverage_type`; normalization derives it.
- `brand` is a naive first-word split ("28" for 28 Black) — alias layer handles.
- Extra `product_page_url` echo field in output — harmless; contract layer drops
  unknown fields.
- One collector ID for both modes achieved (plan §8.1 satisfied) — no fallback
  second collector needed.

## Next steps (resume point — pick up here)

1. Paste the fix prompt above into the builder chat → approve regenerated
   schema/code → re-run the `/the-caffeine-database` preview.
2. Discovery passes → 100-product batch via `scraper run c_mt33nlnkq376z132b
   --input-file artifacts/scraper/discovery-input-100.txt` (URLs from A1's
   1,383-URL sitemap).
3. Archive run envelopes to `artifacts/scraper/`; update `state.yaml`
   (collector_id → `c_mt33nlnkq376z132b`) → G3 contract-freeze review.
4. Retire `c_mt2yacvcyvyvim56d` to fallback-only after batch validation.

## Where we paused

PDP mode verified and production-safe; discovery fix prompt written but not yet
sent to the builder. Nothing is broken beyond the documented discovery timing
issue; no batch has been run against v2.

## Guardrails compliance

- Legacy collector `c_msyjsllt1r9ej5tdub` / SFMTA: untouched.
- No auto-approve used; every schema/code gate accepted manually by the user.
- No fabricated artifacts; outputs above are real collector results verified
  against live page ground truth.
