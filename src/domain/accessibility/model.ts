export type ElevatorState = "working" | "out_of_service" | "unknown";

export type RiderStationState =
  | "accessible"
  | "limited"
  | "unavailable"
  | "unknown";

export type PublicElevator = {
  sourceKey: string;
  name: string;
  state: ElevatorState;
  lastChangedAt: Date | null;
  role?: string;
  alternativeName?: string | null;
};

export type PublicStation = {
  slug: string;
  name: string;
  corridorOrder: number;
  state: RiderStationState;
  elevators: PublicElevator[];
};

export type PublicTrust = {
  state: "current" | "older";
  sourceValidAt: Date;
  ageSeconds: number;
};

export type PublicAccessibility = {
  trust: PublicTrust;
  counts: Record<RiderStationState, number>;
  stations: PublicStation[];
};

export function toElevatorState(
  state: "in_service" | "out_of_service" | "unknown",
): ElevatorState {
  if (state === "in_service") return "working";
  return state;
}

export function deriveRiderStationState(
  reported: "accessible" | "limited" | "unavailable" | "unknown",
  elevatorStates: ElevatorState[],
): RiderStationState {
  if (reported === "unavailable") return "unavailable";
  if (reported === "unknown" || elevatorStates.length === 0) return "unknown";
  if (
    reported === "limited" ||
    elevatorStates.some((state) => state !== "working")
  ) {
    return "limited";
  }
  return "accessible";
}

export function riderStateLabel(state: RiderStationState) {
  return {
    accessible: "Step-free access available",
    limited: "Step-free access with changes",
    unavailable: "No confirmed step-free access",
    unknown: "Access not confirmed",
  }[state];
}

export function elevatorStateLabel(state: ElevatorState) {
  return {
    working: "Working",
    out_of_service: "Out of service",
    unknown: "Status not confirmed",
  }[state];
}
