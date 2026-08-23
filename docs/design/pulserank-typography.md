# PulseRank Typography Reference

> The type system used on the PulseRank landing page (`site/index.html`).
> Keep this file for future pages/sections so the voice stays consistent.

## Fonts

| Family | Role | Weights loaded |
|---|---|---|
| **Manrope** | Display + brand (headline, wordmark, section headings) | 400, 500, 600, 700 |
| **Inter** | Body + UI (paragraphs, nav, buttons, labels) | 400, 500, 600 |

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Manrope:wght@400;500;600;700&display=swap" rel="stylesheet" />
```

Base stack: `font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;`

## The signature look (what makes it "PulseRank")

1. **Manrope Medium (500) for the big headline** — not Bold. Keeps it cinematic, not shouty.
2. **Tight tracking on display sizes**: `letter-spacing: -.055em`, `line-height: .91`.
3. **Wide tracking + uppercase on everything small**: labels/buttons run `text-transform: uppercase` with `letter-spacing: .12em – .34em`. The smaller the text, the wider the tracking.
4. **Gradient accent word**: the emphasized word in the H1 is transparent text filled with `linear-gradient(108deg, #ffffff 10%, #dcc7ff 48%, #a96bff 88%)` via `background-clip: text`.
5. **Micro-type**: labels live at 7.5–10px — tiny but tracked-out, so they read as texture.

## Scale (desktop)

| Element | Font | Size | Weight | Tracking | Line-height | Case |
|---|---|---|---|---|---|---|
| Hero H1 | Manrope | `clamp(54px, 6.35vw, 108px)` | 500 | −.055em | .91 | Sentence, `<em>` word = gradient |
| Hero body | Inter | `clamp(13px, .92vw, 16px)` | 400 | normal | 1.72 | Sentence; color `rgba(231,225,245,.65)` |
| Section H2 | Manrope | `clamp(24px, 2.25vw, 38px)` | 400 | −.04em | — | Sentence |
| Brand wordmark | Manrope | 13px | 650 | .28em | 1 | UPPERCASE |
| Brand sub | Manrope | 13px | 600 | .34em | — | (loader mark variant) |
| Eyebrow label | Inter | 7.5px | — | .28em | — | UPPERCASE |
| Nav links | Inter | 10px | 500 | .17em | — | UPPERCASE |
| Button label (b) | Inter | 10px | 600 | .13em | — | UPPERCASE |
| Button sub-label | Inter | 8px | 400 | .12em | — | UPPERCASE, 46% opacity |
| Header CTA | Inter | 10px | 600 | .14em | — | UPPERCASE |
| Chapter rail copy | Inter | 8px | 400 | .26em | — | UPPERCASE |
| Source chip | Inter | 8px | 400 | .18em | — | UPPERCASE |

## Color tokens (text)

```css
--ink: #04040a;          /* page background */
--paper: #f3efff;        /* primary text on dark */
--muted: rgba(227, 219, 246, .66);
--quiet: rgba(227, 219, 246, .42);
--line: rgba(222, 210, 255, .16);
--violet: #a76bff;
--violet-hot: #d99cff;   /* accents, dots, focus rings */
--violet-deep: #6e2de4;
```

Headline carries `text-shadow: 0 5px 34px rgba(0,0,0,.58)` for legibility over the scene; body copy uses a softer `0 2px 24px rgba(0,0,0,.75)`.

## Rules of thumb for new sections

- Display = **Manrope 500, negative tracking**. Never bold the hero.
- Anything ≤ 10px = **UPPERCASE + wide tracking** (≥ .12em).
- One gradient `<em>` word max per headline.
- Body copy stays Inter, low-contrast violet-grey, generous line-height (1.7+).
- Buttons: two-line pattern — bold tracked label + tiny quiet sub-label.
