import type { SavedProductRef } from "@/lib/local-state/saved-products";

/** Builds a valid {@link SavedProductRef} with optional overrides. */
export function makeSavedProductRef(
  overrides: Partial<SavedProductRef> = {},
): SavedProductRef {
  return {
    slug: "celsius-original",
    name: "Celsius Original",
    category: "energy-drinks",
    caffeine: { mg: 200, qualifier: "per-can", sourceLevel: "label" },
    serving: { value: 12, unit: "fl oz", form: "can" },
    observedAt: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}
