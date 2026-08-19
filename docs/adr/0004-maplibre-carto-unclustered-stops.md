# Render CARTO vector maps with unclustered Muni stops

Status: accepted

The public journey map will use MapLibre GL JS with CARTO Positron in light mode and CARTO Dark Matter in dark mode. Every active Muni stop remains an individual feature with clustering disabled because riders need to inspect exact boarding and moved-stop locations; aggregate markers would hide those distinctions. A full text itinerary remains the accessible source of journey instructions.

## Consequences

Stop geometry is versioned and cacheable, map code loads after the planner form, labels scale by zoom, and invisible hit areas improve selection without visually enlarging every point. Reduced-motion preferences disable camera animation.
