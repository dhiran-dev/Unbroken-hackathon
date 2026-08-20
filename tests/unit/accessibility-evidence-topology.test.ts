import { describe, expect, it } from "vitest";

import { createAccessibilityEvidence } from "../../src/domain/journey/accessibility-evidence";
import {
  candidate,
  evidenceSnapshot,
  EVALUATED_AT,
  MemoryAccessibilityEvidenceSource,
  rideLeg,
  waitLeg,
} from "../support/accessibility-evidence";

describe("AccessibilityEvidence reviewed elevator topology", () => {
  it("confirms an alternative group when one exact reviewed elevator still works", async () => {
    const snapshot = evidenceSnapshot();
    const powell = snapshot.elevators.stations.find(
      (station) => station.stationId === "powell",
    )!;
    powell.elevators.find(
      (elevator) =>
        elevator.equipmentId === "sfmta:155fa9cd88ca1b910f173175e6d47c76",
    )!.state = "out_of_service";

    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([waitLeg(), rideLeg()]), EVALUATED_AT);

    expect(assessment.state).toBe("confirmed");
  });

  it("uses the exact Market stop direction and never substitutes a working opposite-platform elevator", async () => {
    const snapshot = evidenceSnapshot();
    snapshot.elevators.stations.push({
      stationId: "church",
      state: "limited",
      elevators: [
        {
          equipmentId: "sfmta:0154ad6b41748e64880991aa412ade28",
          state: "working",
        },
        {
          equipmentId: "sfmta:35427ea962ccd42a3ccc8f6ce0da9bb0",
          state: "out_of_service",
        },
        {
          equipmentId: "sfmta:e48d37881926844313cf06ad18295600",
          state: "working",
        },
      ],
    });
    const baseRide = rideLeg();
    const eastboundRide = rideLeg({
      from: { ...baseRide.from, stopId: "15726" },
    });

    const assessment = await createAccessibilityEvidence(
      new MemoryAccessibilityEvidenceSource(snapshot),
    ).evaluate(candidate([waitLeg("15726"), eastboundRide]), EVALUATED_AT);

    expect(assessment.state).toBe("blocked");
    expect(assessment.legs[0]!.dependencies[0]).toMatchObject({
      reasons: [
        {
          code: "ELEVATOR_OUT_OF_SERVICE",
          entityId: "sfmta:35427ea962ccd42a3ccc8f6ce0da9bb0",
        },
      ],
    });
  });
});
