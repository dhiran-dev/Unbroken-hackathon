import { describe, expect, it } from "vitest";

import type { PublicAccessibility } from "../../src/domain/accessibility/model";
import { createAccessibilityElevatorReader } from "../../src/server/journey/accessibility-elevator-read";
import { EVALUATED_AT } from "../support/accessibility-evidence";

const publicAccessibility: PublicAccessibility = {
  trust: {
    state: "current",
    sourceValidAt: new Date("2026-08-20T11:45:00.000Z"),
    ageSeconds: 900,
  },
  counts: { accessible: 0, limited: 0, unavailable: 0, unknown: 0 },
  stations: [],
};

describe("accessibility elevator read provenance", () => {
  it("keeps trusted collection checkedAt separate from sourceValidAt", async () => {
    const read = createAccessibilityElevatorReader({
      readMetadata: async () => ({
        snapshotId: "snapshot-1",
        sourceValidAt: new Date("2026-08-20T11:45:00.000Z"),
        checkedAt: new Date("2026-08-20T11:58:00.000Z"),
      }),
      readPublic: async () => publicAccessibility,
    });
    await expect(read(EVALUATED_AT)).resolves.toEqual({
      accessibility: publicAccessibility,
      checkedAt: new Date("2026-08-20T11:58:00.000Z"),
    });
  });

  it.each([
    [
      "snapshot changed",
      {
        snapshotId: "snapshot-2",
        sourceValidAt: new Date("2026-08-20T11:45:00.000Z"),
        checkedAt: EVALUATED_AT,
      },
    ],
    [
      "source time changed",
      {
        snapshotId: "snapshot-1",
        sourceValidAt: new Date("2026-08-20T11:46:00.000Z"),
        checkedAt: EVALUATED_AT,
      },
    ],
  ])("fails closed when %s during the read", async (_name, after) => {
    let reads = 0;
    const read = createAccessibilityElevatorReader({
      readMetadata: async () => {
        reads += 1;
        return reads === 1
          ? {
              snapshotId: "snapshot-1",
              sourceValidAt: new Date("2026-08-20T11:45:00.000Z"),
              checkedAt: new Date("2026-08-20T11:58:00.000Z"),
            }
          : after;
      },
      readPublic: async () => publicAccessibility,
    });
    await expect(read(EVALUATED_AT)).resolves.toBeNull();
  });

  it("fails closed when public data does not match trusted metadata", async () => {
    const read = createAccessibilityElevatorReader({
      readMetadata: async () => ({
        snapshotId: "snapshot-1",
        sourceValidAt: new Date("2026-08-20T11:44:00.000Z"),
        checkedAt: EVALUATED_AT,
      }),
      readPublic: async () => publicAccessibility,
    });
    await expect(read(EVALUATED_AT)).resolves.toBeNull();
  });
});
