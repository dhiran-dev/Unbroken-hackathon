---
name: PulseRank
description: A dark, bioluminescent product-studio for trusted caffeine data — the instrument room of the PulseRank universe.
colors:
  ink: "#04040a"
  ink-raised: "#0b0916"
  veil: "rgba(16, 13, 28, 0.52)"
  veil-solid: "#100c1c"
  paper: "#f3efff"
  text-muted: "rgba(227, 219, 246, 0.66)"
  text-quiet: "rgba(227, 219, 246, 0.42)"
  line: "rgba(222, 210, 255, 0.16)"
  line-bright: "rgba(229, 216, 255, 0.34)"
  violet: "#a76bff"
  violet-hot: "#d99cff"
  violet-deep: "#6e2de4"
  success: "#34d399"
  warning: "#fbbf24"
  danger: "#fb7185"
typography:
  display:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "clamp(54px, 6.35vw, 108px)"
    fontWeight: 500
    lineHeight: 0.91
    letterSpacing: "-0.055em"
    accentWord: "linear-gradient(108deg, #ffffff 10%, #dcc7ff 48%, #a96bff 88%) background-clip:text"
  headline:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "clamp(24px, 2.25vw, 38px)"
    fontWeight: 400
    letterSpacing: "-0.04em"
  title:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 600
    letterSpacing: "-0.02em"
  metric:
    fontFamily: "Manrope, Inter, system-ui, sans-serif"
    fontSize: "clamp(44px, 4vw, 76px)"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "-0.045em"
  body:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(13px, 0.92vw, 16px)"
    fontWeight: 400
    lineHeight: 1.72
    color: "{colors.text-muted}"
  label:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "10px"
    fontWeight: 500
    letterSpacing: "0.17em"
    transform: "uppercase"
  micro:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "7.5px"
    fontWeight: 500
    letterSpacing: "0.28em"
    transform: "uppercase"
  numeral:
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    fontFeature: "'tnum' 1"
rounded:
  sm: "10px"
  md: "14px"
  lg: "22px"
  xl: "28px"
  pill: "999px"
spacing:
  hairline: "1px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  section: "96px"
  pagePad: "clamp(22px, 3.6vw, 62px)"
components:
  button-primary:
    background: "linear-gradient(135deg, {colors.violet-deep}, {colors.violet})"
    textColor: "#ffffff"
    rounded: "{rounded.pill}"
    padding: "13px 26px"
    pattern: "two-line: 10px/600/.13em uppercase label + 8px/.12em 46%-opacity sub-label"
  button-glass:
    backgroundColor: "{colors.veil}"
    backdropFilter: "blur(18px)"
    border: "1px solid {colors.line}"
    textColor: "{colors.paper}"
    rounded: "{rounded.pill}"
    highlight: "inset 0 1px 0 rgba(233,222,255,0.18)"
  button-ghost:
    backgroundColor: "transparent"
    border: "1px solid {colors.line}"
    textColor: "{colors.text-muted}"
    rounded: "{rounded.pill}"
  panel-glass:
    backgroundColor: "{colors.veil}"
    backdropFilter: "blur(18px)"
    border: "1px solid {colors.line}"
    rounded: "{rounded.lg}"
  chip-state-present:
    backgroundColor: "rgba(52, 211, 153, 0.12)"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
  chip-state-uncertain:
    backgroundColor: "rgba(251, 191, 36, 0.12)"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
  chip-state-conflict:
    backgroundColor: "rgba(251, 113, 133, 0.12)"
    textColor: "{colors.danger}"
    rounded: "{rounded.pill}"
  chip-state-unpublished:
    backgroundColor: "rgba(227, 219, 246, 0.08)"
    textColor: "{colors.text-quiet}"
    rounded: "{rounded.pill}"
---

# Design System: PulseRank v2 — "The Instrument Room"

## Overview

**Creative North Star:** The landing page opens a bioluminescent universe — a violet night forest with a charged can hovering over a mossy log. PulseRank's product pages are **the instrument room you step into after crossing that threshold**: same night, same violet physics, same cinematic restraint, but now the visitor holds the measurement tools.

This is a **replacement visual world**, not a reskin of the old navy observatory. The incumbent look (flat navy panels, blue hairlines, bold Manrope headings, cyan secondary accents, dashboard grammar) is treated as evidence and anti-reference.

**Key characteristics:**

