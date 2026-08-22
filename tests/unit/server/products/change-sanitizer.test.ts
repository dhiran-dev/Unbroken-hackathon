import { describe, expect, it } from "vitest";

import {
  changeField,
  sanitizeChangePoint,
} from "@/server/products/change-sanitizer";

describe("public change point sanitizer", () => {
  it("keeps only finite field-level values and qualifiers", () => {
    expect(
      sanitizeChangePoint({
        value: 95,
        qualifier: "exact",
        unit: "mg",
        min: null,
        max: null,
        rawText: "private source prose",
        nested: { secret: true },
      }),
    ).toEqual({
      value: 95,
      qualifier: "exact",
      unit: "mg",
      min: null,
      max: null,
    });
  });

  it("recovers a stored field marker and otherwise uses a safe event mapping", () => {
    expect(changeField("variant_changed", { field: "variant:zero.caffeine_mg" }, null)).toBe(
      "variant:zero.caffeine_mg",
    );
    expect(changeField("serving_changed", null, null)).toBe("serving");
    expect(changeField("unknown_internal_event", null, null)).toBe("unknown");
  });
});
