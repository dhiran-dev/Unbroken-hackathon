# Publication policy - caffeine-informer source

Status: **audit_only** (default for this source).

## Data

- All values extracted from caffeineinformer.com are **audit_only**: they may be fetched, diffed, and used to
  build/validate internal contracts, but must not be published in user-facing or public demo output without
  explicit owner approval.
- Every published figure must carry a page-level citation (URL + access date) back to the specific
  `/caffeine-content/<slug>` page.

## Images

- **Images from this source are `audit_only` by default.** PulseRank has an explicit owner-approved exception
  for product image URLs that pass the `caffeine-informer-product-image-v1` boundary: the URL must use HTTPS
  and the exact host `www.caffeineinformer.com`. Root-domain, subdomain, non-HTTPS, malformed, and missing URLs
  remain blocked or audit-only and are not reflected into public responses.
- Legacy image authorization is recorded in append-only `pulse.product_media_publications` rows that link one
  exact raw record to the current trusted observation. This publication record does not modify the raw landing
  row or the immutable trusted observation. Future validated observations may expose media only after the same
  policy check during mapping and normalization.
- Explore serves an authorized image through a local, slug-addressed renderer. The renderer repeats the exact
  URL policy check before fetching, validates every redirect destination before following it, accepts only
  supported raster media, and returns a transparent WebP. Its response does not disclose credentials, raw
  records, or the upstream URL used for that render. See
  [Product image edge matting](product-image-edge-matting.md) for the algorithm, limits, cache behavior, and
  verification steps.
- The transparency matte removes only light, neutral pixels connected to the source image edge. Disconnected
  white package labels, typography, and product details remain opaque; this is a presentation derivative, not
  a modification of the immutable source observation or its media-publication authorization.
- The public interface uses deterministic procedural artwork when a product has no allowed image or the allowed
  image cannot be fetched or transformed. Product understanding and evidence must remain available in text
  without the image.

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
  preservation, and (4) removal of copied source prose. Source media stays non-public unless it has its own
  explicit approval and exact allowlist authorization record as described above.
