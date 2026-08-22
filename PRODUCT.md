<!-- impeccable:product-schema 1 -->

# PulseRank Product Context

## Platform

web

## Users

- People comparing caffeine products who need exact amounts, serving context, and explicit uncertainty before making a choice.
- Returning visitors who save products, build comparisons, and track personal entries locally in their browser.
- Judges and operators who need sanitized evidence that public data passed the ingestion and trust pipeline.

## Purpose

PulseRank turns source observations about caffeine products into a browsable, comparable catalog without hiding missing, ranged, estimated, or conflicting fields.

## Positioning

Consumer-first product intelligence with transparent provenance. PulseRank is not a health authority, a medical recommendation service, or a republisher of source prose.

## Operating Context

- The public experience is used on desktop and mobile web, often while searching for a specific product or comparing a small set of products.
- The catalog is cumulative: failed or missing collection pages never remove previously trusted products.
- Collection and publication are separate. Only immutable observations promoted through deterministic validation are public.
- Personal saves, compare selections, recents, and tracking data remain browser-local; accounts and cloud sync are out of scope.
- Home is intentionally deferred. Route-specific v2 work must not visibly redesign or constrain the current Home route.

## Capabilities

- Search and filter a trusted product catalog using source-backed categories and published field states.
- Browse product records through opaque cursor pagination with total counts and active facets.
- Plot only comparable exact values; preserve ranges, qualifiers, zeroes, conflicts, and unpublished fields outside the plot.
- Inspect product caffeine, serving, concentration eligibility, category provenance, observation time, and source attribution.
- Save eligible numeric snapshots and compare up to four products locally in the browser.
- View leaderboards, field-level changes, and sanitized collection-run status derived from immutable backend records.

## Constraints

- Public product data is attributed to Caffeine Informer at page level under its terms of use.
- Product images are public only after an explicit publication decision and an exact policy check for HTTPS assets on `www.caffeineinformer.com`; missing, blocked, or failed images use deterministic original product art.
- Copied source prose is not published. Imagery never replaces the nearby text needed to understand a product or its evidence.
- Raw collection payloads, credentials, provider collection IDs, and incident artifacts are private.
- A missing value is never displayed as zero. A range is never collapsed to a point. Conflicting caffeine is rank-ineligible.
- Unsupported categories are represented as `other`; categories are never inferred from product names.
- Government-targeting Bright Data collection, healing, verification, routing, and automatic approval remain disabled.
- The experience must work with keyboard navigation, visible focus, reduced motion, 44px touch targets, and no mobile page-level overflow.

## Brand Commitments

- Make the number understandable by keeping its serving, qualifier, field state, and source context nearby.
- Be candid about what the source did not publish and what PulseRank cannot compare.
- Keep consumer actions simple and local; do not imply an account, remote sync, or clinical guidance.
- Prefer evidence and traceability over promotional claims.

## Evidence and Data Truth

- Public products come only from the current trusted observation pointer and a trusted observation status.
- Public legacy product imagery comes from append-only media-publication records that link the exact raw evidence row to the current trusted observation without mutating either record. Newly validated observations may carry only policy-checked media.
- Product list responses expose schema version 1.1, `totalCount`, `activeFacets`, and an opaque `nextCursor`.
- Category provenance is published as `source_listing`, `source_pdp`, or `legacy_broad`.
- Concentration exists only when caffeine is an exact non-negative point and serving volume has a positive normalized milliliter value.
- Changes expose sanitized field-level before/after points; Live Data exposes sanitized stages and counts, not raw source bodies.

## Product Principles

1. Truth before density: every comparable value keeps the context needed to interpret it.
2. Uncertainty stays visible: sparse, ranged, estimated, unparseable, and conflicting states never masquerade as exact values.
3. Exploration should stay reversible: filters, selection, saved items, and compare actions should be clear and easy to undo.
4. Product imagery supports recognition but never carries the evidence alone; public surfaces remain useful when an image is missing and never rely on copied prose.
5. Browser-local means browser-local: explain persistence honestly and avoid account-like language.

## Accessibility

- Target WCAG 2.2 AA for public routes.
- Essential information must be available in text and must not rely on color, hover, animation, canvas, or imagery alone.
- Controls require programmatic labels, visible keyboard focus, logical tab order, and at least 44px target size.
- Motion must respect `prefers-reduced-motion`; reduced motion may remove transitions without removing information.
- Mobile layouts must not introduce page-level horizontal scrolling.
