import { brightDataHealEnvelopeSchema } from "@/domain/incidents/contract";
import {
  runInPulseTransaction,
  type JsonObject,
} from "@/server/ingestion/repo";
import { JUDGE_COLLECTOR_ID } from "@/server/judge/to-scrape-row";
import {
  HealingIntegrationError,
  resolveBrightDataHealing,
} from "@/server/services/bright-data-healing";

type ApprovalFailure = {
  status: "failed";
  errorCode: string;
  message: string;
};

export type PulseHealApprovalOutcome =
  | {
      status: "ok";
      sessionId: string;
      collectorId: string;
      providerStatus: string;
    }
  | ApprovalFailure;

function allowedSourceUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "caffeineinformer.com" || hostname.endsWith(".caffeineinformer.com"))
    );
  } catch {
    return false;
  }
}

/**
 * Resolve one pending PulseRank heal session through the explicit human
 * approval command. The provider call happens before the approval timestamp
 * is written; a non-`done` or wrong-collector response cannot unlock verify.
 */
export async function approvePulseHealSession(input: {
  sessionId: string;
  approvedBy: string;
}): Promise<PulseHealApprovalOutcome> {
  const pending = await runInPulseTransaction(async (repo) => {
    const session = await repo.getHealSession(input.sessionId);
    if (session === null) {
      return {
        ok: false as const,
        errorCode: "heal_session_not_found",
        message: "heal session does not exist",
      };
    }
    if (session.approvedAt !== null) {
      return {
        ok: false as const,
        errorCode: "heal_session_already_approved",
        message: "heal session has already been approved",
      };
    }
    const collector = await repo.findActiveCollector();
    if (
      collector === null ||
      collector.id !== session.collectorId ||
      collector.externalId !== JUDGE_COLLECTOR_ID
    ) {
      return {
        ok: false as const,
        errorCode: "collector_identity_changed",
        message: "the pending session no longer points at the active PulseRank collector",
      };
    }
    const sourceUrl = session.preview.sourceUrl;
    if (!allowedSourceUrl(sourceUrl)) {
      return {
        ok: false as const,
        errorCode: "source_not_allowed",
        message: "the pending session has no allowed Caffeine Informer source URL",
      };
    }
    return { ok: true as const, session, collector, sourceUrl };
  });

  if (!pending.ok) {
    return {
      status: "failed",
      errorCode: pending.errorCode,
      message: pending.message,
    };
  }

  let approval: ReturnType<typeof brightDataHealEnvelopeSchema.parse>;
  try {
    const providerResult = await resolveBrightDataHealing("approve", pending.sourceUrl);
    const parsed = brightDataHealEnvelopeSchema.safeParse(providerResult);
    if (!parsed.success) {
      return {
        status: "failed",
        errorCode: "approval_envelope_invalid",
        message: "Bright Data approval returned an unexpected envelope",
      };
    }
    approval = parsed.data;
  } catch (error) {
    return {
      status: "failed",
      errorCode: error instanceof HealingIntegrationError ? error.code : "approval_provider_failed",
      message: error instanceof Error ? error.message : "Bright Data approval failed",
    };
  }

  if (
    approval.collector_id !== JUDGE_COLLECTOR_ID ||
    approval.status !== "done" ||
    !approval.completed_steps.includes("user_approval")
  ) {
    return {
      status: "failed",
      errorCode: "approval_gate_not_confirmed",
      message: "Bright Data did not confirm the explicit user approval step",
    };
  }

  try {
    await runInPulseTransaction(async (repo) => {
      const latest = await repo.getHealSession(input.sessionId);
      if (latest === null) throw new Error("heal session disappeared before approval was recorded");
      if (latest.approvedAt !== null) throw new Error("heal session was approved concurrently");
      await repo.updateHealSessionPreview(input.sessionId, {
        ...latest.preview,
        approval: approval as unknown as JsonObject,
      });
      await repo.approveHealSession(input.sessionId, input.approvedBy);
    });
  } catch (error) {
    return {
      status: "failed",
      errorCode: "approval_persist_failed",
      message: error instanceof Error ? error.message : "could not persist heal approval",
    };
  }

  return {
    status: "ok",
    sessionId: input.sessionId,
    collectorId: JUDGE_COLLECTOR_ID,
    providerStatus: approval.status,
  };
}
