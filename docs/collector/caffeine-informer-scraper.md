# PulseRank Caffeine Informer scraper

## Purpose

This document records the Caffeine Informer scraper setup used for PulseRank.
The scraper collects caffeine and related product facts from
`caffeineinformer.com`. It does not scrape the legacy government source used by
the original UNBROKEN collector.

The collector is a Bright Data Scraper Studio IDE-automation collector:

- Collector: `c_mt33nlnkq376z132b`
- Source: `https://www.caffeineinformer.com`
- Main discovery URL: `https://www.caffeineinformer.com/the-caffeine-database`
- Modes: listing/discovery and product-detail-page (PDP)
- Full parser reference: `../handoffs/A14-v2-parser-code.md`
- Session handoff: `../handoffs/A14-collector-v2-dual-mode.md`

## What can be scraped

For each Caffeine Informer product page, the collector can return:

- product name and a simple brand value;
- the site's beverage/category breadcrumb;
- serving size in millilitres when the page publishes it;
- caffeine per serving and caffeine per 100 ml;
- the site's caffeine-strength label;
- calories and sugar when those cards exist;
- the printed caffeine text as evidence;
- the product image URL; and
- the canonical Caffeine Informer product-page URL.

The collector preserves missing or unpublished values as `null` where the
output schema includes the field. It does not invent a caffeine value, serving
size, calorie value, sugar value, category, or image.

## Scraping flow

The collector uses two stages in one collector ID.

1. The first stage navigates to the input URL and checks whether the URL is a
   listing page (`/the-caffeine-database`) or a PDP (`/caffeine-content/`).
2. For the database listing, it scrolls to the bottom and waits up to 30
   seconds for dynamically rendered anchors matching
   `a[href*="/caffeine-content/"]`.
3. The first-stage parser extracts every matching anchor, converts relative
   links to absolute URLs, and sends each URL to the next stage with
   `next_stage({url})`. The index page itself is not intended to become a
   product record.
4. The second stage navigates to each product URL, waits for the product cards,
   and runs `collect(parse())`.
5. The PDP parser reads the fields from the rendered product page and returns
   one terminal product record per PDP.

The important caffeine parsing detail is that `.db-info-data` contains both the
caffeine amount and nested serving-size text. The parser clones the element,
removes child elements, reads the first direct numeric value, and reads the
adjacent unit separately. This prevents values such as `80` and `8.46` from
being concatenated into an incorrect number such as `80846`.

Relevant selectors and parsing rules:

| Data | Source on the PDP |
| --- | --- |
| `product_name` | `h1` text |
| `brand` | First token of `product_name` |
| `beverage_type` | `.post-item-cat a` text |
| `serving_size` | `#serving-size` `data-mls` attribute |
| `caffeine_mg_per_serving` | First direct number in the first `.db-info-data` |
| `caffeine_raw_text` | Direct caffeine number plus its adjacent unit |
| `caffeine_mg_per_100ml` | Text matching `mg for every 100 ml` in `.main p` |
| `caffeine_strength_level` | `.db-strength-header` text |
| `calories_kcal` | `.db-card` whose `.db-title` is `Calories` |
| `sugar_g` | `.db-card` whose `.db-title` is `Sugar` |
| `image_url` | `.db-img img` `src`, made absolute |
| `product_page_url` | Current page URL |

## Terminal output structure

The terminal PDP record has the following structure. Bright Data may also add
an `input` object containing the original input URL in a run export.

| Field | Type | Meaning |
| --- | --- | --- |
| `product_name` | string | Product title from the PDP `h1` |
| `brand` | string or `null` | First word of the product title; a deliberately simple extraction |
| `beverage_type` | string or `null` | Site breadcrumb, commonly `Caffeine in Drinks` |
| `serving_size` | string or `null` | Published serving volume, for example `250 ml` |
| `caffeine_mg_per_serving` | number or `null` | Caffeine milligrams for the published serving |
| `caffeine_mg_per_100ml` | number or `null` | Concentration published by the site |
| `caffeine_strength_level` | string or `null` | Site label such as `LOW`, `MODERATE`, `HIGH`, or `EXTREME` |
| `calories_kcal` | number or `null` | Calories card value when published |
| `sugar_g` | number or `null` | Sugar card value when published |
| `caffeine_raw_text` | string or `null` | Caffeine amount and unit as printed, for example `80 mg` |
| `image_url` | absolute URL or `null` | Product image URL |
| `product_url` | URL or `null` | Reserved for link-only discovery rows; terminal PDP rows set it to `null` |
| `category` | string or `null` | Reserved for discovery metadata; terminal PDP rows normally set it to `null` |
| `product_page_url` | absolute URL | PDP URL that was actually parsed |

