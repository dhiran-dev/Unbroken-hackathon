import {
  normalizeJourneyPlan,
  type SafeJourneyPlan,
} from "@/domain/journey/citywide-journey-form";
import type { JourneyFingerprint } from "@/domain/journey/journey-planner";

export type JourneyPlanSafeSnapshot = {
  plan: SafeJourneyPlan | null;
  fingerprint?: JourneyFingerprint | null;
};

export type JourneyChangeInput = {
  current: JourneyPlanSafeSnapshot;
  previous?: JourneyPlanSafeSnapshot | null;
};

export type JourneyChangeSectionTitle =
  "What changed" | "What is working" | "What needs checking";

export type JourneyChangeSection = {
  title: JourneyChangeSectionTitle;
  items: string[];
};

export type JourneyChangeSummary = {
  sections: [
    JourneyChangeSection & { title: "What changed" },
    JourneyChangeSection & { title: "What is working" },
    JourneyChangeSection & { title: "What needs checking" },
  ];
};

type NormalizedSnapshot = {
  plan: SafeJourneyPlan | null;
  fingerprint: JourneyFingerprint | null;
};

type ChangeCategory = keyof JourneyFingerprint["categories"];

const MAX_FINGERPRINT_TEXT = 256;
const MAX_FINGERPRINT_SECONDS = 24 * 60 * 60;
const MATERIAL_ETA_SECONDS = 5 * 60;
const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;
const ELEVATOR_WARNING_TEXT = new Set([
  "A needed elevator is out of service.",
  "Current elevator details need checking.",
  "Step-free station access is unavailable.",
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeInternalText(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_FINGERPRINT_TEXT &&
    value === value.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function safeFingerprintText(value: unknown): value is string {
  return safeInternalText(value) && FINGERPRINT_PATTERN.test(value);
}

function safeSeconds(value: unknown, allowNegative = false): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    Number.isFinite(value) &&
    Math.abs(value) <= MAX_FINGERPRINT_SECONDS &&
    (allowNegative || value >= 0)
  );
}

function normalizeFingerprint(value: unknown): JourneyFingerprint | null {
  if (!record(value) || value.version !== 1) return null;
  if (!safeFingerprintText(value.hash) || !record(value.categories))
    return null;
  if (!record(value.eta)) return null;
  const hash = value.hash;
  const categories = value.categories;
  const eta = value.eta;

  const categoryNames: ChangeCategory[] = [
    "route",
    "stop",
    "elevator",
    "warning",
    "eta",
  ];
  if (!categoryNames.every((name) => safeFingerprintText(categories[name]))) {
    return null;
  }
  if (
    !safeSeconds(eta.scheduledDurationSeconds) ||
    !safeSeconds(eta.currentDurationSeconds) ||
    !safeSeconds(eta.shiftSeconds, true)
  ) {
    return null;
  }

  return {
    version: 1,
    hash,
    categories: {
      route: categories.route as string,
      stop: categories.stop as string,
      elevator: categories.elevator as string,
      warning: categories.warning as string,
      eta: categories.eta as string,
    },
    eta: {
      scheduledDurationSeconds: eta.scheduledDurationSeconds,
      currentDurationSeconds: eta.currentDurationSeconds,
      shiftSeconds: eta.shiftSeconds,
    },
  };
}

function normalizeSnapshot(value: unknown): NormalizedSnapshot | null {
  if (!record(value) || !("plan" in value)) return null;

  const rawPlan = value.plan;
  const plan = rawPlan === null ? null : normalizeJourneyPlan(rawPlan);
  if (rawPlan !== null && plan === null) return null;

  const hasFingerprint =
    value.fingerprint !== undefined && value.fingerprint !== null;
  const fingerprint = hasFingerprint
    ? normalizeFingerprint(value.fingerprint)
    : null;
  if (hasFingerprint && !fingerprint) return null;

  return { plan, fingerprint };
}

function canonicalList(values: readonly string[]) {
  return JSON.stringify(
    [...new Set(values.map((value) => value.trim()))].sort(),
  );
}

function routeSignature(plan: SafeJourneyPlan | null) {
  if (!plan) return "";
  return JSON.stringify(
    plan.legs
      .filter((leg) => leg.type === "ride")
      .map((leg) => [leg.route?.name ?? "", leg.route?.destination ?? ""]),
  );
}

function stopSignature(plan: SafeJourneyPlan | null) {
  if (!plan) return "";
  return JSON.stringify(
    plan.legs
      .filter((leg) => leg.type === "ride")
      .map((leg) => [leg.from, leg.to]),
  );
}

function warningSignature(plan: SafeJourneyPlan | null) {
  return canonicalList(plan?.warnings ?? []);
}

function elevatorSignature(plan: SafeJourneyPlan | null) {
  return canonicalList(
    (plan?.warnings ?? []).filter((warning) =>
      ELEVATOR_WARNING_TEXT.has(warning),
    ),
  );
}

function fallbackCategory(
  category: ChangeCategory,
  current: NormalizedSnapshot,
  previous: NormalizedSnapshot,
) {
  const signatures: Record<
    ChangeCategory,
    (plan: SafeJourneyPlan | null) => string
  > = {
    route: routeSignature,
    stop: stopSignature,
    elevator: elevatorSignature,
    warning: warningSignature,
    eta: (plan) => (plan ? String(plan.durationMinutes) : ""),
  };
  return (
    signatures[category](current.plan) !== signatures[category](previous.plan)
  );
}

function categoryChanged(
  category: ChangeCategory,
  current: NormalizedSnapshot,
  previous: NormalizedSnapshot,
) {
  if (current.fingerprint && previous.fingerprint) {
    return (
      current.fingerprint.categories[category] !==
      previous.fingerprint.categories[category]
    );
  }
  return fallbackCategory(category, current, previous);
}

function materialEtaDeltaSeconds(
  current: NormalizedSnapshot,
  previous: NormalizedSnapshot,
) {
  if (current.fingerprint && previous.fingerprint) {
    return (
      current.fingerprint.eta.currentDurationSeconds -
      previous.fingerprint.eta.currentDurationSeconds
    );
  }
  if (current.plan && previous.plan) {
    return (current.plan.durationMinutes - previous.plan.durationMinutes) * 60;
  }
  return null;
}

function statusOf(plan: SafeJourneyPlan | null) {
  return plan?.status ?? null;
}

function addStatusChange(
  changed: string[],
  current: NormalizedSnapshot,
  previous: NormalizedSnapshot,
) {
  const currentStatus = statusOf(current.plan);
  const previousStatus = statusOf(previous.plan);
  if (currentStatus === previousStatus) return;

  if (currentStatus === "confirmed" && previousStatus !== "confirmed") {
    changed.push("A step-free journey is now confirmed.");
  } else if (currentStatus !== "confirmed" && previousStatus === "confirmed") {
    changed.push("A step-free route is no longer confirmed.");
  }
}

function addEtaChange(changed: string[], deltaSeconds: number | null) {
  if (deltaSeconds === null || Math.abs(deltaSeconds) < MATERIAL_ETA_SECONDS) {
    return;
  }
  const minutes = Math.max(5, Math.round(Math.abs(deltaSeconds) / 60));
  changed.push(
    `Your arrival is about ${minutes} minutes ${deltaSeconds > 0 ? "later" : "earlier"}.`,
  );
}

function addCurrentChecking(
  needsChecking: string[],
  current: NormalizedSnapshot,
) {
  if (!current.plan) {
    needsChecking.push("No step-free route is confirmed right now.");
    return;
  }

  if (current.plan.status === "check_details") {
    needsChecking.push("Some journey details need checking.");
  } else if (current.plan.status === "unavailable") {
    needsChecking.push("No step-free route is confirmed right now.");
  } else if (current.plan.status === "updates_unavailable") {
    needsChecking.push("Current journey updates are unavailable.");
  }

  if (current.plan.warnings.length > 0) {
    needsChecking.push("Some journey details need checking.");
  }
  if (
    current.plan.warnings.some((warning) => ELEVATOR_WARNING_TEXT.has(warning))
  ) {
    needsChecking.push("Elevator access needs checking.");
  }
}

function buildFallbackSummary(): JourneyChangeSummary {
  return {
    sections: [
      { title: "What changed", items: [] },
      { title: "What is working", items: [] },
      {
        title: "What needs checking",
        items: ["Current journey details need checking."],
      },
    ],
  };
}

export function compareJourneyChanges(
  input: JourneyChangeInput,
): JourneyChangeSummary {
  const current = normalizeSnapshot(input?.current);
  if (!current) return buildFallbackSummary();

  const previous =
    input.previous === undefined || input.previous === null
      ? null
      : normalizeSnapshot(input.previous);
  const changed: string[] = [];
  const working: string[] = [];
  const needsChecking: string[] = [];

  if (previous) {
    addStatusChange(changed, current, previous);
    if (current.plan && previous.plan) {
      if (categoryChanged("route", current, previous)) {
        changed.push("Your Muni route changed.");
      }
      if (categoryChanged("stop", current, previous)) {
        changed.push("A boarding or exit stop changed.");
      }
      if (categoryChanged("elevator", current, previous)) {
        changed.push("Elevator access changed.");
      }
      if (categoryChanged("warning", current, previous)) {
        changed.push("A journey warning changed.");
      }
      addEtaChange(changed, materialEtaDeltaSeconds(current, previous));
    }
  }

  if (current.plan?.status === "confirmed") {
    working.push(
      previous?.plan?.status === "confirmed"
        ? "Your step-free journey is still confirmed."
        : "Your step-free journey is confirmed.",
    );
  }

  addCurrentChecking(needsChecking, current);

  if (previous && changed.length === 0) {
    changed.push("No changes to your journey.");
  }

  return {
    sections: [
      { title: "What changed", items: changed },
      { title: "What is working", items: working },
      {
        title: "What needs checking",
        items: [...new Set(needsChecking)],
      },
    ],
  };
}
