import { desc, eq } from "drizzle-orm";

import { sha256Json } from "@/domain/collection/identity";
import { validateCollectorDataset } from "@/domain/collection/validation";
import { getServerEnv } from "@/lib/env";
import { db } from "@/server/db/client";
import {
  componentChecks,
  equipment,
  llmReviews,
  observations,
  trustedSnapshots,
} from "@/server/db/schema";

import { normalizeCollectorPayload } from "./bright-data";
import {
  HealingIntegrationError,
  requestBrightDataHealing,
  resolveBrightDataHealing,
} from "./bright-data-healing";
import { requestFireworksReview } from "./fireworks-review";
import { writeIncidentArtifact } from "./incident-artifacts";
import {
  getIncident,
  latestIncidentEvidence,
  recordIncidentEvidence,
  requireIncidentAction,
  transitionIncident,
} from "./incidents";
import { runCollection } from "./collection";

const REVIEW_PROMPT_VERSION = "healing-review-v1";
const REVIEW_CONFIDENCE_GATE = 80;

function buildHealingPrompt(operatorPrompt: string) {
  const prefix =
    "Repair extraction for the existing collector only. Preserve the exact output fields and one record per real SFMTA elevator. Never invent a station, elevator, status, or timestamp. Missing values must remain unknown. ";
  return `${prefix}Observed problem: ${operatorPrompt}`.slice(0, 1_000);
}

async function previousTrustedEvidence() {
  const [snapshot] = await db
    .select()
    .from(trustedSnapshots)
    .orderBy(desc(trustedSnapshots.acceptedAt))
    .limit(1);
  if (!snapshot) throw new Error("Healing requires a trusted baseline.");

  const rows = await db
    .select({ sourceKey: equipment.sourceKey })
    .from(observations)
    .innerJoin(equipment, eq(observations.equipmentId, equipment.id))
    .where(eq(observations.collectionRunId, snapshot.collectionRunId));

  return {
    snapshot,
    sourceKeys: new Set(rows.map((row) => row.sourceKey)),
  };
}

async function reconcileHealingFailure(input: {
  incidentId: string;
  actorUserId: string;
  code: string;
  productionCollectorMayHaveChanged?: boolean;
}) {
  try {
    const current = await getIncident(input.incidentId);
    const productionCollectorMayHaveChanged = input.productionCollectorMayHaveChanged ?? false;
    if (current.state === "heal_requested") {
      await transitionIncident({
        incidentId: current.id,
        toState: "acknowledged",
        eventType: "healing.failed",
        actorUserId: input.actorUserId,
        details: { code: input.code, productionCollectorChanged: false },
      });
    } else if (current.state === "preview_received") {
      await transitionIncident({
        incidentId: current.id,
        toState: "preview_rejected",
        eventType: "healing.reconciliation_failed",
        actorUserId: input.actorUserId,
        details: { code: input.code, productionCollectorChanged: false },
      });
    } else if (
      productionCollectorMayHaveChanged &&
      ["awaiting_review", "awaiting_approval"].includes(current.state)
    ) {
      await transitionIncident({
        incidentId: current.id,
        toState: "verification_failed",
        eventType: "healing.approval_ambiguous",
        actorUserId: input.actorUserId,
        details: {
          code: input.code,
          productionCollectorMayHaveChanged: true,
          verificationRequired: true,
        },
      });
    } else {
      await recordIncidentEvidence({
        incidentId: current.id,
        eventType: "healing.reconciliation_recorded",
        actorUserId: input.actorUserId,
        details: { code: input.code, productionCollectorMayHaveChanged },
      });
    }
  } catch {
    // Preserve the original integration error if durable reconciliation is unavailable.
  }
}

