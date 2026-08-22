---
version: 1
slug: "src-app-explore-page-tsx"
primary_target: "src/app/explore/page.tsx"
related_targets: ["src/components/pulserank/explore/explore-workspace.tsx", "src/app/explore/explore.module.css"]
---

# Explore Surface Brief

## Mode

Operate

## Visual Authority

- Approved composition: `approved_mockups/explore.png` (1672 × 941).
- Durable product truth: `PRODUCT.md`.
- Durable visual world: `DESIGN.md` and `.impeccable/design.json`.
- Home is deferred and must remain visually unchanged.

## Direction Contract

Explore is a caffeine observatory: a near-black working field with three stable zones—source-backed facets at left, an exact-value plot at center, and the currently inspected product at right. The central plot is the focal instrument, not a decorative hero. Dense controls remain quiet until selected; violet marks action and selection, while category color differentiates points without implying quality. The page uses compact Manrope headings, tabular Inter measurements, one-pixel blue hairlines, and tonal navy depth. Policy-authorized source product imagery supports recognition through a local edge-matte renderer; a deterministic procedural specimen varies by slug and category when imagery is missing, blocked, or fails to load. Motion is limited to plot-point entrance, inspector transition, and control feedback, and disappears under reduced motion. Mobile keeps the same task order: search, active filters, plot, results, then a dismissible bottom-sheet inspector. Missing, ranged, estimated, and conflicting values remain visible in result rows but never enter an exact-only plot. Exact product values do not carry a redundant `Exact` badge; exactness remains explicit where it changes filtering or plot eligibility. The surface should feel like a precise consumer research instrument—fast, legible, and candid about evidence.

## Production Contract

- THESIS: Explore is a caffeine observatory, not a generic card catalog.
- OWN-WORLD: Near-black fields, blue hairlines, violet action, category signals, and product imagery framed as observatory specimens.
- STORY: Filter trusted products, read exact normalized measurements, inspect qualifiers, then save or compare.
- FIRST VIEWPORT: Source-backed facets left, dominant exact-value plot center, evidence inspector right; search is the primary entry action.
- FORM: Three-zone operate workspace; form 1; seed `pulserank-explore-observatory-v1`.

## Composition Commitments

| Ingredient | Implementation medium | Commitment |
| --- | --- | --- |
| Persistent public header | Existing semantic header with Explore active | Keep current global shell to avoid changing deferred Home; route styling may refine only descendants of the Explore root. |
| Left facet rail | Semantic GET form, category radio-style links, numeric bounds, serving form, exact-only switch | Source-backed category counts; reset and apply remain explicit. |
| Command search | Client-enhanced search input backed by URL query parameters | `/` and Cmd/Ctrl+K focus it; submit updates the trusted server query. |
| Metric toggle | HTML buttons | Total caffeine and concentration change only the plot metric, never the underlying records. |
| Exact-value plot | Accessible inline SVG plus textual summary | X-axis always uses normalized milliliters; only exact present caffeine with positive normalized volume is plotted. Category color is repeated in a text legend scoped to categories present in the loaded exact points; focus, hover, and selection reveal the product name plus exact metric and normalized serving. |
| Product inspection | Desktop context panel / compact modal bottom sheet | Selection is reversible and can originate from a plot point or result card. In compact mode, the sheet is a labelled dialog with trapped focus, scroll lock, inert background regions, Escape/backdrop/close dismissal, and focus restoration to the initiating control. |
| Product artwork | Policy-authorized product image through a local renderer, with semantic HTML/CSS procedural fallback | Render only exact HTTPS `www.caffeineinformer.com` image URLs exposed by the trusted public DTO. Derive transparency only from light neutral pixels connected to the source-image edge, preserving disconnected white package labels and details. Fall back deterministically by slug and category when imagery is absent, blocked, or fails to transform; never add package claims or copied prose. Compact result imagery begins loading only near the viewport. The default inspector image and initial Explore data warm during deployment readiness, without making image availability a readiness requirement. |
| Results | 24 initial compact rows/cards plus cursor Load more | Show total result count, serving context, Save and Compare actions. Show uncertainty badges for ranged, approximate, estimated, conflicting, and unpublished values, but omit a redundant badge for exact values. Display `other` as `Other / unclassified`; display `legacy_broad` products as `Product type · Not classified`. |
| Primary action | Cursor-based Load more | Wide violet action only when another page exists; announce progress and errors. |

## Responsive Strategy

- At wide desktop, use a 240–260px facet rail, flexible plot, and 300–330px inspector.
- Below 1180px, an engaged inspector becomes a modal bottom sheet while facets remain beside the plot where space permits; opening it moves focus to Close, and dismissal returns focus to the plot point or result action that opened it.
- Below 820px, filters collapse into a disclosure above the plot; the inspector stays a fixed bottom sheet.
- At 390px, every control and plot point interaction has a 44px target and the page has no horizontal overflow.

## Plot Semantics

- Category hues distinguish product families only; they never encode caffeine amount, trust, rank, or quality.
- The legend names every category represented by the currently loaded exact points, so category meaning is never color-only.
- Every interactive point has an accessible product-and-measurement label. The visible focus/hover/selection label repeats the product name, exact plotted metric, unit, and normalized milliliters.
- In product results and the inspector, category is secondary metadata directly below the product name, never a heading eyebrow above it.
- Exactness stays explicit in the `Exact caffeine only` filter and exact-plot methodology because it changes behavior there; it is not repeated as an unexplained product or inspector tag.
- Classification provenance is labelled `Classification source` and translated for consumers as `Source category list`, `Source product page`, or `Legacy catalog` rather than exposing internal enum names.

## Intentional Mockup Adaptations

- Use owner-authorized, policy-checked product imagery instead of the mockup’s unverified package asset. Preserve procedural category art as the resilient fallback and omit lab-analysis claims and product-description prose.
- Use normalized milliliters on the plot instead of mixing source serving units.
- Keep ranges and uncertain states in the result list but exclude them from the exact plot.
- Add cursor pagination and total result count because the real catalog contains hundreds of products.
- Preserve the incumbent global header until Home establishes the future shared v2 shell.
