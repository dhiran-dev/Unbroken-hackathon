---
name: PulseRank
description: A dark product-studio for exploring trusted caffeine data.
colors:
  void: "#050711"
  canvas: "#080d18"
  surface: "#0d1424"
  surface-raised: "#121b2e"
  primary-violet: "#8b5cf6"
  primary-deep: "#6d28d9"
  lavender: "#c4b5fd"
  cyan: "#22d3ee"
  success: "#34d399"
  warning: "#fbbf24"
  danger: "#fb7185"
  text: "#f8fafc"
  text-muted: "#a7b0c3"
  text-subtle: "#74809a"
  border: "#202a41"
  primary-action: "#7c3aed"
typography:
  display:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "clamp(2.75rem, 6vw, 5.75rem)"
    fontWeight: 700
    lineHeight: 0.98
    letterSpacing: "-0.055em"
  headline:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "clamp(2rem, 3.8vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.08
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.08em"
    fontFeature: "'tnum' 1"
rounded:
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "32px"
  hero: "48px"
  display: "64px"
components:
  button-primary:
    backgroundColor: "{colors.primary-violet}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-primary-hover:
    backgroundColor: "{colors.primary-deep}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    padding: "12px 20px"
  button-quiet:
    backgroundColor: "{colors.surface-raised}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.sm}"
    padding: "12px 16px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "24px"
  state-present:
    backgroundColor: "{colors.success}"
    textColor: "{colors.void}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
  state-uncertain:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.void}"
    rounded: "{rounded.pill}"
    padding: "4px 8px"
---

# Design System: PulseRank

## Overview

**Creative North Star: "The Caffeine Observatory"**

PulseRank is a calm, high-contrast instrument panel for a noisy product category. The approved mockups treat caffeine data like a signal: a near-black observatory canvas, precise violet illumination, and compact information surfaces that let the numbers do the persuading. It should feel premium and kinetic without becoming a gaming dashboard.

The world is dark, layered, and analytical. Purple is the identity accent and the action color; category and trust states add small, semantic flashes of cyan, green, amber, and rose. Product imagery is never required for comprehension: when published media is unavailable or audit-only, generic category art and a clearly labelled field state are the intended experience.

**Key Characteristics:**

- Deep navy-black canvas with violet signal accents.
- Dense but breathable data panels with a clear scan path.
- Real values and explicit field states; no visual treatment may hide uncertainty.
- HTML-first interactions with a responsive top navigation and mobile drawer.

## Colors

The palette is an observatory at night: near-black blue surfaces carry white data, while violet marks selection, action, and PulseRank identity.

### Primary

- **Electric Violet** ({colors.primary-violet}): Active navigation, selected controls, links, signal lines, and PulseRank identity.
- **Accessible Action Violet** ({colors.primary-action}): Filled primary buttons; this darker violet preserves the same signal while keeping white action text readable.
- **Deep Violet** ({colors.primary-deep}): Hover and pressed states; it should add depth without changing the meaning of the action.

### Secondary

- **Signal Lavender** ({colors.lavender}): Quiet emphasis, secondary labels, and the softer edge of the violet system.
- **Signal Cyan** ({colors.cyan}): Serving-size or operational pipeline accents where a distinct secondary signal improves scanning.

### Tertiary

- **Verified Green** ({colors.success}): Trusted/present data, healthy pipeline status, and positive ranking movement.
- **Caution Amber** ({colors.warning}): Estimates, ranges, incomplete qualification, and warnings.
- **Conflict Rose** ({colors.danger}): Conflicting or blocked values and destructive actions.

### Neutral

- **Void** ({colors.void}): Page canvas and the darkest visual field.
- **Canvas Navy** ({colors.canvas}): Main route background and quiet gutters.
- **Raised Navy** ({colors.surface}): Panels, cards, drawers, and table bodies.
- **Elevated Navy** ({colors.surface-raised}): Controls, selected rows, toolbar layers, and local storage notices.
- **Signal White** ({colors.text}): Headings, primary values, and high-priority labels.
- **Cool Muted** ({colors.text-muted}): Body copy and supporting descriptions.
- **Subtle Slate** ({colors.text-subtle}): Metadata and inactive navigation; never use it for essential content.
- **Hairline Blue** ({colors.border}): 1px separators and quiet panel boundaries.

