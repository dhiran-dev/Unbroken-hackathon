# Product Passport prototype comparison

Three dark-only HTML/CSS directions are available at the isolated prototype route. The production Product Passport remains unchanged while a direction is selected.

| Variant | Core idea | Strength | Trade-off |
| --- | --- | --- | --- |
| Signal Console | Instrument-console specimen with a steel-like grid and a four-column evidence dossier | Fastest scan of the metric strip, sugar measure, provenance, and ranking eligibility | Most information-dense; less editorial breathing room |
| Evidence Index | Archival/editorial record with a large title and calm measurement readout | Strongest source-first reading order and clearest product-image disclaimer | Uses more vertical space before the full dossier |
| Orbit Instrument | Spatial radial readout with a large product specimen and orbiting evidence cues | Most distinctive and expressive while keeping the number and qualifiers explicit | Radial treatment is more brand-forward and less utilitarian |

## Verification

- Desktop captures: 1440×900 for all three variants.
- Mobile captures: 390×844 for all three variants.
- Product imagery uses the local `/api/public/product-images/mega-monster-energy-drink` route.
- Prototype actions respond locally for Save, Compare, and Add to My Day.
- Keyboard selection: `1`, `2`, `3`, arrow keys, and `R` replay.
- Scoped ESLint, typecheck, and `git diff --check` pass.
- Axe scan reports zero violations for all three variants at 390×844.
- Mobile horizontal-overflow check reports `scrollWidth === clientWidth`.
- A short browser recording was captured during variant switching and replay.
