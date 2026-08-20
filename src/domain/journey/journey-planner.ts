import { createHash } from "node:crypto";

import {
  AccessibilityEvidenceInvalidError,
  type AccessibilityAssessment,
  type AccessibilityReasonCode,
  type AccessibilityEvidence,
  type EvidenceProvenance,
} from "@/domain/journey/accessibility-evidence";
import {
  RouteEngineUnavailableError,
  type RouteCandidate,
  type RouteCandidateLeg,
  type RouteEngine,
  type RouteEnginePlace,
} from "@/domain/journey/route-engine";

export type ResolvedJourneyRequest = {
  origin: RouteEnginePlace;
  destination: RouteEnginePlace;
  departureAt: Date;
  evaluatedAt: Date;
};

export type JourneyDraftStatus =
  "confirmed" | "check_details" | "updates_unavailable";

export type JourneyDraftLeg = {
  type: RouteCandidateLeg["type"];
  from: RouteCandidateLeg["from"];
  to: RouteCandidateLeg["to"];
  startAt: Date;
  endAt: Date;
  durationMinutes: number;
  distanceMeters?: number;
  route?: {
    id: string;
    name: string;
    color: string;
    destination: string;
  };
  instruction: string;
  geometry: RouteCandidateLeg["geometry"];
  accessibility: {
    state: AccessibilityAssessment["state"];
    reasons: string[];
  };
};

export type JourneyFingerprint = {
  version: 1;
  hash: string;
  categories: {
    route: string;
    stop: string;
    elevator: string;
    warning: string;
    eta: string;
  };
  eta: {
    scheduledDurationSeconds: number;
    currentDurationSeconds: number;
    shiftSeconds: number;
  };
};

export type SelectedJourneyDraft = {
  candidateId: string;
  status: JourneyDraftStatus;
  title: string;
  departureAt: Date;
  arrivalAt: Date;
  durationMinutes: number;
  legs: JourneyDraftLeg[];
  warnings: string[];
  changes: string[];
  sources: EvidenceProvenance[];
  fingerprint: JourneyFingerprint;
};

export type JourneyPlannerCoreResult =
  | { kind: "selected"; journey: SelectedJourneyDraft }
  | {
      kind: "unavailable";
      status: "unavailable";
      title: "No step-free route confirmed";
    };

export interface JourneyPlannerCore {
  plan(request: ResolvedJourneyRequest): Promise<JourneyPlannerCoreResult>;
}

function confirmedWalkingDistance(
  candidate: RouteCandidate,
  assessment: AccessibilityAssessment,
) {
  return candidate.legs.reduce((total, leg, index) => {
    if (
      (leg.type === "walk" || leg.type === "transfer") &&
      assessment.legs.find((item) => item.legIndex === index)?.state ===
        "confirmed"
    ) {
      return total + leg.distanceMeters;
    }
    return total;
  }, 0);
}

function aggregateState(
  states: readonly AccessibilityAssessment["state"][],
): AccessibilityAssessment["state"] {
  if (states.includes("blocked")) return "blocked";
  if (states.includes("unknown")) return "unknown";
  return "confirmed";
}

