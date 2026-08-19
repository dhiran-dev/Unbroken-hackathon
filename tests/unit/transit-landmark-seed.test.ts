import { describe, expect, it } from "vitest";

import {
  REVIEWED_TRANSIT_LANDMARKS,
  seedTransitLandmarks,
  type LandmarkSeedRow,
  type LandmarkSeedStore,
} from "../../src/server/transit/landmark-seed";

const expectedNames = [
  "Fisherman’s Wharf",
  "Pier 39",
  "Union Square",
  "Ferry Building",
  "Chinatown",
  "Moscone Center",
  "Oracle Park",
  "Chase Center",
  "Civic Center",
  "City Hall",
  "Salesforce Transit Center",
  "Golden Gate Park",
  "Ocean Beach",
  "Presidio",
  "Exploratorium",
  "de Young Museum",
  "California Academy of Sciences",
  "Castro",
  "Japantown",
  "UCSF Parnassus",
  "UCSF Mission Bay",
  "Zuckerberg San Francisco General",
  "Kaiser Geary",
  "Fort Mason",
] as const;

class MemoryLandmarkSeedStore implements LandmarkSeedStore {
  private rows: LandmarkSeedRow[] = [];

  async replaceReviewedLandmarks(rows: LandmarkSeedRow[]) {
    this.rows = structuredClone(rows);
  }

  readReviewedLandmarks() {
    return structuredClone(this.rows);
  }
}

describe("reviewed transit landmark seed", () => {
  it("contains exactly the 24 approved destination points with safe evidence", () => {
    expect(REVIEWED_TRANSIT_LANDMARKS.map((landmark) => landmark.name)).toEqual(
      expectedNames,
    );
    expect(new Set(REVIEWED_TRANSIT_LANDMARKS.map((row) => row.id)).size).toBe(
      24,
    );
    for (const landmark of REVIEWED_TRANSIT_LANDMARKS) {
      expect(landmark.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
      expect(landmark.latitude).toBeGreaterThanOrEqual(37.6);
      expect(landmark.latitude).toBeLessThanOrEqual(37.95);
      expect(landmark.longitude).toBeGreaterThanOrEqual(-122.65);
      expect(landmark.longitude).toBeLessThanOrEqual(-122.25);
      expect(new URL(landmark.evidenceUrl).protocol).toBe("https:");
      expect(landmark.stopIds).toEqual([]);
      expect(
        `${landmark.name} ${landmark.description} ${landmark.aliases.join(" ")}`,
      ).not.toMatch(/accessible|wheelchair|step[- ]?free|safe/i);
    }
  });

  it("replaces the reviewed set deterministically so repeated runs are idempotent", async () => {
    expect(() =>
      (REVIEWED_TRANSIT_LANDMARKS as unknown as LandmarkSeedRow[]).push(
        {} as LandmarkSeedRow,
      ),
    ).toThrow();
    expect(() =>
      (REVIEWED_TRANSIT_LANDMARKS[0]!.aliases as string[]).push("changed"),
    ).toThrow();
    REVIEWED_TRANSIT_LANDMARKS[0]!.reviewedAt.setTime(0);

    const store = new MemoryLandmarkSeedStore();
    await seedTransitLandmarks(store);
    const first = store.readReviewedLandmarks();
    await seedTransitLandmarks(store);
    const second = store.readReviewedLandmarks();

    expect(second).toEqual(first);
    expect(second).toHaveLength(24);
    expect(second.every((row) => row.active)).toBe(true);
    expect(
      second.every(
        (row) => row.reviewedAt.toISOString() === "2026-08-20T00:00:00.000Z",
      ),
    ).toBe(true);
  });
});
