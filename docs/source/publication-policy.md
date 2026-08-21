# Publication policy - caffeine-informer source

Status: **audit_only** (default for this source).

## Data

- All values extracted from caffeineinformer.com are **audit_only**: they may be fetched, diffed, and used to
  build/validate internal contracts, but must not be published in user-facing or public demo output without
  explicit owner approval.
- Every published figure must carry a page-level citation (URL + access date) back to the specific
  `/caffeine-content/<slug>` page.

## Images

- **Images from this source are `audit_only` by default.** Product photos and site artwork are copyrighted by
  Caffeine Informer and/or the brands depicted. Do not hotlink, copy into public assets, or render them in
  demos. Store fetched images only in quarantined/ignored audit storage, referenced by hash for drift checks.

## Text

- Short factual data points (a caffeine mg value, a serving size) may be quoted with attribution.
- Do not republish page prose, ingredient paragraphs, reviews, or flavour-list commentary verbatim.

## Affiliate links

- "Where to buy" links on the source are Amazon-affiliate links. Strip them during extraction; never surface
  them as data.

## Provenance requirements

- Any derived dataset must record: source id `caffeine-informer`, page URL, fetch timestamp, and HTTP status.
- Values flagged in page-shape-matrix.md as ranges/approximations/Unknown must keep that qualifier; never
  silently coerce "Unknown" or a range to a point value.

## Promotion path

- audit_only -> approved_public requires: (1) explicit human approval, (2) per-record citation, (3) qualifier
  preservation, (4) removal of all source images.