- Near-black ink canvas (`#04040a`) with violet light as the only chromatic identity.
- Frosted glass surfaces floating over atmosphere — depth comes from blur, tonal veils, and light edges, never from drop shadows alone.
- Cinematic type: Manrope Medium display with one gradient accent word; every small label is uppercase, wide-tracked micro-type.
- Asymmetric instrument compositions — chapter indices, vertical rail copy, hairline rules — instead of centered dashboard grids.
- Absolute data honesty: qualifiers, field states, and source attribution are part of the visual language, not fine print.

**Mode:** These are Operate/Read surfaces. Identity lives in atmosphere, typography, and precise details — scanability still wins inside any single panel.

## Colors

The palette is the landing page's night sky carried indoors: ink black takes the place of walls, violet light does all the talking, and semantic greens/ambers/roses appear only as small data signals.

### Core

- **Ink** ({colors.ink}): Page canvas, the darkest visual field. Nothing sits "on white" — ever.
- **Ink Raised** ({colors.ink-raised}): Solid fallback surface where backdrop blur is unavailable or disabled.
- **Veil** ({colors.veil}): The glass fill — a translucent violet-black wash behind every panel, control, and drawer.
- **Paper** ({colors.paper}): Headlines, primary values, high-priority labels.
- **Cool Muted / Quiet** ({colors.text-muted} / {colors.text-quiet}): Body copy, metadata, inactive states.

### Signal