The current architecture deliberately emits full PDP rows after discovery.
Therefore the batch JSON has `product_page_url` populated and `product_url`
and `category` empty on successful product rows. The discovery links are an
intermediate stage, not separate terminal output rows.

## Verified example

The following is the verified PDP output for the 28 Black example used during
setup:

```json
{
  "product_name": "28 Black Energy Drink",
  "brand": "28",
  "beverage_type": "Caffeine in Drinks",
  "serving_size": "250 ml",
  "caffeine_mg_per_serving": 80,
  "caffeine_mg_per_100ml": 31.98,
  "caffeine_strength_level": "MODERATE",
  "calories_kcal": 125,
  "sugar_g": 30,
  "caffeine_raw_text": "80 mg",
  "image_url": "https://www.caffeineinformer.com/wp-content/caffeine/28-energy-drink-black-white.jpg",
  "product_url": null,
  "category": null,
  "product_page_url": "https://www.caffeineinformer.com/caffeine-content/28-energy-drink-black-white"
}
```

This confirms the important numeric behavior: `80 mg` is retained as `80`,
`31.98` is retained as the per-100-ml value, and the nested `8.46 fl oz`
serving text is not accidentally appended to the caffeine number.

## Reference run JSON

The development batch export supplied with this work is
`j_mt3hsa9h1efxsm7bc5.json` in the local workspace. It is a raw run artifact
and should remain uncommitted.

Observed properties of that export:

- 663 JSON array entries were downloaded;
- 661 entries were successful product records with a real
  `/caffeine-content/` `product_page_url`;
- 2 entries were error objects for dead-page navigations and are not products;
- successful rows were sourced from the database input URL and then resolved
  to individual PDP URLs; and
- the Bright Data run screen reported 661 records, 664 pages, 2 failed crawls,
  and a 99.70% success rate.

A representative successful row from that export is:

```json
{
  "product_name": "EBOOST Super Fuel",
  "brand": "EBOOST",
  "beverage_type": "Caffeine in Drinks",
  "serving_size": "354 ml",
  "caffeine_mg_per_serving": 110,
  "caffeine_mg_per_100ml": 31,
  "caffeine_strength_level": "HIGH",
  "image_url": "https://www.caffeineinformer.com/wp-content/caffeine/eboost-super-fuel.jpg",
  "product_page_url": "https://www.caffeineinformer.com/caffeine-content/eboost-super-fuel",
  "input": {
    "url": "https://www.caffeineinformer.com/the-caffeine-database"
  }
}
```

The batch export reflects the fields present in that run's output schema. The
later verified PDP preview also includes `calories_kcal`, `sugar_g`, and
`caffeine_raw_text` when those fields are enabled in the saved parser schema.

## Known limitations

- `brand` is a first-word heuristic, so names such as `28 Black Energy Drink`
  produce `28` rather than a full brand normalization.
- `serving_size` uses the site's `data-mls` value. The separate imperial text
  shown on some pages, such as `8.46 fl oz`, is not currently returned.
- `beverage_type` is the site's breadcrumb, not a normalized product taxonomy.
- Optional cards may be absent or unpublished on individual PDPs.
- Two pages in the reference batch returned dead-page errors. They are recorded
  as failed crawls rather than fabricated product rows.
- The collector was validated in Development before the operator's production
  save. After production save, rerun a single known PDP and check that the
  production template returns the same 28 Black values above.

## Related implementation documents

- [A14 dual-mode handoff](../handoffs/A14-collector-v2-dual-mode.md)
- [Copy-ready parser code](../handoffs/A14-v2-parser-code.md)
- [Master implementation plan](../plans/pulserank-master-implementation-plan.md)
- [Archived 48-hour plan](../plans/archive/pulserank-48h-two-checkpoint-implementation-plan.md)