function safeInstruction(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 500 &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function validRelocationDependency(
  dependency: AccessibilityAssessment["legs"][number]["dependencies"][number],
) {
  if (dependency.kind !== "stop_relocation") return true;
  const reasonIds = dependency.reasons
    .filter((reason) => reason.code === "STOP_RELOCATION_ACTIVE")
    .map((reason) => reason.entityId)
    .sort();
  const details = dependency.relocations ?? [];
  return (
    reasonIds.length === details.length &&
    new Set(reasonIds).size === reasonIds.length &&
    new Set(
      details.map((detail) => `${detail.relocationId}\u0000${detail.role}`),
    ).size === details.length &&
    details.every(
      (detail) =>
        reasonIds.includes(detail.relocationId) &&
        (detail.role === "boarding" || detail.role === "alighting") &&
        safeInstruction(detail.instruction),
    )
  );
}

function validAssessment(
  candidate: RouteCandidate,
  assessment: AccessibilityAssessment,
) {
  if (
    assessment.candidateId !== candidate.id ||
    candidate.legs.length === 0 ||
    assessment.legs.length !== candidate.legs.length
  ) {
    return false;
  }
  for (const [index, leg] of assessment.legs.entries()) {
    if (
      leg.legIndex !== index ||
      leg.type !== candidate.legs[index]?.type ||
      leg.dependencies.length === 0 ||
      !leg.dependencies.every(validRelocationDependency) ||
      aggregateState(leg.dependencies.map((dependency) => dependency.state)) !==
        leg.state
    ) {
      return false;
    }
  }
  return (
    aggregateState(assessment.legs.map((leg) => leg.state)) === assessment.state
  );
}

function assessmentBlocked(assessment: AccessibilityAssessment) {
  return (
    assessment.state === "blocked" ||
    assessment.legs.some(
      (leg) =>
        leg.state === "blocked" ||
        leg.dependencies.some((dependency) => dependency.state === "blocked"),
    )
  );
}

type CurrentTimeline = {
  legs: Array<{ startAt: Date; endAt: Date; timingUnknown: boolean }>;
  arrivalAt: Date;
  durationMinutes: number;
  etaShiftSeconds: number;
  timingUnknown: boolean;
};

const MAX_CURRENT_DELAY_SECONDS = 6 * 60 * 60;

function safeCurrentDelay(value: number) {
  return Number.isSafeInteger(value) &&
    Math.abs(value) <= MAX_CURRENT_DELAY_SECONDS
    ? value
    : null;
}

function currentTimeline(
  candidate: RouteCandidate,
  assessment: AccessibilityAssessment,
): CurrentTimeline {
  const departureAt = new Date(candidate.departureAt);
  let cursor = departureAt.getTime();
  let timingUnknown = false;
  const legs = candidate.legs.map((leg, index) => {
    const evaluated = assessment.legs[index]!;
    const scheduledStart = leg.startAt.getTime();
    const scheduledDuration = Math.max(0, leg.endAt.getTime() - scheduledStart);
    let desiredStart = scheduledStart;
    let duration = scheduledDuration;
    let legTimingUnknown = false;
    if (leg.type === "ride") {
      const departureDelay = safeCurrentDelay(evaluated.departureDelaySeconds);
      const arrivalDelay = safeCurrentDelay(evaluated.arrivalDelaySeconds);
      if (departureDelay === null || arrivalDelay === null) {
        legTimingUnknown = true;
      } else {
        desiredStart += departureDelay * 1_000;
        const desiredEnd = leg.endAt.getTime() + arrivalDelay * 1_000;
        if (desiredEnd < desiredStart) {
          legTimingUnknown = true;
        } else {
          duration = desiredEnd - desiredStart;
        }
      }
    }
    const startAt = new Date(Math.max(cursor, desiredStart));
    const endAt = new Date(startAt.getTime() + duration);
    cursor = endAt.getTime();
    timingUnknown ||= legTimingUnknown;
    return { startAt, endAt, timingUnknown: legTimingUnknown };
  });
  const arrivalAt = new Date(Math.max(departureAt.getTime(), cursor));
  return {
    legs,
    arrivalAt,
    durationMinutes: Math.ceil(
      (arrivalAt.getTime() - departureAt.getTime()) / 60_000,
    ),
    etaShiftSeconds: Math.round(
      (arrivalAt.getTime() - candidate.arrivalAt.getTime()) / 1_000,
    ),
    timingUnknown,
  };
}

type EvaluatedCandidate = {
  candidate: RouteCandidate;
  assessment: AccessibilityAssessment;
  timeline: CurrentTimeline;
  effectiveState: AccessibilityAssessment["state"];
};

function compareEvaluated(left: EvaluatedCandidate, right: EvaluatedCandidate) {
  const stateRank = { confirmed: 0, unknown: 1, blocked: 2 } as const;
  return (
    stateRank[left.effectiveState] - stateRank[right.effectiveState] ||
    left.candidate.transferCount - right.candidate.transferCount ||
    confirmedWalkingDistance(left.candidate, left.assessment) -
      confirmedWalkingDistance(right.candidate, right.assessment) ||
    left.timeline.arrivalAt.getTime() -
      left.candidate.departureAt.getTime() -
      (right.timeline.arrivalAt.getTime() -
        right.candidate.departureAt.getTime()) ||
    left.candidate.id.localeCompare(right.candidate.id)
  );
}

const WALK_INSTRUCTION =
  "This path avoids mapped stairs. Some sidewalk details may be missing.";

const WARNING_TEMPLATES: ReadonlyArray<
  readonly [AccessibilityReasonCode, string]
> = [
  [
    "ACCESSIBILITY_ADVISORY_ACTIVE",
    "An accessibility update may affect this journey.",
  ],
  ["CURRENT_TIMING_UNCERTAIN", "Current timing details need checking."],
  ["ELEVATOR_OUT_OF_SERVICE", "A needed elevator is out of service."],
  ["ELEVATOR_STATUS_UNKNOWN", "Current elevator details need checking."],
  ["MAPPED_PATH_UNCONFIRMED", "Some step-free path details need checking."],
  ["SERVICE_ALERT_ACTIVE", "A current service update may affect this journey."],
  ["STOP_RELOCATION_ACTIVE", "A stop for this journey has moved."],
  ["SOURCE_OLDER", "Some information is older than expected."],
  ["SOURCE_UNAVAILABLE", "Some current information is unavailable."],
  ["STATION_ACCESS_UNAVAILABLE", "Step-free station access is unavailable."],
  ["STOP_ACCESS_UNKNOWN", "Step-free stop access details need checking."],
  ["STOP_SKIPPED", "A planned stop is not being served."],
  ["TRIP_CANCELLED", "A planned trip is not running."],
];

function assessmentReasons(assessment: AccessibilityAssessment) {
  return assessment.legs.flatMap((leg) =>
    leg.dependencies.flatMap((dependency) => dependency.reasons),
  );
}

function warningTemplates(
  assessment: AccessibilityAssessment,
  timingUnknown = false,
) {
  const codes = new Set(
    assessmentReasons(assessment).map((reason) => reason.code),
  );
  if (timingUnknown) codes.add("CURRENT_TIMING_UNCERTAIN");
  for (const source of assessment.sources) {
    if (source.state === "older") codes.add("SOURCE_OLDER");
    if (source.state === "unavailable") codes.add("SOURCE_UNAVAILABLE");
  }
  return WARNING_TEMPLATES.flatMap(([code, template]) =>
    codes.has(code) ? [template] : [],
  );
}

function liveUpdatesUnavailable(assessment: AccessibilityAssessment) {
  return assessment.sources.some(
    (source) =>
      (source.source === "trip_updates" || source.source === "alerts") &&
      source.state === "unavailable",
  );
}

function riderStatus(
  assessment: AccessibilityAssessment,
  effectiveState: AccessibilityAssessment["state"] = assessment.state,
): {
  status: JourneyDraftStatus;
  title: string;
} {
  if (effectiveState === "confirmed") {
    return { status: "confirmed", title: "Step-free details confirmed" };
  }
  if (liveUpdatesUnavailable(assessment)) {
    return {
      status: "updates_unavailable",
      title: "Current updates are unavailable",
    };
  }
  return { status: "check_details", title: "Some details need checking" };
}

function draftLegs(
  candidate: RouteCandidate,
  assessment: AccessibilityAssessment,
  timeline: CurrentTimeline,
): JourneyDraftLeg[] {
  return candidate.legs.map((leg, index) => {
    const evaluated = assessment.legs.find((item) => item.legIndex === index);
    const reasons = [
      ...new Set(
        evaluated?.dependencies.flatMap((dependency) =>
          dependency.reasons.map((reason) => reason.code),
        ) ?? [],
      ),
    ].sort();
    const timing = timeline.legs[index]!;
    if (timing.timingUnknown) reasons.push("CURRENT_TIMING_UNCERTAIN");
    const relocations = (evaluated?.dependencies ?? [])
      .flatMap((dependency) => dependency.relocations ?? [])
      .sort(
        (left, right) =>
          left.role.localeCompare(right.role) ||
          left.relocationId.localeCompare(right.relocationId),
      );
    const startAt = new Date(timing.startAt);
    const endAt = new Date(timing.endAt);
    const destination =
      leg.type === "ride" ? (leg.headsign ?? leg.to.name) : undefined;
    let instruction: string;
    if (leg.type === "ride") {
      const rideInstruction = `Take ${leg.routeName} toward ${destination}.`;
      const boarding = relocations
        .filter((relocation) => relocation.role === "boarding")
        .map((relocation) => relocation.instruction);
      const alighting = relocations
        .filter((relocation) => relocation.role === "alighting")
        .map((relocation) => relocation.instruction);
      instruction = [
        ...(boarding.length > 0
          ? [
              `${boarding.join(" ")} Then ${rideInstruction[0]!.toLowerCase()}${rideInstruction.slice(1)}`,
            ]
          : [rideInstruction]),
        ...alighting,
      ].join(" ");
    } else if (leg.type === "wait") {
      instruction = `Wait at ${leg.from.name}.`;
    } else if (leg.type === "transfer") {
      instruction = `Transfer from ${leg.from.name} to ${leg.to.name}. ${WALK_INSTRUCTION}`;
    } else {
      instruction = `Continue from ${leg.from.name} to ${leg.to.name}. ${WALK_INSTRUCTION}`;
    }
    return {
      type: leg.type,
      from: structuredClone(leg.from),
      to: structuredClone(leg.to),
      startAt,
      endAt,
      durationMinutes: Math.ceil(
        Math.max(0, endAt.getTime() - startAt.getTime()) / 60_000,
      ),
      ...(leg.type === "walk" || leg.type === "transfer"
        ? { distanceMeters: leg.distanceMeters }
        : {}),
      ...(leg.type === "ride"
        ? {
            route: {
              id: leg.routeId,
              name: leg.routeName,
              color: leg.routeColor,
              destination: destination!,
            },
          }
        : {}),
      instruction,
      geometry: structuredClone(leg.geometry),
      accessibility: {
        state: timing.timingUnknown
          ? "unknown"
          : (evaluated?.state ?? "unknown"),
        reasons: [...new Set(reasons)].sort(),
      },
    };
  });
}

function changes(assessment: AccessibilityAssessment, etaShiftSeconds: number) {
  const result: string[] = [];
  const relocationRoles = new Set(
    assessment.legs.flatMap((leg) =>
      leg.dependencies.flatMap((dependency) =>
        (dependency.relocations ?? []).map((relocation) => relocation.role),
      ),
    ),
  );
  if (relocationRoles.has("boarding")) {
    result.push("Boarding uses a temporary stop.");
  }
  if (relocationRoles.has("alighting")) {
    result.push("Arrival uses a temporary stop.");
  }
  if (etaShiftSeconds !== 0) {
    const minutes = Math.ceil(Math.abs(etaShiftSeconds) / 60);
    result.push(
      `Estimated arrival is ${minutes} ${minutes === 1 ? "minute" : "minutes"} ${
        etaShiftSeconds > 0 ? "later" : "earlier"
      }.`,
    );
  }
  return result;
}

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createJourneyFingerprint(input: {
  candidate: RouteCandidate;
  assessment: AccessibilityAssessment;
  legs: JourneyDraftLeg[];
  warnings: string[];
  departureAt: Date;
  arrivalAt: Date;
  durationMinutes: number;
  etaShiftSeconds: number;
}): JourneyFingerprint {
  const relocationReasons = input.assessment.legs
    .flatMap((leg) =>
      leg.dependencies.flatMap((dependency) =>
        (dependency.relocations ?? []).map((relocation) => [
          relocation.relocationId,
          relocation.role,
        ]),
      ),
    )
    .sort(
      ([leftId, leftRole], [rightId, rightRole]) =>
        leftId!.localeCompare(rightId!) || leftRole!.localeCompare(rightRole!),
    );
  const elevatorReasons = assessmentReasons(input.assessment)
    .filter((reason) =>
      [
        "ELEVATOR_OUT_OF_SERVICE",
        "ELEVATOR_STATUS_UNKNOWN",
        "STATION_ACCESS_UNAVAILABLE",
      ].includes(reason.code),
    )
    .map((reason): [AccessibilityReasonCode, string] => [
      reason.code,
      reason.entityId,
    ])
    .sort(
      ([leftCode, leftId], [rightCode, rightId]) =>
        leftCode.localeCompare(rightCode) || leftId.localeCompare(rightId),
    );
  const categories = {
    route: sha256(
      input.candidate.legs.map((leg) => ({
        type: leg.type,
        ...(leg.type === "ride"
          ? {
              routeId: leg.routeId,
              mode: leg.mode,
              routeName: leg.routeName,
              routeColor: leg.routeColor,
              headsign: leg.headsign,
            }
          : {}),
      })),
    ),
    stop: sha256({
      endpoints: input.candidate.legs.map((leg) => ({
        from: {
          name: leg.from.name,
          stopId: leg.from.stopId,
          latitude: leg.from.latitude,
          longitude: leg.from.longitude,
        },
        to: {
          name: leg.to.name,
          stopId: leg.to.stopId,
          latitude: leg.to.latitude,
          longitude: leg.to.longitude,
        },
        intermediateStopIds: leg.type === "ride" ? leg.intermediateStopIds : [],
      })),
      relocations: relocationReasons,
    }),
    elevator: sha256(elevatorReasons),
    warning: sha256({
      warnings: input.warnings,
      reasons: [
        ...new Map(
          assessmentReasons(input.assessment).map((reason) => [
            `${reason.code}\u0000${reason.entityId}`,
            [reason.code, reason.entityId],
          ]),
        ).values(),
      ].sort(
        ([leftCode, leftId], [rightCode, rightId]) =>
          leftCode!.localeCompare(rightCode!) ||
          leftId!.localeCompare(rightId!),
      ),
      sources: input.assessment.sources
        .map((source) => [source.source, source.state])
        .sort(
          ([leftSource, leftState], [rightSource, rightState]) =>
            leftSource!.localeCompare(rightSource!) ||
            leftState!.localeCompare(rightState!),
        ),
    }),
    eta: "",
  };
  const scheduledDurationSeconds = Math.max(
    0,
    Math.round(
      (input.candidate.arrivalAt.getTime() -
        input.candidate.departureAt.getTime()) /
        1_000,
    ),
  );
  const currentDurationSeconds = Math.max(
    0,
    Math.round(
      (input.arrivalAt.getTime() - input.departureAt.getTime()) / 1_000,
    ),
  );
  const eta = {
    scheduledDurationSeconds,
    currentDurationSeconds,
    shiftSeconds: input.etaShiftSeconds,
  };
  categories.eta = sha256({
    scheduledDurationBucket: Math.trunc(scheduledDurationSeconds / 300),
    currentDurationBucket: Math.trunc(currentDurationSeconds / 300),
    shiftBucket: Math.trunc(input.etaShiftSeconds / 300),
  });
  return {
    version: 1,
    hash: sha256(categories),
    categories,
    eta,
  };
}

export function createJourneyPlannerCore(input: {
  routeEngine: RouteEngine;
  accessibilityEvidence: AccessibilityEvidence;
}): JourneyPlannerCore {
  return {
    async plan(request) {
      try {
        const candidates = (
          await input.routeEngine.planCandidates({
            origin: request.origin,
            destination: request.destination,
            departureAt: new Date(request.departureAt),
          })
        ).slice(0, 5);
        if (candidates.length === 0) {
          return {
            kind: "unavailable",
            status: "unavailable",
            title: "No step-free route confirmed",
          };
        }
        const evaluatedAt = new Date(request.evaluatedAt);
        const assessments = input.accessibilityEvidence.evaluateCandidates
          ? await input.accessibilityEvidence.evaluateCandidates(
              candidates,
              evaluatedAt,
            )
          : await Promise.all(
              candidates.map((candidate) =>
                input.accessibilityEvidence.evaluate(candidate, evaluatedAt),
              ),
            );
        const bound =
          assessments.length === candidates.length
            ? candidates.map((candidate, index) => ({
                candidate,
                assessment: assessments[index]!,
              }))
            : [];
        const evaluated: EvaluatedCandidate[] = bound
          .filter(
            ({ candidate, assessment }) =>
              validAssessment(candidate, assessment) &&
              !assessmentBlocked(assessment),
          )
          .map(({ candidate, assessment }) => {
            const timeline = currentTimeline(candidate, assessment);
            return {
              candidate,
              assessment,
              timeline,
              effectiveState:
                timeline.timingUnknown && assessment.state === "confirmed"
                  ? "unknown"
                  : assessment.state,
            };
          });
        const selected = evaluated.sort(compareEvaluated)[0];
        if (!selected) {
          return {
            kind: "unavailable",
            status: "unavailable",
            title: "No step-free route confirmed",
          };
        }
        const { candidate, assessment, timeline, effectiveState } = selected;
        const departureAt = new Date(candidate.departureAt);
        const arrivalAt = new Date(timeline.arrivalAt);
        const durationMinutes = timeline.durationMinutes;
        const state = riderStatus(assessment, effectiveState);
        const legs = draftLegs(candidate, assessment, timeline);
        const warnings = warningTemplates(assessment, timeline.timingUnknown);
        const journeyChanges = changes(assessment, timeline.etaShiftSeconds);
        const fingerprint = createJourneyFingerprint({
          candidate,
          assessment,
          legs,
          warnings,
          departureAt,
          arrivalAt,
          durationMinutes,
          etaShiftSeconds: timeline.etaShiftSeconds,
        });
        return {
          kind: "selected",
          journey: {
            candidateId: candidate.id,
            status: state.status,
            title: state.title,
            departureAt,
            arrivalAt,
            durationMinutes,
            legs,
            warnings,
            changes: journeyChanges,
            sources: structuredClone(assessment.sources),
            fingerprint,
          },
        };
      } catch (error) {
        if (
          error instanceof RouteEngineUnavailableError ||
          error instanceof AccessibilityEvidenceInvalidError
        ) {
          return {
            kind: "unavailable",
            status: "unavailable",
            title: "No step-free route confirmed",
          };
        }
        throw error;
      }
    },
  };
}
