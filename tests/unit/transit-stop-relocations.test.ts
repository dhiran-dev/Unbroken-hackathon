import { describe, expect, it } from "vitest";

import {
  STOP_RELOCATION_COLLECTOR_ID,
  STOP_RELOCATION_SOURCE_URL,
  readStopRelocations,
  refreshStopRelocations,
  type StopRelocationRefreshAttempt,
  type StopRelocationRefreshResult,
  type StopRelocationStore,
  type StoredStopRelocationSnapshot,
} from "@/server/transit/stop-relocations";
import { stopRelocationEnvelope } from "../support/stop-relocations";

class MemoryStopRelocationStore implements StopRelocationStore {
  attempts: StopRelocationRefreshAttempt[] = [];
  latest: {
    status: "current" | "rejected" | "unavailable";
    checkedAt: Date;
  } | null = null;

  constructor(public current: StoredStopRelocationSnapshot | null = null) {}

  async getCurrentSnapshot() {
    return this.current;
  }

  async getLatestAttempt() {
    return this.latest;
  }

  async applyRefreshAttempt(
    attempt: StopRelocationRefreshAttempt,
  ): Promise<StopRelocationRefreshResult> {
    this.attempts.push(attempt);
    if (
      attempt.basedOnSnapshotId !== (this.current?.snapshotId ?? null) ||
      (this.current !== null && attempt.checkedAt < this.current.checkedAt)
    ) {
      return { status: "rejected", activeSnapshot: this.current };
    }
    if (attempt.status !== "validated") {
      this.latest = { status: attempt.status, checkedAt: attempt.checkedAt };
      return { status: attempt.status, activeSnapshot: this.current };
    }
    const unchanged = this.current?.payloadHash === attempt.payloadHash;
    this.current = {
      snapshotId: unchanged ? this.current!.snapshotId : "relocations-new",
      payloadHash: attempt.payloadHash,
      structuralFingerprint: attempt.structuralFingerprint,
      checkedAt: attempt.checkedAt,
      sourceUpdatedAt: attempt.sourceUpdatedAt,
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
      relocations: attempt.relocations,
    };
    this.latest = { status: "current", checkedAt: attempt.checkedAt };
    return {
      status: unchanged ? "unchanged" : "promoted",
      activeSnapshot: this.current,
    };
  }
}

