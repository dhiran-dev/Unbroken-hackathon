import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ObservationValue } from "@/components/pulserank/ui/observation-value";
import type { ObservationValueInput } from "@/components/pulserank/ui/observation-value";
import type { FieldState } from "@/domain/product/contracts/field-states";

function observation(
  overrides: Partial<ObservationValueInput> = {},
): ObservationValueInput {
  return {
    state: "present",
    value: 42,
    min: null,
    max: null,
    qualifier: "exact",
    ...overrides,
  };
}

describe("ObservationValue", () => {
  it("renders present + exact as a plain number with the unit appended", () => {
    const html = renderToStaticMarkup(
      <ObservationValue observation={observation({ value: 75 })} unit="mg" />,
    );
    expect(html).toContain(">75<");
    expect(html).toContain(">mg<");
    expect(html).toContain('data-state="present"');
    expect(html).toContain('data-qualifier="exact"');
    // Exact values carry no qualifier tag.
    expect(html).not.toContain(">Range<");
    expect(html).not.toContain(">Approx.<");
  });

  it("renders present + range as an en-dash span with a Range tag", () => {
    const html = renderToStaticMarkup(
      <ObservationValue
        observation={observation({
          value: null,
          min: 75,
          max: 80,
          qualifier: "range",
        })}
        unit="mg"
      />,
    );
    expect(html).toContain(">75–80<");
    expect(html).toContain(">mg<");
    expect(html).toContain(">Range<");
  });

  it("prefixes approximate values with ~ and an Approx. tag", () => {
    const html = renderToStaticMarkup(
      <ObservationValue
        observation={observation({ value: 95, qualifier: "approximate" })}
        unit="kcal"
      />,
    );
    expect(html).toContain(">~95<");
    expect(html).toContain(">kcal<");
    expect(html).toContain(">Approx.<");
  });

  it("prefixes estimated values with est. and an Est. tag", () => {
    const html = renderToStaticMarkup(
      <ObservationValue
        observation={observation({ value: 12, qualifier: "estimated" })}
        unit="g"
      />,
    );
    expect(html).toContain(">est. 12<");
    expect(html).toContain(">g<");
    expect(html).toContain(">Est.<");
  });

  it("marks unknown-qualifier values with an Unknown tag", () => {
    const html = renderToStaticMarkup(
      <ObservationValue
        observation={observation({ value: 5, qualifier: "unknown" })}
        unit="ml"
      />,
    );
    expect(html).toContain(">5<");
    expect(html).toContain(">Unknown<");
  });

  it("trims decimal noise to two places", () => {
    const html = renderToStaticMarkup(
      <ObservationValue
        observation={observation({ value: 95.00000001 })}
        unit="mg"
      />,
    );
    expect(html).toContain(">95<");
  });

  it("renders a FieldStateBadge for every non-present state", () => {
    const expected: Record<Exclude<FieldState, "present">, string> = {
      not_published: ">Not published<",
      unparseable: ">Temporarily unavailable<",
      conflicting: ">Conflicting values<",
      not_applicable: ">N/A<",
    };

    for (const [state, label] of Object.entries(expected)) {
      const html = renderToStaticMarkup(
        <ObservationValue
          observation={observation({ state: state as FieldState })}
          unit="mg"
        />,
      );
      expect(html, `state ${state}`).toContain(label);
      expect(html, `state ${state}`).toContain(`data-state="${state}"`);
      // A badge never smuggles a value or unit through.
      expect(html, `state ${state}`).not.toContain(">mg<");
    }
  });
});