export async function healIncident(input: {
  incidentId: string;
  actorUserId: string;
  prompt: string;
}) {
  const incident = await requireIncidentAction(input.incidentId, "heal");
  const healingPrompt = buildHealingPrompt(input.prompt);
  await transitionIncident({
    incidentId: incident.id,
    toState: "heal_requested",
    eventType: "healing.requested",
    actorUserId: input.actorUserId,
    details: {
      collectorId: getServerEnv().BRIGHTDATA_COLLECTOR_ID,
      promptHash: sha256Json(healingPrompt),
      humanInitiated: true,
    },
  });

  try {
  const requestArtifact = await writeIncidentArtifact(
    incident.id,
    "heal-request.json",
    {
      incidentId: incident.id,
      collectorId: getServerEnv().BRIGHTDATA_COLLECTOR_ID,
      prompt: healingPrompt,
      requestedBy: input.actorUserId,
      requestedAt: new Date(),
    },
  );
  await recordIncidentEvidence({
    incidentId: incident.id,
    eventType: "artifact.heal_request.saved",
    actorUserId: input.actorUserId,
    details: requestArtifact,
  });

  let envelope;
  try {
    envelope = await requestBrightDataHealing(healingPrompt);
  } catch (error) {
    await transitionIncident({
      incidentId: incident.id,
      toState: "acknowledged",
      eventType: "healing.failed",
      actorUserId: input.actorUserId,
      details: {
        code:
          error instanceof HealingIntegrationError
            ? error.code
            : "HEALING_UNEXPECTED_FAILURE",
        productionCollectorChanged: false,
      },
    });
    throw error;
  }

  const previewArtifact = await writeIncidentArtifact(
    incident.id,
    "preview.json",
    envelope,
  );
  if (envelope.status !== "awaiting_approval") {
    await transitionIncident({
      incidentId: incident.id,
      toState: "acknowledged",
      eventType: "healing.no_preview_gate",
      actorUserId: input.actorUserId,
      details: {
        envelopeStatus: envelope.status,
        artifact: previewArtifact,
        productionCollectorChanged: false,
      },
    });
    throw new HealingIntegrationError(
      "BRIGHT_DATA_HEAL_NOT_AWAITING_APPROVAL",
      "Bright Data did not stop at the required approval gate.",
    );
  }

  await transitionIncident({
    incidentId: incident.id,
    toState: "preview_received",
    eventType: "healing.preview_received",
    actorUserId: input.actorUserId,
    details: {
      collectorId: envelope.collector_id,
      diffSummary: envelope.diff_summary ?? null,
      artifact: previewArtifact,
      productionCollectorChanged: false,
    },
  });

  const baseline = await previousTrustedEvidence();
  const payload = normalizeCollectorPayload(envelope.preview_result);
  const result = validateCollectorDataset({
    payload,
    collectedAt: new Date(),
    expectedSourceUrl: getServerEnv().SFMTA_SOURCE_URL,
    previousStructuralFingerprint: baseline.snapshot.structuralFingerprint,
  });
  const previewKeys = new Set(result.rows.map((row) => row.equipmentSourceKey));
  const missingIdentities = [...baseline.sourceKeys]
    .filter((key) => !previewKeys.has(key))
    .sort();
  const newIdentities = [...previewKeys]
    .filter((key) => !baseline.sourceKeys.has(key))
    .sort();
  const deterministicEvidence = {
    accepted: result.accepted,
    classification: result.classification,
    contractReport: result.report,
    identityDiff: { missingIdentities, newIdentities },
    collectorIdStable:
      envelope.collector_id === getServerEnv().BRIGHTDATA_COLLECTOR_ID,
    productionCollectorChanged: false,
  };
  const deterministicArtifact = await writeIncidentArtifact(
    incident.id,
    "deterministic-review.json",
    deterministicEvidence,
  );

  if (!result.accepted) {
    await transitionIncident({
      incidentId: incident.id,
      toState: "preview_rejected",
      eventType: "healing.preview_rejected",
      actorUserId: input.actorUserId,
      details: {
        ...deterministicEvidence,
        artifact: deterministicArtifact,
      },
    });
    try {
      const rejection = await resolveBrightDataHealing("reject");
      const approvalArtifact = await writeIncidentArtifact(
        incident.id,
        "approval.json",
        {
          decision: "reject",
          reason: "deterministic_preview_failure",
          envelope: rejection,
        },
      );
      await recordIncidentEvidence({
        incidentId: incident.id,
        eventType: "healing.proposal_rejected",
        actorUserId: input.actorUserId,
        details: {
          artifact: approvalArtifact,
          automaticSafetyRejection: true,
          productionCollectorChanged: false,
        },
      });
    } catch (error) {
      await recordIncidentEvidence({
        incidentId: incident.id,
        eventType: "healing.proposal_rejection_failed",
        actorUserId: input.actorUserId,
        details: {
          code:
            error instanceof HealingIntegrationError
              ? error.code
              : "HEALING_REJECTION_UNEXPECTED_FAILURE",
          productionCollectorChanged: false,
        },
      });
    }
    return { accepted: false, report: result.report };
  }

  await transitionIncident({
    incidentId: incident.id,
    toState: "awaiting_review",
    eventType: "healing.preview_validated",
    actorUserId: input.actorUserId,
    details: {
      ...deterministicEvidence,
      artifact: deterministicArtifact,
      llmInvoked: false,
      humanApprovalRequired: true,
    },
  });
  return { accepted: true, report: result.report };
  } catch (error) {
    await reconcileHealingFailure({
      incidentId: incident.id,
      actorUserId: input.actorUserId,
      code: error instanceof HealingIntegrationError ? error.code : "HEALING_WORKFLOW_FAILED",
    });
    throw error;
  }
}

