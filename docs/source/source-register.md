# Source register

| Field | Value |
|---|---|
| Source id | `caffeine-informer` |
| Name | Caffeine Informer |
| Base URL | https://www.caffeineinformer.com/ |
| Owner | Caffeine Informer (independent caffeine-reference publication) |
| Access date | 2026-08-21 |
| Access method | Plain HTTPS GET via curl (desktop Chrome User-Agent). No login, no paywall, no JS requirement: all audited data is in the initial HTML response. |
| Robots | `robots.txt` allows crawling; publishes `Sitemap: https://www.caffeineinformer.com/caffeine-content-sitemap` (1,383 product URLs). |
| Rate limiting observed | None during this audit (30 pages fetched at ~8 concurrent requests without 429/403). Keep concurrency modest and cache page HTML. |
| Page inventory | `/caffeine-content/<slug>` product pages (db-card template), `/the-caffeine-database` index, chart/list pages (e.g. `/sugar-free-energy-drink-chart`). |
| Data of interest | Caffeine mg per serving (with fl oz / ml toggle data attributes), strength badge, Calories kCal, Sugar grams, ingredients, flavour lists (with struck-through discontinued items), manufacturer references block. |
| Data quality flags | Caffeine values may be ranges ("115-175 mg"), approximations ("approximately 12 mg per 100 ml"), or the literal string "Unknown" (heat-esp). Calories/Sugar cards are optional. Some records are legacy/discontinued. |
| Attribution requirements | Site terms: https://www.caffeineinformer.com/terms-of-use. Content is copyrighted; cite the specific page URL and Caffeine Informer as the source for any derived data. The site participates in the Amazon Associates program (product links are affiliate links) - do not treat "Where to buy" links as neutral data. No explicit bulk-reuse licence is granted; treat extracted values as cited facts, not republishable content. |
| Prohibited/none | No authenticated areas; nothing behind robots disallow except `/wp-admin/`. |
| Contact | https://www.caffeineinformer.com/contact |

## Reference snapshot (from fetched pages)

Each product page carries a `div.references` block naming its own upstream source (manufacturer site, can label,
email from manufacturer, or peer-reviewed study). Examples captured 2026-08-21:

- monster: "Monster website ... Caffeine amounts received from Technical Director of Monster Beverage Company"
- zombie-blood-energy-potion: "caffeine content provided by Harcos rep"
- monster-absolutely-zero-energy-drink: "Email from Monster Energy and the can"
- coffee-brewed / green-tea / herbal-tea / matcha: peer-reviewed journal citations