**The Signal Rarity Rule.** Violet should identify what can be acted on now—active navigation, primary actions, or selected data—not decorate every surface.

## Typography

**Display Font:** Manrope (with Inter and system sans fallback)
**Body Font:** Inter (with system sans fallback)
**Label/Mono Font:** Inter with tabular numerals; use a monospace face only for raw JSON, collector ids, or code.

**Character:** Manrope gives the product name, hero, and route titles a compact editorial confidence. Inter keeps dense tables, field states, and controls familiar at small sizes. Numerals are optically prominent but never allowed to overpower the label that explains them.

### Hierarchy

- **Display** (700, `clamp(2.75rem, 6vw, 5.75rem)`, 0.98): Home headline and major product-studio statements.
- **Headline** (700, `clamp(2rem, 3.8vw, 3.5rem)`, 1.08): Route titles such as Explore products and Leaderboards.
- **Title** (700, `1.25rem`, 1.2): Panel headings, product names, and grouped sections.
- **Body** (400, `0.9375rem`, 1.6): Explanatory copy; keep narrative blocks around 65–75ch.
- **Label** (600, `0.6875rem`, 0.08em tracking, sentence case or compact uppercase): Tabs, trust chips, timestamps, filters, and data qualifiers.

**The Measurement Rule.** Use tabular numerals for quantities and align comparable values by their number, not by decorative alignment.

## Layout

Public product screens use a centered content frame with a maximum width near 1440px and 24–32px side gutters. The header is a persistent horizontal orientation bar on desktop; mobile collapses it to the brand, search/action affordance, and a full-width navigation drawer. Active navigation receives a thin violet underline or filled rail, not a separate page identity.

Operate screens use a two-dimensional rhythm: a primary content column and a secondary context column when the screen benefits from explanation (Explore drawer, leaderboard methodology, Live Data health). Product Passport gives the primary image/art frame a strong left anchor and lets the metric strip and tabs carry the reading order. Changes and Live Data may use denser timelines and operational tables, but retain the same panel grammar.

Use 8px-based spacing with 12px/16px control gaps and 24px panel padding. At widths below 900px, secondary columns stack, data tables become horizontally scrollable or row-based, and the navigation drawer becomes the primary wayfinding surface. At widths below 640px, panels reduce to 16px padding, action groups wrap, and no essential metric is hidden behind hover.

## Elevation & Depth

Depth is primarily tonal layering and restrained ambient shadow. Flat canvas gutters separate from raised panels through background value; panel borders remain hairlines; shadows appear only where a drawer, floating search field, or primary action needs to lift from the canvas. Violet glow is a state response, never the sole boundary or contrast source.

### Shadow Vocabulary

- **Panel lift** (`0 12px 32px rgba(0, 0, 0, 0.22)`): Context drawers and elevated panels that sit above the route.
- **Action lift** (`0 8px 24px rgba(109, 40, 217, 0.28)`): Primary buttons at rest or hover; keep it soft and directional.
- **Focus lift** (`0 0 0 3px rgba(139, 92, 246, 0.28)`): Keyboard focus ring paired with a visible 1px violet outline.

**The Layered Canvas Rule.** A surface must remain distinguishable when glow, blur, and imagery are disabled.

## Shapes

PulseRank uses gently rounded rectangles (8px controls, 12px buttons and compact items, 16px panels, 20px hero frames) with thin blue-gray borders. Pills are reserved for filter chips, qualifiers, and status labels. Tables use aligned rows and hairline dividers rather than heavy boxes. Category art may use circles and capsules as internal geometry, but the surrounding component silhouette stays consistent.

Inputs and search fields are inset dark controls with a 1px border and a violet focus transition. Destructive or conflict states use color plus an icon/label and never rely on color alone.

## Components

### Buttons

Buttons are tactile, compact, and explicit about their action.

