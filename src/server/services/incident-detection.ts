import { desc, eq } from "drizzle-orm";

import { sha256Json } from "@/domain/collection/identity";
import { db } from "@/server/db/client";
import {
  collectionRuns,
  incidentEvents,
  incidents,
} from "@/server/db/schema";

import { writeIncidentArtifact } from "./incident-artifacts";
import {
  findActiveIncidentByFingerprint,
  recordIncidentEvidence,
} from "./incidents";

const CLASSIFICATION_COPY = {
  probable_layout_drift: {
    title: "Collector structure changed",
    summary:
      "The latest extraction changed station or elevator structure. Publication is frozen pending review.",
  },
  source_stale: {
    title: "SFMTA source is stale",
    summary:
      "The source timestamp is outside the freshness policy. The last trusted snapshot remains active.",
  },
  source_unavailable: {
    title: "Source collection unavailable",
    summary:
      "Repeated collection failures prevented fresh evidence. The last trusted snapshot remains active.",
  },
  ambiguous_contract_failure: {
    title: "Collector output is ambiguous",
    summary:
      "The output failed required contract checks and cannot be interpreted safely.",
  },
} as const;

type IncidentClassification = keyof typeof CLASSIFICATION_COPY;

async function sourceUnavailableThresholdReached() {
  const recent = await db
    .select({ classification: collectionRuns.classification })
    .from(collectionRuns)
    .orderBy(desc(collectionRuns.createdAt))
    .limit(5);
  return (
    recent.filter((run) => run.classification === "source_unavailable").length >= 3
  );
}

export async function detectIncidentForRun(runId: string) {
  const [run] = await db
    .select()
    .from(collectionRuns)
    .where(eq(collectionRuns.id, runId))
    .limit(1);
  if (!run?.classification || run.status === "accepted") return null;
  if (!(run.classification in CLASSIFICATION_COPY)) return null;

  const classification = run.classification as IncidentClassification;
  if (
    classification === "source_unavailable" &&
    !(await sourceUnavailableThresholdReached())
  ) {
    return null;
  }

  const fingerprint = sha256Json({
    classification,
    reasonCodes: [...(run.reasonCodes ?? [])].sort(),
    structuralFingerprint: run.structuralFingerprint,
    errorCode: run.errorCode,
  });
  const existing = await findActiveIncidentByFingerprint(fingerprint);
  if (existing) {
    await db
      .update(incidents)
      .set({ collectionRunId: run.id, updatedAt: new Date() })
      .where(eq(incidents.id, existing.id));
    await recordIncidentEvidence({
      incidentId: existing.id,
      eventType: "incident.reobserved",
      details: { runId: run.id, classification, reasonCodes: run.reasonCodes ?? [] },
    });
    return existing;
  }

  const copy = CLASSIFICATION_COPY[classification];
  const [incident] = await db
    .insert(incidents)
    .values({
      collectionRunId: run.id,
      classification,
      title: copy.title,
      summary: copy.summary,
      fingerprint,
    })
    .returning();
  if (!incident) throw new Error("Could not create incident.");

  await db.insert(incidentEvents).values({
    incidentId: incident.id,
    eventType: "incident.detected",
    fromState: null,
    toState: "detected",
    details: {
      runId: run.id,
      classification,
      reasonCodes: run.reasonCodes ?? [],
      publicationFrozen: true,
      trustedStateChanged: false,
    },
  });

  const artifact = await writeIncidentArtifact(incident.id, "detection.json", {
    incidentId: incident.id,
    runId: run.id,
    classification,
    reasonCodes: run.reasonCodes ?? [],
    contractVersion: run.contractVersion,
    contractReport: run.contractReport,
    structuralFingerprint: run.structuralFingerprint,
    detectedAt: incident.detectedAt,
    safety: {
      publicationFrozen: true,
      serviceEventsEmitted: false,
      routeRecalculationRequested: false,
    },
  });
  await recordIncidentEvidence({
    incidentId: incident.id,
    eventType: "artifact.detection.saved",
    details: artifact,
  });
  return incident;
}

export async function detectIncidentWithoutAffectingRun(runId: string) {
  try {
    return await detectIncidentForRun(runId);
  } catch (error) {
    console.error(
      "Incident detection failed after publication was safely frozen:",
      error instanceof Error ? error.message : "unknown error",
    );
    return null;
  }
}
