import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  FIELD_STATE_BADGE_COPY,
  FieldStateBadge,
  type NonPresentFieldState,
} from "@/components/pulserank/ui/field-state-badge";

const STATES = Object.keys(
  FIELD_STATE_BADGE_COPY,
) as NonPresentFieldState[];

function render(state: NonPresentFieldState, size?: "sm" | "md"): string {
  return renderToStaticMarkup(
    <FieldStateBadge state={state} size={size} />,
  );
}

function classAttributeOf(html: string): string {
  const match = /class="([^"]*)"/.exec(html);
  expect(match, "expected a class attribute in rendered markup").not.toBeNull();
  return match?.[1] ?? "";
}

describe("FieldStateBadge", () => {
  it("renders the short label for every non-present state", () => {
    for (const state of STATES) {
      const html = render(state);
      expect(html).toContain(`>${FIELD_STATE_BADGE_COPY[state].label}<`);
      expect(html).toContain(`data-state="${state}"`);
    }
  });

  it("exposes label plus full explanation via aria-label", () => {
    for (const state of STATES) {
      const { label, explanation } = FIELD_STATE_BADGE_COPY[state];
      expect(render(state)).toContain(
        `aria-label="${label}: ${explanation}"`,
      );
    }
  });

  it("gives each state a visually distinct treatment", () => {
    const classes = new Map<NonPresentFieldState, string>();
    for (const state of STATES) {
      classes.set(state, classAttributeOf(render(state)));
    }

    // Every pair of states must differ in styling.
    for (let i = 0; i < STATES.length; i += 1) {
      for (let j = i + 1; j < STATES.length; j += 1) {
        expect(classes.get(STATES[i]!)).not.toBe(classes.get(STATES[j]!));
      }
    }

    // Shape markers: dashed square / filled pill / sharp rectangle / hollow pill.
    expect(classes.get("not_published")).toContain("border-dashed");
    expect(classes.get("unparseable")).toContain("rounded-full");
    expect(classes.get("conflicting")).toContain("rounded-none");
    expect(classes.get("not_applicable")).toContain("rounded-full");

    // Marker glyphs so color never carries meaning alone.
    expect(render("unparseable")).toContain(">!<");
    expect(render("conflicting")).toContain("≠");
  });

  it("supports sm and md size variants", () => {
    expect(render("conflicting", "sm")).toContain('data-size="sm"');
    expect(render("conflicting", "md")).toContain('data-size="md"');

    const smClass = classAttributeOf(render("conflicting", "sm"));
    const mdClass = classAttributeOf(render("conflicting", "md"));
    expect(smClass).not.toBe(mdClass);
  });
});