- **Shape:** 12px radius; minimum 44px touch height.
- **Primary:** Accessible Action Violet fill, Signal White text, 12px × 20px padding; reserved for the route’s primary action.
- **Hover / Focus:** Deep Violet hover, 1px violet outline and Focus Lift ring on keyboard focus; transitions stay within 150–250ms.
- **Secondary / Ghost / Tertiary:** Raised Navy or transparent surface with a hairline border; use for compare, methodology, export, and navigation actions.
- **Disabled / loading:** Reduce contrast and show the reason or busy state in text; never leave an ambiguous inactive button.

### Chips

- **Style:** 999px silhouette, compact label, tinted surface, and a 1px border or icon for state reinforcement.
- **State:** Violet selected filters; green present/trusted; amber range/estimated; slate not published/not applicable; rose conflicting.
- **Rule:** Qualifier chips say `Range`, `Approx.`, `Est.`, `Not published`, or `Not applicable`; they do not silently collapse into a number.

### Cards / Containers

- **Corner Style:** 16px panels, 12px compact rows and cards.
- **Background:** Raised Navy over Canvas Navy; selected panels use a subtle violet tonal wash.
- **Shadow Strategy:** Use Panel Lift only for drawers and floating context; ordinary cards use tonal layering and a hairline.
- **Border:** 1px Hairline Blue; selected state may shift the border violet.
- **Internal Padding:** 24px desktop, 16px mobile; keep adjacent cards separated by 16px rather than nesting panels.

### Inputs / Fields

- **Style:** 12px radius, Raised Navy fill, Hairline Blue border, Inter body text, and an icon placed inside the control when useful.
- **Focus:** Electric Violet outline plus Focus Lift; focus is visible in keyboard and high-contrast modes.
- **Error / Disabled:** Conflict Rose or Caution Amber with a written explanation; disabled fields keep readable labels and do not look like missing data.

### Navigation

The public header carries the PulseRank wordmark, Explore, Leaderboards, Compare, My Pulse, Changes, search, and theme/motion affordances. Desktop active state is violet text plus an underline; mobile uses a high-contrast stacked drawer with the same order. Internal/operator surfaces may add a left rail, but the public navigation vocabulary and route names remain stable.

### Data states

Present, not published, not applicable, estimated/range, unparseable, and conflicting are distinct visual states with label, icon/shape, and explanatory text. The UI must preserve the source state from the trusted DTO; a missing value is never styled as zero.

### Category art

When no publishable source image exists, show original non-branded category art built from the PulseRank palette. It is an orientation cue, not evidence about the product package. Audit-only source images remain hidden from public surfaces.

## Do's and Don'ts

### Do:

- **Do** make the current route and the next useful action obvious within the first viewport.
- **Do** align quantities, units, and qualifiers so a reader can compare them at a glance.
- **Do** pair every uncertain or missing field with a written state explanation.
- **Do** keep product discovery, save, compare, and My Day actions browser-local and say so in the UI.
- **Do** maintain a complete HTML fallback when optional visual enhancement is disabled or unavailable.
- **Do** use generic category art when media is audit-only or absent.
- **Do** keep the hero measurement grid limited to the observatory visual; it is orientation, never evidence or essential text.
- **Do** use Manrope for editorial display and Inter for dense data; this pairing is intentional and part of the approved visual language.

### Don't:

- **Don't** use branded-looking fabricated packaging, copied product imagery, or a rotating model as data evidence.
- **Don't** turn missing caffeine, serving, sugar, or calorie fields into zero or a confident-looking placeholder.
- **Don't** hide essential controls or state behind hover, canvas, animation, or color alone.
- **Don't** use a bright accent as a border around every panel; reserve it for action and selection.
- **Don't** publish audit-only images, raw collector text, candidate observations, or confidence scores.

### Optional observatory depth layer

The Checkpoint 2 enhancement uses the original local `public/pulserank/observatory-atlas-*.webp` artwork as a restrained image-plane stage. It is decorative and feature-flagged per route; it never contains required copy, source-derived metrics, or a fabricated product package. The server-rendered HTML/CSS experience remains the fallback for disabled flags, reduced motion, unavailable WebGL, failed texture loading, and mobile-safe release settings.