export async function reviewIncident(input: {
  incidentId: string;
  actorUserId: string;
}) {
  const incident = await requireIncidentAction(input.incidentId, "review");
  const deterministic = await latestIncidentEvidence(
    incident.id,
    "healing.preview_validated",
  );
  if (!deterministic) {
    throw new Error("A valid deterministic preview is required before LLM review.");
  }

  const evidence = {
    incident: {
      id: incident.id,
      classification: incident.classification,
      summary: incident.summary,
    },
    collectorIdStable: deterministic.details.collectorIdStable,
    classification: deterministic.details.classification,
    contractReport: deterministic.details.contractReport,
    identityDiff: deterministic.details.identityDiff,
    deterministicAccepted: deterministic.details.accepted,
    safetyRules: {
      missingStatusIsUnknown: true,
      noPublicationBeforeHumanApproval: true,
      noInventedStationsOrEquipment: true,
    },
  };
  const inputHash = sha256Json(evidence);

  try {
    const response = await requestFireworksReview(evidence);
    const [stored] = await db
      .insert(llmReviews)
      .values({
        incidentId: incident.id,
        provider: "fireworks",
        model: response.model,
        reasoningEffort: response.reasoningEffort,
        promptVersion: REVIEW_PROMPT_VERSION,
        inputHash,
        recommendation: response.review.recommendation,
        confidence: response.review.confidence,
        report: response.review,
        valid: true,
      })
      .returning();
    const artifact = await writeIncidentArtifact(
      incident.id,
      "llm-review.json",
      {
        provider: "fireworks",
        model: response.model,
        reasoningEffort: response.reasoningEffort,
        promptVersion: REVIEW_PROMPT_VERSION,
        inputHash,
        report: response.review,
      },
    );
    await db.insert(componentChecks).values({
      component: "fireworks",
      status: "operational",
      message: "Structured advisory review completed with the exact configured model.",
      metadata: { incidentId: incident.id, model: response.model },
    });

    if (
      response.review.confidence >= REVIEW_CONFIDENCE_GATE &&
      response.review.format_compatible
    ) {
      await transitionIncident({
        incidentId: incident.id,
        toState: "awaiting_approval",
        eventType: "llm.review_completed",
        actorUserId: input.actorUserId,
        details: {
          reviewId: stored?.id,
          artifact,
          recommendation: response.review.recommendation,
          confidence: response.review.confidence,
          advisoryOnly: true,
          humanApprovalRequired: true,
        },
      });
    } else {
      await recordIncidentEvidence({
        incidentId: incident.id,
        eventType: "llm.review_requires_human",
        actorUserId: input.actorUserId,
        details: {
          reviewId: stored?.id,
          artifact,
          confidence: response.review.confidence,
          formatCompatible: response.review.format_compatible,
          advisoryOnly: true,
        },
      });
    }
    return response.review;
  } catch (error) {
    const code =
      error instanceof Error && "code" in error
        ? String(error.code)
        : "FIREWORKS_REVIEW_FAILED";
    await db.insert(llmReviews).values({
      incidentId: incident.id,
      provider: "fireworks",
      model: getServerEnv().FIREWORKS_MODEL,
      reasoningEffort: getServerEnv().FIREWORKS_REASONING_EFFORT,
      promptVersion: REVIEW_PROMPT_VERSION,
      inputHash,
      valid: false,
      errorCode: code,
    });
    const artifact = await writeIncidentArtifact(
      incident.id,
      "llm-review.json",
      { valid: false, errorCode: code, inputHash },
    );
    await recordIncidentEvidence({
      incidentId: incident.id,
      eventType: "llm.review_unavailable",
      actorUserId: input.actorUserId,
      details: { artifact, errorCode: code, humanReviewRequired: true },
    });
    await db.insert(componentChecks).values({
      component: "fireworks",
      status: "degraded",
      message: "Advisory review unavailable; deterministic freeze remains active.",
      metadata: { incidentId: incident.id, errorCode: code },
    });
    return null;
  }
}