- **Violet** ({colors.violet}): Live signal, selection, action fills, focus rings, plot points.
- **Violet Hot** ({colors.violet-hot}): Hover tips, active dots, the bright end of gradients.
- **Violet Deep** ({colors.violet-deep}: the grounded end of action gradients and glows.
- **Line / Line Bright** ({colors.line} / {colors.line-bright}): Hairlines, glass borders, dividers, plot grids.

### Semantic (data only)

- **Verified Green** ({colors.success}) — trusted/present values and healthy pipeline states.
- **Caution Amber** ({colors.warning}) — estimates, ranges, incomplete qualification.
- **Conflict Rose** ({colors.danger}) — conflicting values and destructive actions.
- Unpublished / not-applicable fields use Quiet grey chips, never red.

**The Signal Rarity Rule.** Violet marks what is alive: active navigation, primary actions, selected data, measured values. At most **one atmospheric bloom per viewport**. If everything glows, nothing does.

## Typography

The landing page typography contract is binding. Reference: `docs/design/pulserank-typography.md`.

**The Five Laws:**

1. **Display is Manrope Medium (500), never bold.** Tracking −.055em, line-height .91. Bold display type is a defect.
2. **One gradient accent word maximum per headline** — `linear-gradient(108deg, #ffffff 10%, #dcc7ff 48%, #a96bff 88%)` via background-clip, wrapped in `<em>`.
3. **Anything ≤ 10px is uppercase with wide tracking** (.12em–.34em). The smaller the text, the wider the tracking. Micro-type is texture, and it is a signature — do not "fix" it to 14px.
4. **Body stays Inter**, low-contrast violet-grey ({colors.text-muted}), line-height 1.72+. Narrative blocks stay ≈65–75ch.
5. **Numerals are data**: tabular figures (`font-feature-settings: 'tnum' 1`) wherever quantities align; big measurement moments use the **Metric** ramp (Manrope 500, −.045em) with unit + qualifier locked nearby.

### Ramp

| Role | Spec | Use |
|---|---|---|
| Display | Manrope 500, `clamp(54px, 6.35vw, 108px)`, −.055em, .91 | Route heroes, statement moments |
| Headline | Manrope 400, `clamp(24px, 2.25vw, 38px)`, −.04em | Section titles |
| Title | Manrope 600, 17px, −.02em | Panel headings, product names |
| Metric | Manrope 500, `clamp(44px, 4vw, 76px)` | The number of the moment (mg, PulseScore) |
| Body | Inter 400, `clamp(13px, .92vw, 16px)`, 1.72 | Explanatory copy |
| Label | Inter 500, 10px, .17em, caps | Nav, buttons, tabs, table headers |
| Micro | Inter 500, 7.5–9px, .28em, caps | Eyebrows, source chips, rail copy |
| Numeral | Inter 600, tabular | Table cells, deltas, timestamps |

Buttons use the **two-line pattern**: bold tracked 10px label over an 8px quiet sub-label at 46% opacity.

## Atmosphere & Depth

Depth is light in fog, not boxes on shelves.

- **Glass recipe:** `background: var(--veil)`; `backdrop-filter: blur(18px)`; border `1px solid var(--line)`; inner top highlight `inset 0 1px 0 rgba(233,222,255,.18)`; radius 22px panels / 999px controls.
- **Fallback:** when blur is unsupported or reduced-transparency is requested, swap Veil → {colors.veil-solid}. Every surface must survive without blur.
- **Atmosphere budget per viewport:** one radial violet bloom (very low alpha), one soft vignette, optional hairline grid at ≤6% alpha. Light shafts and mist belong to hero moments only.
- **Shadows** are soft, large, and near-black (`0 24px 64px rgba(0,0,0,.45)`) — they seat glass onto darkness; they are never grey card shadows.

## Layout

- Content frame: fluid width with `--page-pad: clamp(22px, 3.6vw, 62px)` gutters; hard cap 1680px.
- **Asymmetric instrument grammar:** primary measurement zone dominates (~60%), flanked by a narrow facet/context rail and an inspector column. Chapter indices (01, 02…), vertical rail copy, and hairline rules pace the scroll.
- Header: fixed, glass, hairline underside — brand glyph + wordmark left, micro-tracked nav center, glass CTA right. Mobile collapses nav into a full-screen ink drawer with display-size links.
- Breakpoints: <1100px inspector columns stack under the measurement zone; <720px tables become row-based cards, rails become horizontal chip scrollers, touch targets stay ≥44px, no page-level horizontal overflow.
- Negative space is a material. Two instruments with air between them beat three packed panels.

## Motion

- Easing: `cubic-bezier(.16, 1, .3, 1)` (out) and `cubic-bezier(.65, 0, .35, 1)` (in-out). Durations 150–450ms; scene transitions up to 900ms.
- Signature moves: the **pulse glyph** (circle + bolt tick) for loading/brand; magnetic hover on CTAs; scroll reveals that rise ≤16px with fade; count-up on Metric values; plot points that ignite violet on hover with a hot dot.
- `prefers-reduced-motion`: reveals become opacity-only, magnetics and auto-rotation off, count-ups render final values. All essential information survives with animation disabled.

## Components

### Buttons — the glass pill family

All buttons are pills (999px), minimum 44px height, two-line label pattern, magnetic hover, focus ring `0 0 0 3px rgba(167,107,255,.35)`.

- **Primary:** violet-deep→violet gradient fill, white text, soft violet shadow. One per view — the route's main action.
- **Glass:** veil fill + blur + hairline + inner highlight. The default for secondary actions, header CTA, toolbars.
- **Ghost:** transparent, hairline border, muted text. Tertiary/navigational.
- **Round icon buttons** (36–44px) for compare toggles, saves, close affordances.
- Disabled/busy states reduce opacity and say why in text.

### Chips & qualifiers

999px, 8–9px tracked caps, tinted translucent fill + matching text color. States: selected (violet), present/trusted (green), range/approx/est (amber), not published / not applicable (quiet grey), conflict (rose). Qualifier chips (`RANGE`, `APPROX.`, `EST.`, `NOT PUBLISHED`, `NOT APPLICABLE`) sit beside every value they qualify and never silently collapse into a number.

### Glass panels

Veil + blur + hairline, 22px radius, 24px padding (16px mobile). Selected state shifts border to Line Bright and adds a faint violet wash. No nested glass-in-glass beyond one level.

### Rank rows & plots

Leaderboard rows: oversized rank numeral (Metric ramp, quiet), name + category glyph, tabular value column, and a **pulse track** — a hairline rail with a violet comet marking the value's position, amber diamond for ranged values. Plot axes are hairlines; grid ticks are micro-type; points are violet with hot centers.

### Inputs & search

Inset ink-raised field, hairline border, pill radius, violet focus ring, tracked uppercase placeholder. Search is a first-class floating glass bar where the route makes it primary.

### Navigation

Public vocabulary is stable: Explore, Leaderboards, Compare, My Pulse, Changes, Live Data. Active link = Paper text + violet underline offset; inactive = Quiet. Mobile drawer uses Display-scale links.

### Data states

Present, not published, not applicable, estimated/range, unparseable, conflicting remain six distinct visual states with label + color + explanatory text. A missing value is never styled as zero; a range is never collapsed; conflicting caffeine is rank-ineligible.

### Category glyph art

No branded/fabricated packaging. Products without published imagery get original SVG glyph vessels (can, bottle, cup, shot, tablet) drawn from the palette — violet-lit silhouettes on glass slabs. Glyphs orient; they are never evidence.

## Component Architecture

The UI is **composed from installed component libraries**, never hand-rolled CSS. Four layers:

### Layer 1 — shadcn/ui foundation (the base)

All structure, data display, forms, and overlays are stock shadcn primitives themed through `globals.css` tokens. The violet ink world maps onto the standard shadcn variables so every primitive inherits it:

| shadcn token | Value | Meaning |
|---|---|---|
| `--background` | {colors.ink} | Page canvas |
| `--card` / `--popover` | {colors.veil-solid} + blur utility | Glass panels |
| `--primary` | {colors.violet} | Action / signal |
| `--ring` | rgba(167,107,255,.35) | Focus |
| `--border` | {colors.line} | Hairlines |
| `--muted-foreground` | {colors.text-muted} | Body copy |

Components in play: **Button** (pill variants), **Card**, **Badge** (field states), **Input**, **Select**, **Tabs**, **Table**, **Command** (⌘K search), **Dialog**, **Sheet** (mobile nav), **Tooltip**, **ScrollArea**, **Toggle Group** (filters), **Separator**, **Skeleton**, **Sonner** (toasts).

Install missing ones via `npx shadcn@latest add <component>` before use.

### Layer 2 — Magic UI (motion & texture)

| Component | Used for |
|---|---|
| **Number Ticker** | Metric count-ups (200 mg, catalog counts, ranks) |
| **Border Beam** | The single highlighted panel per viewport (rank #1 pod, live passport, active compare slot) |
| **Shimmer Button** | Primary CTA sweep effect |
| **Blur Fade** | Staggered scroll reveals (rows, panels) |
| **Dot Pattern / Grid Pattern** | Background texture at ≤6% alpha |
| **Orbiting Circles** | Passport vessel stage satellites (source chip, state chip) |
| **Animated Beam** | Compare-page connection lines between product nodes |
| **Magic Card** | Spotlight-hover product cards |
| **Marquee** | Category chip rail on mobile |

### Layer 3 — Aceternity UI (signature moments)

| Component | Used for |
|---|---|
| **Aurora Background / Spotlight** | Route hero atmosphere (the one bloom per viewport) |
| **Bento Grid** | Explore workspace & leaderboard podium asymmetry |
| **Hover Border Gradient** | Header CTA / methodology card border |
| **Text Generate Effect** | Hero paragraph reveal |
| **Moving Border** | Live-data status card |

Rules: at most **one Layer-2/3 showpiece per viewport**; everything else stays quiet shadcn. Every showpiece has a static fallback (no JS/reduced motion = plain bordered card).

### Layer 4 — Canvas UI glass-object

Passport hero, compare stage, and empty states render their category glyph as refracting glass (`tint #6e2de4`, `highlight #d99cff`, `ior ≈ 1.6`, `dispersion ≈ 1.2`). Static glyph art remains the SSR / reduced-motion / no-WebGL fallback. The glass never carries data, copy, or evidence. Install: `npx shadcn@latest add @canvas-ui/glass-object-react` (deps `three` — already in the repo).

## Data Truth (non-negotiables)

- Attribution to **Caffeine Informer** appears at page level (source chip/footer) under its terms.
- Serving size is locked within 24px of every milligram value.
- Copied source prose is never published; audit-only images never appear publicly.
- Personal saves/compares stay browser-local and the UI says so.
- Public surfaces never expose raw payloads, collector IDs, confidence scores, or candidate observations.

## Do's and Don'ts

### Do

- **Do** keep the landing's voice: medium-weight display, gradient accent word, micro-tracked labels, generous darkness.
- **Do** give every route one unmistakable "instrument" (plot, rank constellation, passport slab, ledger) and let it dominate.
- **Do** pair every uncertain or absent field with a written state explanation.
- **Do** use glass for layers that float (drawers, CTAs, inspectors) and ink for the ground plane.
- **Do** ship the no-blur, no-JS, reduced-motion experience first; enhance upward.

### Don't

- **Don't** import the old world: no flat navy panels, no cyan secondary, no bold display headings, no bootstrap-style card grids.
- **Don't** decorate with violet — violet is meaning (action, selection, signal), plus at most one bloom per viewport.
- **Don't** hide essential controls or state behind hover, glass, animation, or color alone.
- **Don't** fabricate packaging, publish audit-only media, or render missing data as confident zeros.

## Route Exemption

**Home (`src/app/page.tsx`) is out of scope** — it is being designed externally. v2 applies to every other public route; do not constrain or restyle Home while its external design is pending.
