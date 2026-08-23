# PulseRank Product Passport evidence

Date: 2026-08-23
Route: `/products/mega-monster-energy-drink`
Approved direction: Reference Deck / Steel Monolith
Status: implementation complete; awaiting final owner approval before commit or push

## Evidence assets

- Desktop, 1440×900: `product-passport-desktop-1440x900.png`
- Mobile, 390×844: `product-passport-mobile-390x844.png`
- Motion recording: `product-passport-motion.mp4`
- Approved mockup: `../mocks/reference-deck-monolith-revision/monolith-steel-sugar-vessel.png`

## Real database representatives

The page reads the trusted product row and maps it through `toPublicProductDto`. Extended nutrition is enabled explicitly for Product Passport because the owner-approved page publishes the trusted sugar and calorie fields; the general public API feature flag remains unchanged.

| State | Trusted product | Result |
| --- | --- | --- |
| Exact caffeine + published sugar | `mega-monster-energy-drink` | 240 mg caffeine, 709 ml serving, 33.9 mg/100 ml, 320 kcal, 81 g sugar |
| Explicit caffeine zero | `7-up` | 0 mg is labeled “Explicit zero”; it is never treated as missing |
| Conflicting caffeine | `kaffn8` | No numeric caffeine is shown; both rankings are excluded with reasons |
| Caffeine not published | `atomic-x` | No numeric caffeine is shown; both rankings are excluded with reasons |
| Range caffeine | None in the trusted database | Renderer and model preserve range bounds; unit test uses the contract shape. No public example was fabricated |
| Estimated caffeine | None in the trusted database | Supported by the renderer and state legend; no public example was fabricated |
| Unparseable caffeine | None in the trusted database | Supported by the renderer and state legend; no public example was fabricated |

Database audit at implementation time: 734 trusted products; 728 exact caffeine, 3 conflicting caffeine, 3 caffeine not published, and 0 trusted ranges.

## Mockup comparison

Matched:

- Dark-only brushed-steel instrument chassis with flush hardware and inset black reading surfaces.
- Real product-image specimen filling the complete left bay, monumental caffeine reading in the center, quantity-scaled glass sugar vessel on the right, and exactly three local actions.
- Manrope display roles, Inter body/label roles, and tabular measurements.
- Metric strip, observed facts, category provenance, source record, observation timestamp, ranking eligibility, and the complete state legend.
- Cyan exact-data datum line and a purple selected-action treatment.

Implementation refinements:

- Product metadata was moved out of the image bay into the first position of a four-column dossier: Product metadata, Observed facts, Source record, and Ranking eligibility.
- The steel is a layered CSS material rather than a flat dark border: directional micro-grain, broad specular sweeps, bright bevels, recessed reading surfaces, and inset fasteners remain visible without reducing text contrast.
- The sugar scale is adaptive rather than a fixed health-style gauge. An 81 g observation uses a 100 g measurement range with 20 g ticks.
- The source name remains an inline provenance link in the source record. The right-side “Open source” action is absent, as approved.
- Long sparse states replace the giant numeric treatment with readable state text instead of forcing them into the numeric scale.
- Mobile uses a fixed three-action bottom rail and a single-column evidence flow.

## Interaction and motion verification

The route-specific Playwright suite covers:

- authorized local product-image delivery;
- full-bay desktop specimen geometry and the four-column evidence contract;
- exact caffeine and published sugar rendering;
- browser-local Save, Compare, and Add to My Day state changes;
- keyboard activation and visible focus;
- explicit zero, conflicting, and not-published real records;
- desktop and mobile overflow containment;
- minimum local-action target size;
- reduced motion; and
- automated accessibility scanning.

Motion follows the Emil Kowalski decision framework:

- One rare explanatory entrance: the caffeine datum line calibrates and the sugar quantity settles into the measurement bottle.
- Declarative CSS runs independently of React work: datum 540 ms and sugar 620 ms using strong ease-out curves.
- Repeated controls use only 140–180 ms interruptible transitions and `scale(.97)` press feedback.
- No keyboard-initiated navigation animation, continuous loop, bounce, parallax, or motion-only information.
- `prefers-reduced-motion: reduce` removes the datum, sugar, and image movement while leaving all content visible.

