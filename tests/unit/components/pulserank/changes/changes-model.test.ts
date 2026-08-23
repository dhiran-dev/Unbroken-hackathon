import { describe, expect, it } from "vitest";

import {
  countEventTypes,
  eventLabel,
  fieldLabel,
  formatRelativeTime,
  pointQualifierText,
  pointValueText,
} from "@/components/pulserank/changes/changes-model";
import type { ChangeEventDto } from "@/server/products/queries";
import { changeField, isPublicChangeObservationStatus, sanitizeChangeEventType } from "@/server/products/change-sanitizer";

const now = Date.parse("2026-08-23T12:00:00.000Z");

function change(overrides: Partial<ChangeEventDto> = {}): ChangeEventDto {
  return {
    id: "5c8a4c02-f23d-4b85-9cb4-c2fe94f35b0b",
    slug: "sample-product",
    productName: "Sample product",
    eventType: "caffeine_changed",
    field: "caffeine_mg",
    before: { value: 80, qualifier: "exact", unit: "mg" },
    after: { value: 95, qualifier: "exact", unit: "mg" },
    occurredAt: "2026-08-23T11:00:00.000Z",
    sourceUrl: "https://www.caffeineinformer.com/caffeine-content/sample-product",
    sourceObservationAt: "2026-08-23T11:00:00.000Z",
    ...overrides,
  };
}

describe("public changes model", () => {
  it("keeps ranges, units, and qualifiers visible in before/after points", () => {
    const point = { value: null, min: 80, max: 120, qualifier: "range", unit: "mg" };
    expect(pointValueText(point, "after")).toBe("80–120 mg");
    expect(pointQualifierText(point)).toBe("range");
  });

  it("does not turn missing points into zeroes", () => {
    expect(pointValueText(null, "before")).toBe("No previous point");
    expect(pointValueText({ value: null, qualifier: "unknown", unit: null }, "after")).toBe("Unknown");
  });

  it("keeps event and nested field labels readable without hiding the field", () => {
    expect(eventLabel("conflict_resolved")).toBe("Conflict resolved");
    expect(fieldLabel("variant:zero.caffeine_mg")).toBe("Variant · zero · Caffeine Mg");
    expect(fieldLabel("unknown_internal_field")).toBe("Unknown Internal Field");
  });

  it("maps unexpected persisted event types and field markers to safe public values", () => {
    expect(sanitizeChangeEventType("provider_internal_note")).toBe("unknown_change");
    expect(changeField("variant_changed", { field: "variant:Zero\n.caffeine_mg" }, null)).toBe("variant:Zero.caffeine_mg");
    expect(changeField("variant_changed", { field: "provider_internal_note" }, null)).toBe("unknown");
    expect(isPublicChangeObservationStatus("trusted")).toBe(true);
    expect(isPublicChangeObservationStatus("superseded")).toBe(true);
    expect(isPublicChangeObservationStatus("candidate")).toBe(false);
    expect(isPublicChangeObservationStatus(null)).toBe(false);
  });

  it("formats relative timestamps from the supplied observation time", () => {
    expect(formatRelativeTime("2026-08-23T11:00:00.000Z", now)).toBe("1h ago");
    expect(formatRelativeTime("2026-08-24T12:00:00.000Z", now)).toBe("In 1d");
  });

  it("counts only the events in the loaded page", () => {
    expect(countEventTypes([
      change(),
      change({ id: "5c8a4c02-f23d-4b85-9cb4-c2fe94f35b0c", eventType: "serving_changed", field: "serving" }),
      change({ id: "5c8a4c02-f23d-4b85-9cb4-c2fe94f35b0d", eventType: "serving_changed", field: "serving" }),
    ])).toEqual([
      { type: "caffeine_changed", count: 1 },
      { type: "serving_changed", count: 2 },
    ]);
  });
});
