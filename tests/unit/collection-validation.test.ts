import { describe, expect, it } from "vitest";

import { SFMTA_STATIONS } from "@/domain/collection/catalog";
import { parseSfmtaTimestamp } from "@/domain/collection/time";
import { validateCollectorDataset } from "@/domain/collection/validation";

const sourceUrl =
  "https://www.sfmta.com/elevator-status/elevatorstatus.php?src=prod";
const collectedAt = new Date("2026-08-18T11:05:00.000Z");

function syntheticPayload() {
  return [
    {
      elevators: SFMTA_STATIONS.flatMap((station, stationIndex) =>
        Array.from({ length: 3 }, (_, equipmentIndex) => ({
          station_name: station.sourceName,
          station_accessibility: "accessible" as const,
          equipment_name: `Elevator Synthetic ${stationIndex + 1}-${equipmentIndex + 1}`,
          equipment_type: "elevator" as const,
          equipment_status:
            stationIndex === 2 && equipmentIndex === 0
              ? ("out_of_service" as const)
              : ("in_service" as const),
          last_changed_text: "Last Changed 8/18/26, 3:30 am",
          source_valid_text: "Status valid as of 3:59 AM 8/18/26",
          source_url: sourceUrl,
        })),
      ),
      input: { url: sourceUrl },
    },
  ];
}

function validate(
  payload: unknown,
  previousStructuralFingerprint: string | null = null,
  observedAt = collectedAt,
) {
  return validateCollectorDataset({
    payload,
    collectedAt: observedAt,
    expectedSourceUrl: sourceUrl,
    previousStructuralFingerprint,
  });
}

describe("SFMTA timestamp parsing", () => {
  it("parses source-valid and last-changed Pacific timestamps", () => {
    expect(
      parseSfmtaTimestamp("Status valid as of 3:59 AM 8/18/26")?.toISOString(),
    ).toBe("2026-08-18T10:59:00.000Z");
    expect(
      parseSfmtaTimestamp("Last Changed 6/24/26, 6:16 am")?.toISOString(),
    ).toBe("2026-06-24T13:16:00.000Z");
  });
});

describe("collection safety contract", () => {
  it("accepts a complete fresh initial baseline", () => {
    const result = validate(syntheticPayload());
    expect(result.accepted).toBe(true);
    expect(result.report.rowCount).toBe(33);
    expect(result.report.stationCount).toBe(11);
    expect(result.report.structuralFingerprint).toHaveLength(64);
  });

  it("keeps a missing status unknown and rejects publication", () => {
    const payload = syntheticPayload();
    payload[0]!.elevators[0]!.equipment_status = null as never;
    const result = validate(payload);

    expect(result.accepted).toBe(false);
    expect(result.classification).toBe("ambiguous_contract_failure");
    expect(result.report.reasonCodes).toContain("CRITICAL_FIELDS_UNKNOWN");
    expect(result.report.statusCounts.unknown).toBe(1);
    expect(result.rows).toEqual([]);
  });

  it("rejects stale source evidence even when the shape is valid", () => {
    const result = validate(
      syntheticPayload(),
      null,
      new Date("2026-08-18T11:20:00.000Z"),
    );
    expect(result.accepted).toBe(false);
    expect(result.classification).toBe("source_stale");
    expect(result.report.reasonCodes).toContain("SOURCE_STALE");
  });

  it("keeps the fingerprint stable when row order changes", () => {
    const initial = validate(syntheticPayload());
    const reordered = syntheticPayload();
    reordered[0]!.elevators.reverse();
    const result = validate(
      reordered,
      initial.report.structuralFingerprint,
    );
    expect(result.accepted).toBe(true);
    expect(result.report.structuralFingerprint).toBe(
      initial.report.structuralFingerprint,
    );
  });

  it("freezes publication when an equipment identity changes", () => {
    const initial = validate(syntheticPayload());
    const drifted = syntheticPayload();
    drifted[0]!.elevators[0]!.equipment_name = "Elevator Invented Replacement";
    const result = validate(
      drifted,
      initial.report.structuralFingerprint,
    );

    expect(result.accepted).toBe(false);
    expect(result.classification).toBe("probable_layout_drift");
    expect(result.report.reasonCodes).toContain(
      "STRUCTURAL_FINGERPRINT_CHANGED",
    );
    expect(result.rows).toEqual([]);
  });
});