## Accessibility and input audits

- Automated scan: zero serious or critical axe findings.
- Keyboard: Save receives a 2 px cyan visible outline with a 3 px offset; Enter toggles the action and updates the polite status region.
- Accessible sugar graphic: explicit image name plus a state-specific description; missing numeric sugar shows no fill.
- 44 px audit: desktop action targets are approximately 134×100 px; mobile action targets are approximately 111×63 px. Header navigation and source links are at least 44 px high. Inline prose links retain the WCAG inline-link exception.
- Product understanding does not depend on the image, color, animation, or the bottle. Every value and state is repeated in text.
- No caffeine recommendation, daily target, health zone, or medical guidance is present.

## Contrast audit

Calculated WCAG contrast ratios against the actual dark surfaces:

| Role | Ratio |
| --- | ---: |
| Primary text | 17.53:1 |
| Muted text | 10.29:1 |
| Subtle metadata | 6.58:1 |
| Cyan exact-data text | 11.61:1 |
| Amber sparse-state text | 9.99:1 |
| Red conflicting-state text | 6.72:1 |

All measured text roles exceed 4.5:1.

## Overflow and reduced motion

- Production desktop: document `scrollWidth` 1425 px equals `clientWidth` 1425 px at the measured 1440×900 viewport (15 px scrollbar allowance).
- Playwright desktop and 390 px mobile overflow assertions pass.
- Reduced-motion computed styles report `animation-name: none` for both the sugar fill and datum line.

## Production performance

Measured against the optimized production build at 1440×900:

| Path | TTFB | FCP | Load | Transfer |
| --- | ---: | ---: | ---: | ---: |
| Cold process/font/image cache | 1745.7 ms | 2276 ms | 2214.6 ms | 7.1 KB cached transfer |
| Warm run median | 518.2 ms | 852 ms | 750.9 ms | 7.8 KB cached transfer |
| Best warm run | 411.9 ms | 716 ms | 616.5 ms | 7.8 KB cached transfer |

The route is dynamically server-rendered from PostgreSQL, so cold TTFB includes the trusted-row query and process/cache warm-up. The browser loads 34 resources. Transfer values above reflect the collaborative browser's primed HTTP cache; the earlier empty-cache cold audit measured a 326.5 KB encoded resource total.

## Verification results

- `bun run typecheck`: pass.
- `bun run test`: pass, 40 files / 490 tests, 4 todo. One lease-policy test timed out only during an earlier concurrent run and passed both in isolation and in the required sequential full run.
- `bun run build`: pass, Next.js 16.3.1 optimized production build.
- `bun run release:check`: pass, 0 failures and the existing package-metadata warning.
- Product Passport + frozen Explore Playwright suites: pass, 15 tests passed / 11 intentionally skipped by project targeting.
- `git diff --check`: pass.
- Route-scoped ESLint: pass.
- `bun run lint`: blocked by the preserved user-owned untracked file `mockups/v2/shoot.cjs`, whose CommonJS `require()` violates the repository ESLint rule. No Product Passport lint findings are present.
- `bun run lint -- --ignore-pattern 'mockups/v2/shoot.cjs'`: pass with the existing unrelated warning in `tests/unit/server/judge/actions.test.ts`.
- Migration/schema checks: not applicable; no database or migration file changed.

## Intentional deviations

1. No trusted range, estimated, or unparseable product exists in the completed database. Those states are implemented and unit-tested, but no fake public product or screenshot was created.
2. The approved mockup is a visual direction, not a literal raster trace. The implementation uses responsive HTML, an accessible SVG measurement bottle, real copy reflow, and live local actions.
3. The broader extended-fields API feature flag remains unchanged. Only Product Passport opts into the existing trusted DTO fields required by the approved surface.
4. DESIGN.md and every user-owned untracked artifact were preserved unchanged.
