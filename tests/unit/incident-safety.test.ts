import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  APPROVAL_CONFIRMATION,
  REJECTION_CONFIRMATION,
  fireworksReviewSchema,
  hasExactIncidentConfirmation,
  incidentActionIdempotencyKey,
  incidentActionRequestHash,
  incidentActionBodySchema,
} from "@/domain/incidents/contract";
import {
  actionAllowed,
  assertTransition,
  canTransition,
} from "@/domain/incidents/machine";
import {
  expireIncidentArtifacts,
  writeIncidentArtifact,
} from "@/server/services/incident-artifacts";
import { hasStableProductionCollectorId } from "@/server/services/bright-data-healing";
import { requestFireworksReview } from "@/server/services/fireworks-review";

const temporaryRoots: string[] = [];
const originalArtifactRoot = process.env.INCIDENT_ARTIFACTS_DIR;

afterEach(async () => {
  vi.unstubAllEnvs();
  process.env.INCIDENT_ARTIFACTS_DIR = originalArtifactRoot;
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("incident state safety", () => {
  it("does not permit healing or approval before acknowledgement", () => {
    expect(actionAllowed("detected", "heal")).toBe(false);
    expect(actionAllowed("detected", "approve")).toBe(false);
    expect(canTransition("detected", "approved")).toBe(false);
    expect(() => assertTransition("detected", "approved")).toThrow();
  });

  it("requires the exact typed approval phrase", () => {
    expect(APPROVAL_CONFIRMATION).toBe("APPROVE HEALED COLLECTOR");
    expect(
      incidentActionBodySchema.parse({
        confirmation: APPROVAL_CONFIRMATION,
      }).confirmation,
    ).toBe(APPROVAL_CONFIRMATION);
    expect(hasExactIncidentConfirmation("approve", APPROVAL_CONFIRMATION)).toBe(true);
    expect(hasExactIncidentConfirmation("approve", "APPROVE")).toBe(false);
  });

  it("rejects invalid previews without opening approval", () => {
    expect(actionAllowed("preview_rejected", "approve")).toBe(false);
    expect(actionAllowed("preview_rejected", "reject")).toBe(true);
    expect(canTransition("preview_received", "preview_rejected")).toBe(true);
    expect(canTransition("preview_rejected", "approved")).toBe(false);
  });

  it("requires the exact rejection phrase too", () => {
    expect(REJECTION_CONFIRMATION).toBe("REJECT HEALED COLLECTOR");
    expect(hasExactIncidentConfirmation("reject", REJECTION_CONFIRMATION)).toBe(true);
    expect(hasExactIncidentConfirmation("reject", "REJECT")).toBe(false);
  });

  it("requires a fresh live verification after approval", () => {
    expect(actionAllowed("approved", "verify")).toBe(true);
    expect(canTransition("approved", "verified")).toBe(true);
    expect(canTransition("approved", "verification_failed")).toBe(true);
  });

  it("allows a successful retry after verification failed", () => {
    expect(actionAllowed("verification_failed", "verify")).toBe(true);
    expect(canTransition("verification_failed", "verified")).toBe(true);
  });
});

describe("healing boundary invariants", () => {
  it("accepts only the exact production collector identity", () => {
    expect(hasStableProductionCollectorId("c_msyjsllt1r9ej5tdub")).toBe(true);
    expect(hasStableProductionCollectorId("c_other_collector")).toBe(false);
    expect(hasStableProductionCollectorId("c_msyjsllt1r9ej5tdub", "c_other_collector")).toBe(false);
  });

  it("scopes idempotency to an incident and hashes the complete request", () => {
    const incidentId = "11111111-1111-4111-8111-111111111111";
    const key = incidentActionIdempotencyKey(incidentId, "request-1234567890");
    expect(key).toBe("incident:" + incidentId + ":request-1234567890");
    const base = incidentActionRequestHash({
      incidentId,
      action: "approve",
      confirmation: APPROVAL_CONFIRMATION,
    });
    expect(incidentActionRequestHash({
      incidentId,
      action: "approve",
      confirmation: APPROVAL_CONFIRMATION,
    })).toBe(base);
    expect(incidentActionRequestHash({
      incidentId,
      action: "reject",
      confirmation: REJECTION_CONFIRMATION,
    })).not.toBe(base);
  });
});

describe("private incident evidence", () => {
  it("redacts secrets and expires only scoped evidence files", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "unbroken-incident-"));
    temporaryRoots.push(root);
    process.env.INCIDENT_ARTIFACTS_DIR = root;
    const incidentId = "11111111-1111-4111-8111-111111111111";

    const artifact = await writeIncidentArtifact(
      incidentId,
      "heal-request.json",
      {
        authorization: "Bearer secret-token",
        nested: { api_key: "not-for-storage" },
        safe: "contract evidence",
      },
    );
    const destination = path.join(root, incidentId, "heal-request.json");
    const body = await readFile(destination, "utf8");
    expect(body).not.toContain("secret-token");
    expect(body).not.toContain("not-for-storage");
    expect(body).toContain("[REDACTED]");
    expect(artifact.sha256).toHaveLength(64);

    const old = new Date("2025-01-01T00:00:00.000Z");
    await utimes(destination, old, old);
    expect(
      await expireIncidentArtifacts(
        new Date("2026-08-18T00:00:00.000Z"),
        90,
      ),
    ).toBe(1);
    await expect(stat(destination)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("Fireworks advisory boundary", () => {
  it("uses the exact model, high reasoning, and strict structured output", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
    vi.stubEnv("BETTER_AUTH_SECRET", "test-secret-0123456789-0123456789");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("BRIGHTDATA_API_TOKEN", "test-token");
    vi.stubEnv("BRIGHTDATA_COLLECTOR_ID", "c_msyjsllt1r9ej5tdub");
    vi.stubEnv("FIREWORKS_API_KEY", "test-fireworks-key");
    vi.stubEnv("FIREWORKS_API_BASE_URL", "https://api.fireworks.ai/inference/v1");
    vi.stubEnv("FIREWORKS_MODEL", "accounts/fireworks/models/deepseek-v4-flash-0731");
    vi.stubEnv("FIREWORKS_REASONING_EFFORT", "high");
    const report = {
      recommendation: "human_review",
      confidence: 76,
      summary: "The preview remains subject to human review.",
      risks: ["Equipment identity needs visual comparison."],
      suspected_inventions: [],
      missing_stations: [],
      missing_equipment: [],
      format_compatible: true,
      required_human_checks: ["Compare station and equipment identities."],
    };
    expect(fireworksReviewSchema.parse(report)).toEqual(report);

    const fakeFetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "accounts/fireworks/models/deepseek-v4-flash-0731",
          choices: [
            {
              finish_reason: "stop",
              message: { content: JSON.stringify(report) },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as unknown as typeof fetch;

    const result = await requestFireworksReview(
      { deterministicAccepted: true },
      fakeFetch,
    );
    const [endpoint, options] = vi.mocked(fakeFetch).mock.calls[0]!;
    const requestBody = JSON.parse(String(options?.body));

    expect(String(endpoint)).toBe(
      "https://api.fireworks.ai/inference/v1/chat/completions",
    );
    expect(requestBody.model).toBe(
      "accounts/fireworks/models/deepseek-v4-flash-0731",
    );
    expect(requestBody.reasoning_effort).toBe("high");
    expect(requestBody.response_format).toMatchObject({
      type: "json_schema",
      json_schema: { strict: true },
    });
    expect(requestBody.messages[0].content).toContain("Never approve deployment");
    expect(requestBody.messages[1].content).toContain("human must make the final decision");
    expect(result.review.recommendation).toBe("human_review");
  });
});