describe("stop relocation refresh", () => {
  it("publishes all six normalized rows with distinct source times", async () => {
    const store = new MemoryStopRelocationStore();

    const result = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope(),
          }),
        },
        store,
      },
    );

    expect(result.activeSnapshot?.relocations).toHaveLength(6);
    expect(result).toMatchObject({
      status: "promoted",
      activeSnapshot: {
        checkedAt: new Date("2026-08-20T01:00:00.000Z"),
        sourceUpdatedAt: new Date("2026-08-20T00:30:00.000Z"),
        sourceUrl: STOP_RELOCATION_SOURCE_URL,
        relocations: expect.arrayContaining([
          expect.objectContaining({
            stopId: "11001",
            applicant: null,
            routeNames: ["Inbound 12", "Inbound 14"],
            latitude: null,
            longitude: null,
            boardingInstruction:
              "Board at the marked temporary stop 1. SFMTA says this stop is closing today. This move applies Jul 13 through Aug 28, on Mon, Tue, Wed, Thu, and Fri, from 7:30 am to 6:00 pm.",
          }),
        ]),
      },
    });
  });

  it("keeps duplicate stop IDs when their destinations differ and normalizes blank applicants", async () => {
    const envelope = stopRelocationEnvelope();
    envelope.stopRelocationData[1] = {
      ...envelope.stopRelocationData[1]!,
      StopID: envelope.stopRelocationData[0]!.StopID,
      Applicant: "",
    };
    const store = new MemoryStopRelocationStore();
    const result = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope,
          }),
        },
        store,
      },
    );

    const duplicates = result.activeSnapshot?.relocations.filter(
      (row) => row.stopId === "11001",
    );
    expect(duplicates).toHaveLength(2);
    expect(new Set(duplicates?.map((row) => row.rowId)).size).toBe(2);
    expect(duplicates?.map((row) => row.applicant)).toEqual([null, null]);
    expect(duplicates?.every((row) => row.latitude === null)).toBe(true);
  });

  it("interprets yearless dates conservatively and rejects invalid dates", async () => {
    const rollover = stopRelocationEnvelope({ Dates: "Dec 30 - Jan 2" });
    const store = new MemoryStopRelocationStore();
    const accepted = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope: rollover,
          }),
        },
        store,
      },
    );
    expect(accepted.activeSnapshot?.relocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startsAt: new Date("2026-12-30T08:00:00.000Z"),
          endsAt: new Date("2027-01-03T07:59:59.999Z"),
        }),
      ]),
    );

    const explicit = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:09:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:10:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope({
              Dates: "12/30/2026 - 01/02/2027",
            }),
          }),
        },
        store: new MemoryStopRelocationStore(),
      },
    );
    expect(explicit.activeSnapshot?.relocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          startsAt: new Date("2026-12-30T08:00:00.000Z"),
          endsAt: new Date("2027-01-03T07:59:59.999Z"),
        }),
      ]),
    );

    const invalid = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:09:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:10:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope({ Dates: "Aug 28 - Jul 13" }),
          }),
        },
        store,
      },
    );
    expect(invalid.status).toBe("rejected");
    expect(store.attempts.at(-1)).toMatchObject({
      validationReport: {
        reasons: expect.arrayContaining([
          expect.objectContaining({ code: "INVALID_DATE" }),
        ]),
      },
    });
  });

  it("rejects empty, contracted, exact-duplicate, and layout-drift responses while retaining current rows", async () => {
    const store = new MemoryStopRelocationStore();
    const collect = async (envelope: unknown, datasetComplete = true) =>
      refreshStopRelocations(
        { at: new Date("2026-08-20T00:59:00.000Z") },
        {
          collector: {
            collect: async () => ({
              collectorId: STOP_RELOCATION_COLLECTOR_ID,
              sourceUrl: STOP_RELOCATION_SOURCE_URL,
              collectedAt: new Date("2026-08-20T01:00:00.000Z"),
              datasetComplete,
              envelope,
            }),
          },
          store,
        },
      );
    const trusted = await collect(stopRelocationEnvelope());
    const empty = await collect(null, false);
    const contractedEnvelope = stopRelocationEnvelope();
    contractedEnvelope.stopRelocationData =
      contractedEnvelope.stopRelocationData.slice(0, 5);
    const contracted = await collect(contractedEnvelope);
    const duplicateEnvelope = stopRelocationEnvelope();
    duplicateEnvelope.stopRelocationData[5] = {
      ...duplicateEnvelope.stopRelocationData[0]!,
    };
    const duplicate = await collect(duplicateEnvelope);
    const driftEnvelope = stopRelocationEnvelope() as Record<string, unknown>;
    driftEnvelope.unexpected = true;
    const drift = await collect(driftEnvelope);

    for (const result of [empty, contracted, duplicate, drift]) {
      expect(result.status).toBe("rejected");
      expect(result.activeSnapshot).toBe(trusted.activeSnapshot);
    }
    expect(store.current).toBe(trusted.activeSnapshot);
  });

  it("aggregates unsafe identity, metadata, collection time, and coordinate failures without raw values", async () => {
    const envelope = stopRelocationEnvelope({
      Status: "Mystery",
      StopID: "not-stop",
      StopName: "<script>private()</script>",
    });
    envelope.metadata.lastCompiled = "not-a-date";
    const store = new MemoryStopRelocationStore();
    const result = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: "wrong-collector",
            sourceUrl: "https://example.com/private",
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope,
            coordinates: { 0: { latitude: 0, longitude: 0 } },
          }),
        },
        store,
      },
    );

    expect(result.status).toBe("rejected");
    const attempt = store.attempts[0];
    const codes =
      attempt?.status === "rejected"
        ? attempt.validationReport.reasons.map((reason) => reason.code)
        : [];
    expect(codes).toEqual(
      expect.arrayContaining([
        "COLLECTOR_ID_MISMATCH",
        "SOURCE_URL_MISMATCH",
        "INVALID_SOURCE_TIME",
        "INVALID_STATUS",
        "INVALID_STOP_ID",
        "INVALID_TEXT",
        "INVALID_DATE",
        "INVALID_COORDINATES",
      ]),
    );
    expect(JSON.stringify(attempt)).not.toContain("private()");
    expect(JSON.stringify(attempt)).not.toContain("example.com");
  });

  it("keeps an order-independent hash and revalidates unchanged rows when SFMTA time advances", async () => {
    const store = new MemoryStopRelocationStore();
    const firstEnvelope = stopRelocationEnvelope();
    const secondEnvelope = stopRelocationEnvelope();
    secondEnvelope.metadata.lastCompiled = "2026-08-20T00:40:00.000Z";
    secondEnvelope.stopRelocationData.reverse();
    let call = 0;
    const dependencies = {
      collector: {
        collect: async () => {
          call += 1;
          return {
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date(
              call === 1
                ? "2026-08-20T01:00:00.000Z"
                : "2026-08-20T01:10:00.000Z",
            ),
            datasetComplete: true,
            envelope: call === 1 ? firstEnvelope : secondEnvelope,
          };
        },
      },
      store,
    };
    const first = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      dependencies,
    );
    const second = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:09:00.000Z") },
      dependencies,
    );

    expect(second).toMatchObject({
      status: "unchanged",
      activeSnapshot: {
        payloadHash: first.activeSnapshot?.payloadHash,
        checkedAt: new Date("2026-08-20T01:10:00.000Z"),
        sourceUpdatedAt: new Date("2026-08-20T00:40:00.000Z"),
      },
    });
    expect(store.attempts).toHaveLength(2);
  });

  it("rejects stale concurrent baselines", async () => {
    const store = new MemoryStopRelocationStore();
    const first = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope(),
          }),
        },
        store,
      },
    );
    const winner = {
      ...first.activeSnapshot!,
      snapshotId: "winner",
      payloadHash: "winner-hash",
      checkedAt: new Date("2026-08-20T01:20:00.000Z"),
    };
    const result = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:09:00.000Z") },
      {
        collector: {
          collect: async () => {
            store.current = winner;
            return {
              collectorId: STOP_RELOCATION_COLLECTOR_ID,
              sourceUrl: STOP_RELOCATION_SOURCE_URL,
              collectedAt: new Date("2026-08-20T01:10:00.000Z"),
              datasetComplete: true,
              envelope: stopRelocationEnvelope({
                TemporaryStop: "another stop",
              }),
            };
          },
        },
        store,
      },
    );
    expect(result).toEqual({ status: "rejected", activeSnapshot: winner });
    expect(store.current).toBe(winner);
  });

  it("uses both source times for freshness and omits applicant from the public view", async () => {
    const store = new MemoryStopRelocationStore();
    await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope(),
          }),
        },
        store,
      },
    );
    const current = await readStopRelocations(
      { at: new Date("2026-08-20T01:29:00.000Z") },
      { store },
    );
    const older = await readStopRelocations(
      { at: new Date("2026-08-20T01:31:00.001Z") },
      { store },
    );

    expect(current).toMatchObject({
      state: "current",
      checkedAt: new Date("2026-08-20T01:00:00.000Z"),
      sourceUpdatedAt: new Date("2026-08-20T00:30:00.000Z"),
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
    });
    expect(older.state).toBe("older");
    expect(JSON.stringify(current)).not.toContain("Applicant");
    expect(JSON.stringify(current)).not.toContain("Project");
    expect(
      current.relocations[0]?.boardingInstruction.startsWith("Board at "),
    ).toBe(true);
  });

  it("accepts an absent applicant and optional valid coordinate but rejects row drift and future collection time", async () => {
    const envelope = stopRelocationEnvelope();
    delete (
      envelope.stopRelocationData[0] as Partial<
        (typeof envelope.stopRelocationData)[number]
      >
    ).Applicant;
    const store = new MemoryStopRelocationStore();
    const trusted = await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope,
            coordinates: {
              0: { latitude: 37.78, longitude: -122.42 },
            },
          }),
        },
        store,
      },
    );
    expect(trusted.activeSnapshot?.relocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          applicant: null,
          latitude: 37.78,
          longitude: -122.42,
        }),
      ]),
    );

    const driftEnvelope = stopRelocationEnvelope();
    const driftRow = driftEnvelope.stopRelocationData[0] as Record<
      string,
      unknown
    >;
    driftRow.unexpected = true;
    const drift = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:09:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:10:00.000Z"),
            datasetComplete: true,
            envelope: driftEnvelope,
          }),
        },
        store,
      },
    );
    const future = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:19:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T02:00:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope(),
          }),
        },
        store,
      },
    );
    expect(drift.status).toBe("rejected");
    expect(future.status).toBe("rejected");
    expect(store.current).toBe(trusted.activeSnapshot);
  });

  it("returns unavailable without trusted rows and marks retained rows older after a failed latest check", async () => {
    const store = new MemoryStopRelocationStore();
    await expect(
      readStopRelocations(
        { at: new Date("2026-08-20T01:00:00.000Z") },
        { store },
      ),
    ).resolves.toEqual({
      state: "unavailable",
      checkedAt: null,
      sourceUpdatedAt: null,
      sourceUrl: STOP_RELOCATION_SOURCE_URL,
      relocations: [],
    });
    await refreshStopRelocations(
      { at: new Date("2026-08-20T00:59:00.000Z") },
      {
        collector: {
          collect: async () => ({
            collectorId: STOP_RELOCATION_COLLECTOR_ID,
            sourceUrl: STOP_RELOCATION_SOURCE_URL,
            collectedAt: new Date("2026-08-20T01:00:00.000Z"),
            datasetComplete: true,
            envelope: stopRelocationEnvelope(),
          }),
        },
        store,
      },
    );
    const failed = await refreshStopRelocations(
      { at: new Date("2026-08-20T01:10:00.000Z") },
      {
        collector: {
          collect: async () => Promise.reject(new Error("private")),
        },
        store,
      },
    );
    const view = await readStopRelocations(
      { at: new Date("2026-08-20T01:11:00.000Z") },
      { store },
    );
    expect(failed.status).toBe("unavailable");
    expect(view.state).toBe("older");
    expect(view.relocations).toHaveLength(6);
    expect(JSON.stringify(view)).not.toContain("Project");
    expect(JSON.stringify(failed)).not.toContain("private");
  });
});
