import { describe, expect, it } from "vitest";

import { createAccessibilityEvidence } from "../../src/domain/journey/accessibility-evidence";
import {
  candidate,
  EVALUATED_AT,
  MemoryAccessibilityEvidenceSource,
  rideLeg,
  waitLeg,
} from "../support/accessibility-evidence";

describe("AccessibilityEvidence", () => {
  it("confirms a path between exact reviewed station stop identities when every required elevator group is working", async () => {
    const evidence = createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(),
    );

    const assessment = await evidence.evaluate(
      candidate([waitLeg(), rideLeg()]),
      EVALUATED_AT,
    );

    expect(assessment).toMatchObject({
      candidateId: "candidate-1",
      state: "confirmed",
      delaySeconds: 0,
      legs: [
        { legIndex: 0, type: "wait", state: "confirmed" },
        { legIndex: 1, type: "ride", state: "confirmed" },
      ],
    });
    expect(assessment.legs.flatMap((leg) => leg.dependencies)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "stop_access", state: "confirmed" }),
        expect.objectContaining({ kind: "trip_operation", state: "confirmed" }),
        expect.objectContaining({ kind: "service_alert", state: "confirmed" }),
      ]),
    );
  });
});
