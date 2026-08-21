import { describe, expect, it, vi } from "vitest";

import {
  dispatch,
  isLegacyDeniedJobName,
  isPulseJobName,
  LEGACY_JOB_DENYLIST,
  pulseJobHandlers,
  PULSE_JOB_NAMES,
} from "@/server/jobs/pulse-jobs";
import {
  COLLECT_JOB_FLAG_REQUIREMENTS,
  createInMemoryPulseJobQueue,
  evaluateCollectJobGate,
  startPulseWorker,
} from "@/worker/pulse-worker";

const DISABLED_FLAGS = { collectionEnabled: false, discoveryEnabled: false };
const ENABLED_FLAGS = { collectionEnabled: true, discoveryEnabled: true };

describe("legacy job denylist", () => {
  it("contains exactly the seven legacy UNBROKEN job names", () => {
    expect([...LEGACY_JOB_DENYLIST]).toEqual([
      "collect-elevator-status",
      "refresh-gtfs",
      "refresh-accessibility-advisories",
      "refresh-stop-relocations",
      "refresh-stop-guides",
      "journey-refresh",
      "commute-notification",
    ]);
  });

  it.each([...LEGACY_JOB_DENYLIST])(
    "rejects denylisted job %s without executing anything",
    async (name) => {
      await expect(dispatch({ name, payload: {} })).resolves.toEqual({
        accepted: false,
        reason: "legacy_or_unknown_job_rejected",
      });
      expect(isLegacyDeniedJobName(name)).toBe(true);
      expect(isPulseJobName(name)).toBe(false);
    },
  );

  it("rejects legacy names even with pulse-prefixed casing tricks", async () => {
    for (const name of ["Collect-Elevator-Status", "REFRESH-GTFS", `pulse.${LEGACY_JOB_DENYLIST[0]}`]) {
      await expect(dispatch({ name })).resolves.toEqual({
        accepted: false,
        reason: "legacy_or_unknown_job_rejected",
      });
    }
  });
});

describe("fail-closed dispatch of unknown jobs", () => {
  it.each([
    "collect_sfmta_elevators",
    "incident_heal",
    "expire_raw_payloads",
    "",
    "pulse",
    "pulse.",
    "pulse.unknown",
    "pulse.collect",
    "PULSE.COLLECT.SAMPLE",
    "pulse.collect.sample ",
  ])("rejects unknown job name %j", async (name) => {
    await expect(dispatch({ name })).resolves.toEqual({
      accepted: false,
      reason: "legacy_or_unknown_job_rejected",
    });
  });

  it("rejects malformed requests instead of throwing", async () => {
    const malformed: unknown[] = [undefined, null, 42, {}, { name: 7 }];
    for (const request of malformed) {
      await expect(
        dispatch(request as Parameters<typeof dispatch>[0]),
      ).resolves.toMatchObject({
        accepted: false,
        reason: "legacy_or_unknown_job_rejected",
      });
    }
  });
});

describe("pulse.* job acceptance", () => {
  it("defines exactly the twelve PulseRank job names", () => {
    expect(PULSE_JOB_NAMES).toHaveLength(12);
    for (const name of PULSE_JOB_NAMES) {
      expect(name.startsWith("pulse.")).toBe(true);
    }
  });

  it.each([...PULSE_JOB_NAMES])(
    "accepts %s with a not_implemented stub result",
    async (name) => {
      const result = await dispatch({ name, payload: { any: "payload" } });
      expect(result).toEqual({
        accepted: true,
        result: { status: "not_implemented", job: name },
      });
    },
  );

  it("has a registered handler for every pulse job and no extras", () => {
    expect(Object.keys(pulseJobHandlers).sort()).toEqual(
      [...PULSE_JOB_NAMES].sort(),
    );
    for (const handler of Object.values(pulseJobHandlers)) {
      expect(typeof handler).toBe("function");
    }
  });

  it("tolerates missing or non-object payloads", async () => {
    await expect(dispatch({ name: "pulse.retention" })).resolves.toMatchObject({
      accepted: true,
    });
    await expect(
      dispatch({ name: "pulse.retention", payload: "not-an-object" }),
    ).resolves.toMatchObject({ accepted: true, result: { status: "not_implemented" } });
  });
});

