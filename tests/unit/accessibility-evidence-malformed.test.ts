import { expect, it } from "vitest";

import {
  createAccessibilityEvidence,
  type AccessibilityEvidenceSnapshot,
} from "../../src/domain/journey/accessibility-evidence";
import {
  candidate,
  EVALUATED_AT,
  evidenceSnapshot,
  rideLeg,
} from "../support/accessibility-evidence";

it("fails a malformed evidence snapshot closed to typed unknown without exposing private detail", async () => {
  const evidence = createAccessibilityEvidence({
    async read() {
      return {
        elevators: { privateDetail: "database internals" },
      } as unknown as AccessibilityEvidenceSnapshot;
    },
  });

  const assessment = await evidence.evaluate(
    candidate([rideLeg()]),
    EVALUATED_AT,
  );

  expect(assessment.state).toBe("unknown");
  expect(
    assessment.sources.every((source) => source.state === "unavailable"),
  ).toBe(true);
  expect(JSON.stringify(assessment)).not.toContain("database internals");
});

it("fails a malformed trusted entity closed instead of confirming its source", async () => {
  const snapshot = evidenceSnapshot();
  snapshot.tripUpdates.updates = [{}] as never;
  const evidence = createAccessibilityEvidence({ read: async () => snapshot });

  const assessment = await evidence.evaluate(
    candidate([rideLeg()]),
    EVALUATED_AT,
  );

  expect(assessment.state).toBe("unknown");
  expect(
    assessment.sources.every((source) => source.state === "unavailable"),
  ).toBe(true);
});

it("replaces untrusted provenance URLs with the fixed public source", async () => {
  const snapshot = evidenceSnapshot();
  snapshot.alerts.sourceUrl = "https://private.internal/alerts";
  const evidence = createAccessibilityEvidence({ read: async () => snapshot });

  const assessment = await evidence.evaluate(
    candidate([rideLeg()]),
    EVALUATED_AT,
  );

  expect(assessment.state).toBe("unknown");
  expect(JSON.stringify(assessment)).not.toContain("private.internal");
  expect(
    assessment.sources.every((source) => source.state === "unavailable"),
  ).toBe(true);
});

it("does not confirm a source that lacks its checked time", async () => {
  const snapshot = evidenceSnapshot();
  snapshot.guides.checkedAt = null;
  const evidence = createAccessibilityEvidence({ read: async () => snapshot });

  const assessment = await evidence.evaluate(
    candidate([rideLeg()]),
    EVALUATED_AT,
  );

  expect(assessment.state).toBe("unknown");
  expect(
    assessment.sources.every((source) => source.state === "unavailable"),
  ).toBe(true);
});

it("rejects structurally malformed candidates with the stable public error", async () => {
  const evidence = createAccessibilityEvidence({
    read: async () => evidenceSnapshot(),
  });
  const malformed = candidate([rideLeg()]);
  malformed.legs = [null] as never;

  await expect(
    evidence.evaluate(malformed, EVALUATED_AT),
  ).rejects.toMatchObject({
    code: "ACCESSIBILITY_EVIDENCE_INVALID",
    message: "The journey candidate or evaluation time is invalid.",
  });
});
