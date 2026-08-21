import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { QualifierTag } from "@/components/pulserank/ui/qualifier-tag";

describe("QualifierTag", () => {
  it("labels range, approximate, estimated and unknown qualifiers", () => {
    expect(renderToStaticMarkup(<QualifierTag qualifier="range" />)).toContain(
      ">Range<",
    );
    expect(
      renderToStaticMarkup(<QualifierTag qualifier="approximate" />),
    ).toContain(">Approx.<");
    expect(
      renderToStaticMarkup(<QualifierTag qualifier="estimated" />),
    ).toContain(">Est.<");
    expect(
      renderToStaticMarkup(<QualifierTag qualifier="unknown" />),
    ).toContain(">Unknown<");
  });

  it("renders nothing for exact values", () => {
    expect(renderToStaticMarkup(<QualifierTag qualifier="exact" />)).toBe("");
  });

  it("marks the qualifier for styling and tests", () => {
    expect(
      renderToStaticMarkup(<QualifierTag qualifier="range" />),
    ).toContain('data-qualifier="range"');
  });

  it("supports sm and md size variants", () => {
    expect(renderToStaticMarkup(<QualifierTag qualifier="range" size="sm" />))
      .toContain('data-size="sm"');
    expect(renderToStaticMarkup(<QualifierTag qualifier="range" size="md" />))
      .toContain('data-size="md"');
  });
});
