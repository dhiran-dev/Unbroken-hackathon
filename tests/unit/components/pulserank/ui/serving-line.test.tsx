import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ServingLine, resolveServingLine } from "@/components/pulserank/ui/serving-line";
import type { ServingObservation } from "@/domain/product/contracts/observations";

function serving(
  overrides: Partial<ServingObservation> = {},
): ServingObservation {
  return {
    state: "present",
    value: null,
    unit: null,
    form: "unknown",
    normalizedMl: null,
    rawText: null,
    ...overrides,
  };
}

function render(observation: ServingObservation): string {
  return renderToStaticMarkup(<ServingLine serving={observation} />);
}

describe("resolveServingLine", () => {
  it("renders container units as '<normalizedMl> ml <container>'", () => {
    expect(
      resolveServingLine(serving({ unit: "can", normalizedMl: 250 })),
    ).toEqual({ kind: "text", text: "250 ml can" });
    expect(
      resolveServingLine(serving({ unit: "bottle", normalizedMl: 500 })),
    ).toEqual({ kind: "text", text: "500 ml bottle" });
  });

  it("falls back to rawText, then value, for containers without a volume", () => {
    expect(
      resolveServingLine(
        serving({ unit: "can", rawText: "one 12 fl oz can" }),
      ),
    ).toEqual({ kind: "text", text: "one 12 fl oz can" });
    expect(resolveServingLine(serving({ unit: "can", value: 1 }))).toEqual({
      kind: "text",
      text: "1 can",
    });
  });

  it("renders volume/mass units as '<value> <unit>'", () => {
    expect(resolveServingLine(serving({ unit: "ml", value: 60 }))).toEqual({
      kind: "text",
      text: "60 ml",
    });
    expect(resolveServingLine(serving({ unit: "g", value: 3 }))).toEqual({
      kind: "text",
      text: "3 g",
    });
  });

  it("renders per-item units as 'per <item>'", () => {
    expect(resolveServingLine(serving({ unit: "mint", value: 1 }))).toEqual({
      kind: "text",
      text: "per mint",
    });
    expect(resolveServingLine(serving({ unit: "candy", value: 1 }))).toEqual({
      kind: "text",
      text: "per candy piece",
    });
    expect(
      resolveServingLine(serving({ unit: "gum_piece", value: 1 })),
    ).toEqual({ kind: "text", text: "per gum piece" });
  });

  it("falls back to rawText for unknown units, else reports unparseable", () => {
    expect(
      resolveServingLine(serving({ unit: "unknown", rawText: "1 scoop" })),
    ).toEqual({ kind: "text", text: "1 scoop" });
    expect(resolveServingLine(serving({ unit: null }))).toEqual({
      kind: "unparseable",
    });
  });
});

describe("ServingLine", () => {
  it("renders the classic '250 ml can' line", () => {
    const html = render(serving({ unit: "can", normalizedMl: 250 }));
    expect(html).toContain("250 ml can");
    expect(html).toContain('data-unit="can"');
  });

  it("renders per-item serving lines", () => {
    expect(render(serving({ unit: "mint", value: 1 }))).toContain("per mint");
    expect(render(serving({ unit: "candy", value: 1 }))).toContain(
      "per candy piece",
    );
  });

  it("renders volume and mass serving lines", () => {
    expect(render(serving({ unit: "ml", value: 60 }))).toContain("60 ml");
    expect(render(serving({ unit: "g", value: 3 }))).toContain("3 g");
  });

  it("falls back to rawText when the unit is unknown", () => {
    expect(
      render(serving({ unit: "unknown", rawText: "1 scoop (5 g)" })),
    ).toContain("1 scoop (5 g)");
  });

  it("degrades to an unparseable badge when nothing is representable", () => {
    const html = render(serving({ unit: null }));
    expect(html).toContain(">Temporarily unavailable<");
    expect(html).toContain('data-state="unparseable"');
  });

  it("renders a FieldStateBadge for non-present states", () => {
    expect(render(serving({ state: "conflicting" }))).toContain(
      ">Conflicting values<",
    );
    expect(render(serving({ state: "not_published" }))).toContain(
      ">Not published<",
    );
  });
});
