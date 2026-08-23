export const PRODUCT = {
  name: "Mega Monster Energy Drink",
  category: "Energy drink",
  productType: "Source category list",
  serving: "709 ml",
  servingForm: "drink",
  caffeine: "240 mg",
  caffeineState: "Exact value",
  normalized: "709 ml",
  concentration: "33.9 mg / 100 ml",
  calories: "320 kcal",
  sugar: "81 g",
  source: "Caffeine Informer",
  observed: "22 Aug 2026 · 09:29 UTC",
} as const;

export const VARIANTS = [
  { id: "signal", label: "Signal Console" },
  { id: "index", label: "Evidence Index" },
  { id: "orbit", label: "Orbit Instrument" },
] as const;

export type VariantId = (typeof VARIANTS)[number]["id"];