export async function approveIncident(input: {
  incidentId: string;
  actorUserId: string;
}) {
  const incident = await requireIncidentAction(input.incidentId, "approve");
  const deterministic = await latestIncidentEvidence(
    incident.id,
    "healing.preview_validated",
  );
  if (!deterministic || deterministic.details.accepted !== true) {
    throw new Error("Human approval requires a valid deterministic preview.");
  }

  try {
  const envelope = await resolveBrightDataHealing("approve");
  if (envelope.status !== "done") {
    throw new HealingIntegrationError(
      "BRIGHT_DATA_APPROVAL_NOT_APPLIED",
      "Bright Data did not confirm that the approved collector was saved.",
    );
  }
  const artifact = await writeIncidentArtifact(
    incident.id,
    "approval.json",
    {
      decision: "approve",
      actorUserId: input.actorUserId,
      explicitHumanApproval: true,
      envelope,
    },
  );
  await transitionIncident({
    incidentId: incident.id,
    toState: "approved",
    eventType: "healing.approved",
    actorUserId: input.actorUserId,
    details: {
      artifact,
      explicitHumanApproval: true,
      collectorId: envelope.collector_id,
      savedToProduction: true,
    },
  });
  return envelope;
  } catch (error) {
    await reconcileHealingFailure({
      incidentId: incident.id,
      actorUserId: input.actorUserId,
      code: error instanceof HealingIntegrationError ? error.code : "HEALING_APPROVAL_FAILED",
      productionCollectorMayHaveChanged: true,
    });
    throw error;
  }
}

export async function rejectIncident(input: {
  incidentId: string;
  actorUserId: string;
}) {
  const incident = await requireIncidentAction(input.incidentId, "reject");
  const alreadyRejected = await latestIncidentEvidence(
    incident.id,
    "healing.proposal_rejected",
  );
  const envelope = alreadyRejected
    ? null
    : await resolveBrightDataHealing("reject");
  const artifact = await writeIncidentArtifact(
    incident.id,
    "approval.json",
    {
      decision: "reject",
      actorUserId: input.actorUserId,
      explicitHumanRejection: true,
      envelope,
    },
  );
  await transitionIncident({
    incidentId: incident.id,
    toState: "rejected",
    eventType: "healing.rejected",
    actorUserId: input.actorUserId,
    details: {
      artifact,
      explicitHumanRejection: true,
      productionCollectorChanged: false,
    },
  });
}

export async function verifyIncident(input: {
  incidentId: string;
  actorUserId: string;
}) {
  const incident = await requireIncidentAction(input.incidentId, "verify");
  try {
    const result = await runCollection("manual");
    const successful =
      result.status === "accepted" &&
      result.collectionId.startsWith("j_");
    const artifact = await writeIncidentArtifact(
      incident.id,
      "verification.json",
      { result, collectorId: getServerEnv().BRIGHTDATA_COLLECTOR_ID },
    );
    await transitionIncident({
      incidentId: incident.id,
      toState: successful ? "verified" : "verification_failed",
      eventType: successful
        ? "healing.verification_succeeded"
        : "healing.verification_failed",
      actorUserId: input.actorUserId,
      details: { artifact, runId: result.runId, successful },
    });
    return result;
  } catch (error) {
    const artifact = await writeIncidentArtifact(
      incident.id,
      "verification.json",
      {
        successful: false,
        error:
          error instanceof Error ? error.message.slice(0, 300) : "unknown error",
      },
    );
    await transitionIncident({
      incidentId: incident.id,
      toState: "verification_failed",
      eventType: "healing.verification_failed",
      actorUserId: input.actorUserId,
      details: { artifact, successful: false },
    });
    return null;
  }
}
