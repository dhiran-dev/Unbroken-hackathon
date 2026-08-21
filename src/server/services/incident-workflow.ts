/**
 * Incident healing workflow seam (disposition RETAIN_AND_REFACTOR, plan 5.2).
 *
 * The legacy UNBROKEN healing runtime (Bright Data heal previews validated
 * against the retired elevator contract, trusted-snapshot promotion, LLM
 * review gating) was removed with the L1 cleanup batch together with the
 * deleted `@/domain/collection/validation` module it depended on. The
 * lifecycle state machine itself survives in `@/domain/incidents/machine` and
 * `@/server/services/incidents`; nothing currently imports this module.
 *
 * Every entry point below is a fail-closed seam until the PulseRank healing
 * pipeline (pulse.heal.preview / pulse.heal.verify) is bound by a later agent:
 * each resolves to a structured `unavailable` result, performs no I/O, and can
 * never execute legacy behavior or touch the retired collector identity.
 */

export type HealingWorkflowUnavailable = {
  status: "unavailable";
  reason: "PULSERANK_HEALING_BINDING_PENDING";
  message: string;
};

function unavailable(): HealingWorkflowUnavailable {
  return {
    status: "unavailable",
    reason: "PULSERANK_HEALING_BINDING_PENDING",
    message:
      "The legacy healing workflow was removed; the PulseRank healing pipeline is not bound yet.",
  };
}

export async function healIncident(_input: {
  incidentId: string;
  actorUserId: string;
  prompt: string;
}): Promise<HealingWorkflowUnavailable> {
  void _input;
  return unavailable();
}

export async function reviewIncident(_input: {
  incidentId: string;
  actorUserId: string;
}): Promise<HealingWorkflowUnavailable> {
  void _input;
  return unavailable();
}

export async function approveIncident(_input: {
  incidentId: string;
  actorUserId: string;
  confirmation: string;
}): Promise<HealingWorkflowUnavailable> {
  void _input;
  return unavailable();
}

export async function rejectIncident(_input: {
  incidentId: string;
  actorUserId: string;
  confirmation: string;
}): Promise<HealingWorkflowUnavailable> {
  void _input;
  return unavailable();
}

export async function verifyIncident(_input: {
  incidentId: string;
  actorUserId: string;
}): Promise<HealingWorkflowUnavailable> {
  void _input;
  return unavailable();
}
