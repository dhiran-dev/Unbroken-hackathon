# T3 Code design reference

UNBROKEN uses the visual design language of T3 Code as an implementation reference while retaining its own product identity, information architecture, wording, and assets.

## Pinned reference

- Product reference: <https://t3.codes/>
- Source reference: <https://github.com/pingdotgg/t3code>
- Reviewed commit: `cebac353defde6211c9e8c3d8ecd140c92042930`
- Commit date: 2026-08-18
- Commit subject: `fix(mobile): show structured input option descriptions (#7321)`
- License: MIT, Copyright (c) 2026 T3 Tools Inc.

## Reviewed source paths

- `apps/web/components.json` — shadcn `base-mira`, Zinc base, CSS variables, Lucide icons.
- `apps/web/src/index.css` — semantic color roles, compact geometry, system typography, glass fallbacks, focus states, and 130–180ms motion.
- `apps/web/src/components/ui/button.tsx` — compact control proportions and visible keyboard focus treatment.
- `apps/web/src/components/ui/card.tsx` — layered surfaces, subtle borders, and low-elevation shadows.
- `apps/web/src/components/ui/sidebar.tsx` — dense desktop navigation behavior.
- `packages/shared/src/themePalettes.ts` — OKLCH semantic theme-role organization.

## Adaptation rules

- Use the pinned T3 Code neutral canvas and blue interaction palette: near-black
  or off-white backgrounds, subtly layered neutral surfaces, restrained borders,
  and blue for primary actions and focus. Green is reserved for genuine healthy
  or accepted states; it is not a brand tint or page background.
- Keep UNBROKEN's own copy, icons, routes, layouts, and product workflows.
- Preserve the compact base-mira geometry, semantic OKLCH approach, restrained glass, system typography, and short transitions.
- Never use the T3 name, logo, screenshots, marketing assets, or coding-agent information architecture.
- Prefer fresh implementations using shadcn/Base UI primitives. If source is copied or substantially adapted later, update `THIRD_PARTY_NOTICES.md` and retain the required MIT notice.
- Accessibility takes priority over visual fidelity: WCAG 2.1 AA contrast, 44px coarse-pointer targets, visible focus, reduced motion, and a usable 360px layout are mandatory.
