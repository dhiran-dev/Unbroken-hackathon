# A1 handoff - Caffeine Informer source audit

Date: 2026-08-21
Branch: agent/source-audit
Deliverables: docs/source/golden-urls.json, docs/source/page-shape-matrix.md,
docs/source/source-register.md, docs/source/publication-policy.md

## Summary

- Built a golden corpus of **30 verified URLs** (task asked for 25-30) from caffeineinformer.com.
  Discovery: `/robots.txt` -> `caffeine-content-sitemap` (1,383 URLs) + the caffeine database index page.
  Verification: every URL returned **HTTP 200** to `curl -s -o /dev/null -w '%{http_code}'` on 2026-08-21
  (per-URL status checks logged during the audit; scratch fetch workspace removed after the run).
- Fetched the HTML of all 30 pages and filled page-shape-matrix.md strictly from that HTML. No cell is
  invented; where a template card does not exist the matrix says ABSENT.
- **All 15 sought archetypes were found.** None required the NOT_FOUND path.

## Archetype -> evidence map

| Archetype | Covered by (slug) |
|---|---|
| standard volume drink | sting |
| metric serving | sting (250 ml default), lucozade (380 ml), irn-bru-32 (330 ml) |
| imperial serving | red-bull, coffee-brewed, monster, arizona-iced-tea (fl oz defaults) |
| explicit 0 mg caffeine | herbal-tea (card reads "0 mg") |
| explicit 0 g sugar | red-bull-total-zero, sugar-free-red-bull, monster-absolutely-zero, rockstar-sugar-free, bang, 5-hour-energy, zipfizz |
| missing calories | viter-mints, foosh-energy-mints, bawls-mints, hero-energy-mints, black-black-gum, crystal-light-energy-candy (no Calories card) |
| missing sugar | same six pages (no Sugar card) |
| per-mint / per-candy | viter-mints, foosh, bawls-mints, hero-mints (per mint); black-black-gum, crystal-light (per piece) |
| range caffeine | coffee-brewed (115-175 mg drip), green-tea (11-25 mg), matcha (18.9-44.4 mg/g), arizona (25-50 mg table row + manufacturer quote) |
| estimated / approximate | lucozade ("approximately 12mg of caffeine per 100ml") |
| multi-size variant | red-bull (250 ml + 355 ml), monster (16 + 24 fl oz), bawls (10 oz + 16 oz), red-bull-editions, sting (250/320 ml) |
| regional variant | lucozade + irn-bru (UK), sting (Asia), monster (UK/AU/NZ 500 ml note), red-bull-editions (availability "vary by region and market") |
| flavour list | bang (22+), lucozade, viter-mints, bawls, red-bull-editions |
| struck-through flavour | red-bull-editions (14 `<strike>` items), bawls (`<s>Exxtra ... discontinued in 2015</s>`) |
| sparse legacy record | heat-esp-herbal-energy-drink ("Unknown mg", discontinued flag), zombie-blood-energy-potion (novelty Harcos product, rep-provided figure) |

## Archetypes not found

None. Every archetype in the task list was located and verified against live pages. Two bonus shapes were
recorded beyond the brief: `unknown-caffeine` (literal "Unknown mg" card) and `missing-data-conflict`
(0 kCal card vs 6 g sugar sentence on the same page, heat-esp).

## Template findings (for downstream contract work)

1. One template family (`db-card` product detail) serves all /caffeine-content/ pages; Calories and Sugar
   cards are optional and must be treated as nullable in any extraction contract.
2. Serving text is duplicated in `#serving-size` data attributes (`data-floz`, `data-mls`) with an
   fl oz/mls toggle; default unit varies per page (sting/lucozade/irn-bru default to mls).
3. Caffeine value must be parsed as: number | range | approximate | "Unknown" - never assumed numeric.
4. Discontinued flavours appear as `<s>`/`<strike>` list items - a machine-readable discontinuation signal.
5. Strength badges: LOW / MODERATE / HIGH / EXTREME / DANGEROUS (+ CAFFEINE FREE in site JS for 0 mg).
6. Every page ends with a `div.references` block naming the upstream source (manufacturer site/can/email or
   journal study) - use it as the provenance field.

## Issues encountered

- None blocking. All 30 fetches returned 200 with full HTML (no JS-only content, no bot challenge).
- Note: page prose contains affiliate "Where to buy" links (Amazon tag) - excluded from data per
  publication-policy.md.
