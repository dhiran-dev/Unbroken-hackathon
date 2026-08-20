import {
  normalizeJourneyPlan,
  type SafeJourneyLeg,
  type SafeJourneyPlan,
  type SafeJourneyPlanStatus,
  type SafeJourneySource,
} from "@/domain/journey/citywide-journey-form";

const STATUS_LABELS: Record<SafeJourneyPlanStatus, string> = {
  confirmed: "Step-free details confirmed",
  check_details: "Some details need checking",
  unavailable: "No step-free route confirmed",
  updates_unavailable: "Current updates are unavailable",
};

const LEG_TYPE_LABELS: Record<SafeJourneyLeg["type"], string> = {
  walk: "Walk",
  wait: "Wait",
  ride: "Ride",
  transfer: "Transfer",
};

const ACCESSIBILITY_LABELS: Record<
  SafeJourneyLeg["accessibility"]["state"],
  string
> = {
  confirmed: "Step-free details confirmed",
  unknown: "Some details need checking",
  blocked: "No step-free route confirmed",
};

const SOURCE_LABELS: Record<SafeJourneySource["source"], string> = {
  schedule: "Muni schedule",
  arrivals: "Arrival updates",
  vehicles: "Vehicle locations",
  service_changes: "Service changes",
  stop_changes: "Stop changes",
  elevators: "Elevators",
  station_access: "Station access",
};

const FRESHNESS_LABELS: Record<SafeJourneySource["freshness"], string> = {
  current: "Current",
  older: "Older information",
  unavailable: "Unavailable",
};

const MAX_RIDER_LEGS = 32;
const MAX_RIDER_LIST_ITEMS = 64;
const MAX_RIDER_SOURCES = 7;

export type JourneyResultLeg = {
  typeLabel: string;
  from: string;
  to: string;
  instruction: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  route?: {
    name: string;
    destination: string;
  };
  accessibilityLabel: string;
};

export type JourneyResultSource = {
  sourceLabel: string;
  freshnessLabel: string;
  checkedAt: string | null;
  sourceUpdatedAt: string | null;
  sourceUrl: string;
};

export type JourneyResultView = {
  status: SafeJourneyPlanStatus;
  statusLabel: string;
  summary: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  legs: JourneyResultLeg[];
  warnings: string[];
  changes: string[];
  sources: JourneyResultSource[];
};

function presentLeg(leg: SafeJourneyLeg): JourneyResultLeg {
  const route =
    leg.type === "ride" && leg.route
      ? {
          name: leg.route.name,
          destination: leg.route.destination,
        }
      : undefined;

  return {
    typeLabel: LEG_TYPE_LABELS[leg.type],
    from: leg.from,
    to: leg.to,
    instruction: leg.instruction,
    startAt: leg.startAt,
    endAt: leg.endAt,
    durationMinutes: leg.durationMinutes,
    ...(route ? { route } : {}),
    accessibilityLabel: ACCESSIBILITY_LABELS[leg.accessibility.state],
  };
}

function presentSource(source: SafeJourneySource): JourneyResultSource {
  return {
    sourceLabel: SOURCE_LABELS[source.source],
    freshnessLabel: FRESHNESS_LABELS[source.freshness],
    checkedAt: source.checkedAt,
    sourceUpdatedAt: source.sourceUpdatedAt,
    sourceUrl: source.sourceUrl,
  };
}

/**
 * Project a public journey response into the small rider-facing result seam.
 *
 * Normalization is deliberately inside this module so every caller receives
 * the same bounded, defensive projection and no map or internal evidence
 * fields can leak into the public itinerary.
 */
export function presentJourneyResult(value: unknown): JourneyResultView | null {
  const plan: SafeJourneyPlan | null = normalizeJourneyPlan(value);
  if (!plan) return null;

  return {
    status: plan.status,
    statusLabel: STATUS_LABELS[plan.status],
    summary: plan.summary,
    departureAt: plan.departureAt,
    arrivalAt: plan.arrivalAt,
    durationMinutes: plan.durationMinutes,
    legs: plan.legs.slice(0, MAX_RIDER_LEGS).map(presentLeg),
    warnings: plan.warnings.slice(0, MAX_RIDER_LIST_ITEMS),
    changes: plan.changes.slice(0, MAX_RIDER_LIST_ITEMS),
    sources: plan.sources.slice(0, MAX_RIDER_SOURCES).map(presentSource),
  };
}