describe("collect job flag gating", () => {
  it("maps each collect job to its backing env flag", () => {
    expect(COLLECT_JOB_FLAG_REQUIREMENTS["pulse.collect.sample"].env).toBe(
      "PULSERANK_COLLECTION_ENABLED",
    );
    expect(COLLECT_JOB_FLAG_REQUIREMENTS["pulse.collect.refresh-batch"].env).toBe(
      "PULSERANK_COLLECTION_ENABLED",
    );
    expect(COLLECT_JOB_FLAG_REQUIREMENTS["pulse.collect.discovery"].env).toBe(
      "PULSERANK_DISCOVERY_ENABLED",
    );
  });

  it("blocks every collect job when its flag is disabled", () => {
    for (const collectName of [
      "pulse.collect.sample",
      "pulse.collect.refresh-batch",
      "pulse.collect.discovery",
    ] as const) {
      expect(evaluateCollectJobGate(collectName, DISABLED_FLAGS)).toMatchObject({
        allowed: false,
      });
    }
    expect(evaluateCollectJobGate("pulse.collect.sample", DISABLED_FLAGS)).toEqual({
      allowed: false,
      flag: "collectionEnabled",
      env: "PULSERANK_COLLECTION_ENABLED",
    });
    expect(evaluateCollectJobGate("pulse.collect.discovery", DISABLED_FLAGS)).toEqual({
      allowed: false,
      flag: "discoveryEnabled",
      env: "PULSERANK_DISCOVERY_ENABLED",
    });
  });

  it("allows collect jobs when their flag is enabled", () => {
    expect(evaluateCollectJobGate("pulse.collect.sample", ENABLED_FLAGS)).toEqual({
      allowed: true,
    });
    expect(evaluateCollectJobGate("pulse.collect.refresh-batch", ENABLED_FLAGS)).toEqual(
      { allowed: true },
    );
    expect(evaluateCollectJobGate("pulse.collect.discovery", ENABLED_FLAGS)).toEqual({
      allowed: true,
    });
  });

  it("never gates non-collect pulse jobs on collection flags", () => {
    for (const name of PULSE_JOB_NAMES) {
      if (name.startsWith("pulse.collect.")) continue;
      expect(evaluateCollectJobGate(name, DISABLED_FLAGS)).toEqual({ allowed: true });
    }
  });
});

describe("worker loop skeleton", () => {
  function makeWorker(overrides?: {
    flags?: { collectionEnabled: boolean; discoveryEnabled: boolean };
    jobs?: Parameters<typeof createInMemoryPulseJobQueue>[0];
  }) {
    const queue = createInMemoryPulseJobQueue(overrides?.jobs ?? []);
    const logs: string[] = [];
    const handle = startPulseWorker({
      queue,
      flags: () => overrides?.flags ?? DISABLED_FLAGS,
      pollIntervalMs: 1,
      workerId: "test-worker",
      installSignalHandlers: false,
      log: (line) => logs.push(line),
      logError: (line) => logs.push(line),
    });
    return { queue, logs, handle };
  }

  it("skips a collect job with a log line when PULSERANK_COLLECTION_ENABLED is off", async () => {
    const { queue, logs, handle } = makeWorker({
      jobs: [{ id: "job-1", name: "pulse.collect.sample", payload: {} }],
    });

    await vi.waitFor(() => {
      expect(queue.settled()).toHaveLength(1);
    });
    await handle.stop();

    expect(queue.settled()[0]?.settlement).toBe("skipped_flag_disabled");
    expect(logs.join("\n")).toContain("PULSERANK_COLLECTION_ENABLED is disabled");
    expect(logs.join("\n")).toContain("skipping job job-1 (pulse.collect.sample)");
  });

  it("skips discovery jobs when PULSERANK_DISCOVERY_ENABLED is off but runs ingest jobs", async () => {
    const { queue, logs, handle } = makeWorker({
      jobs: [
        { id: "job-d", name: "pulse.collect.discovery", payload: {} },
        { id: "job-i", name: "pulse.ingest.run", payload: {} },
      ],
    });

    await vi.waitFor(() => {
      expect(queue.settled()).toHaveLength(2);
    });
    await handle.stop();

    const byId = new Map(queue.settled().map((entry) => [entry.job.id, entry]));
    expect(byId.get("job-d")?.settlement).toBe("skipped_flag_disabled");
    expect(byId.get("job-i")?.settlement).toBe("succeeded");
    expect(logs.join("\n")).toContain("PULSERANK_DISCOVERY_ENABLED is disabled");
  });

  it("runs a collect job to its stub when the flag is enabled", async () => {
    const { queue, logs, handle } = makeWorker({
      flags: ENABLED_FLAGS,
      jobs: [{ id: "job-2", name: "pulse.collect.sample", payload: {} }],
    });

    await vi.waitFor(() => {
      expect(queue.settled()).toHaveLength(1);
    });
    await handle.stop();

    expect(queue.settled()[0]?.settlement).toBe("succeeded");
    expect(logs.join("\n")).toContain("finished with status not_implemented");
  });

  it("fails closed on a claimed legacy or unknown job name", async () => {
    const { queue, logs, handle } = makeWorker({
      jobs: [
        { id: "job-l", name: "collect-elevator-status", payload: {} },
        { id: "job-u", name: "totally-unknown", payload: {} },
      ],
    });

    await vi.waitFor(() => {
      expect(queue.settled()).toHaveLength(2);
    });
    await handle.stop();

    const settlements = queue.settled().map((entry) => entry.settlement);
    expect(settlements).toEqual(["rejected", "rejected"]);
    expect(logs.join("\n")).toContain("legacy_or_unknown_job_rejected");
  });

  it("logs a startup banner including worker id and flag states", async () => {
    const { logs, handle } = makeWorker();
    await handle.stop();
    const banner = logs.slice(0, 3).join("\n");
    expect(banner).toContain("PulseRank worker starting as test-worker.");
    expect(banner).toContain("collection disabled, discovery disabled");
    expect(banner).toContain("polling every 1ms");
  });
});
