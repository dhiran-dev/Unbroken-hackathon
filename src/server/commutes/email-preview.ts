import {
  COMMUTE_DAYS,
  isCommuteSlot,
  type CommuteDay,
  type CommuteSlot,
} from "@/domain/commute/schedule";
import type { CommuteService, SavedCommute } from "@/domain/commute/service";
import {
  normalizeJourneyPlan,
  type SafeJourneyPlan,
} from "@/domain/journey/citywide-journey-form";
import type {
  JourneyPlan,
  JourneyPlanner,
  JourneyRequest,
} from "@/domain/journey/journey";
import { compareJourneyChanges } from "@/domain/notifications/journey-changes";
import type { TransitCatalog, PlaceChoice } from "@/domain/transit/catalog";
import {
  buildCommuteEmail,
  type CommuteEmail,
  type CommuteEmailInput,
} from "@/emails/commute-email";
import { formatDepartureTime } from "@/domain/commute/account-page";
import { formatPacific } from "@/lib/format";

const PACIFIC_TIME_ZONE = "America/Los_Angeles";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const SAFE_USER_ID = /^[^<>\u0000-\u001f\u007f]{1,255}$/u;
const INTERNAL_WORDS =
  /\b(?:fingerprint|reason|provider|outbox|queue|worker|collector|gtfs|otp|graphql|schema|protobuf|job|token|secret|operational)\b/iu;

type PacificParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};
type CalendarDate = Pick<PacificParts, "year" | "month" | "day">;

const pacificFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PACIFIC_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function pacificParts(date: Date): PacificParts {
  const values = Object.fromEntries(
    pacificFormatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  return {
    year: values.year!,
    month: values.month!,
    day: values.day!,
    hour: values.hour!,
    minute: values.minute!,
  };
}

function addDays(date: CalendarDate, amount: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day));
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function weekday(date: CalendarDate): CommuteDay {
  const day = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  return COMMUTE_DAYS[day === 0 ? 6 : day - 1]!;
}

function wallClockEquals(date: Date, expected: PacificParts) {
  const actual = pacificParts(date);
  return (
    actual.year === expected.year &&
    actual.month === expected.month &&
    actual.day === expected.day &&
    actual.hour === expected.hour &&
    actual.minute === expected.minute
  );
}

function offsetMinutesAt(instant: Date) {
  const local = pacificParts(instant);
  const localAsUtc = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
  );
  return (localAsUtc - instant.getTime()) / MINUTE_MS;
}

function offsetsNear(naiveUtc: number) {
  const offsets = new Set<number>();
  for (const delta of [-2 * DAY_MS, -DAY_MS, 0, DAY_MS, 2 * DAY_MS]) {
    offsets.add(offsetMinutesAt(new Date(naiveUtc + delta)));
  }
  return [...offsets];
}

function resolvePacificWallClock(expected: PacificParts): Date | null {
  const naiveUtc = Date.UTC(
    expected.year,
    expected.month - 1,
    expected.day,
    expected.hour,
    expected.minute,
  );
  if (!Number.isFinite(naiveUtc)) return null;

  const matches = (naive: number, wallClock: PacificParts) =>
    offsetsNear(naive)
      .map((offset) => new Date(naive - offset * MINUTE_MS))
      .filter((candidate) => wallClockEquals(candidate, wallClock))
      .sort((left, right) => left.getTime() - right.getTime());

  const exact = matches(naiveUtc, expected)[0];
  if (exact) return exact;

  const beforeOffset = offsetMinutesAt(
    new Date(naiveUtc - 12 * 60 * MINUTE_MS),
  );
  const afterOffset = offsetMinutesAt(new Date(naiveUtc + 12 * 60 * MINUTE_MS));
  if (afterOffset <= beforeOffset) return null;
  const gapMinutes = afterOffset - beforeOffset;
  const shiftedNaive = naiveUtc + gapMinutes * MINUTE_MS;
  const shifted = new Date(shiftedNaive);
  const shiftedWallClock: PacificParts = {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
  return matches(shiftedNaive, shiftedWallClock)[0] ?? null;
}

function validSchedule(schedule: SavedCommute): boolean {
  return (
    isCommuteSlot(schedule.slot) &&
    schedule.timezone === PACIFIC_TIME_ZONE &&
    Array.isArray(schedule.days) &&
    schedule.days.length > 0 &&
    new Set(schedule.days).size === schedule.days.length &&
    schedule.days.every((day) => COMMUTE_DAYS.includes(day)) &&
    TIME_PATTERN.test(schedule.departureTime)
  );
}

/**
 * Resolve a recurring commute to its next Pacific departure. This helper is
 * pure and uses the same explicit DST policy as the notification scheduler.
 */
export function nextCommuteDeparture(
  schedule: Pick<SavedCommute, "days" | "departureTime" | "timezone">,
  now: Date,
): Date | null {
  if (
    schedule.timezone !== PACIFIC_TIME_ZONE ||
    !Array.isArray(schedule.days) ||
    schedule.days.length === 0 ||
    new Set(schedule.days).size !== schedule.days.length ||
    !schedule.days.every((day) => COMMUTE_DAYS.includes(day)) ||
    !TIME_PATTERN.test(schedule.departureTime) ||
    !Number.isFinite(now.getTime())
  ) {
    return null;
  }
  const [hourText, minuteText] = schedule.departureTime.split(":");
  const today = pacificParts(now);
  for (let offset = 0; offset <= 7; offset += 1) {
    const date = addDays(today, offset);
    if (!schedule.days.includes(weekday(date))) continue;
    const candidate = resolvePacificWallClock({
      ...date,
      hour: Number(hourText),
      minute: Number(minuteText),
    });
    if (candidate && candidate.getTime() >= now.getTime()) return candidate;
  }
  return null;
}

function validUserId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value === value.trim() &&
    SAFE_USER_ID.test(value)
  );
}

function approvedAppOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const origin = new URL(value);
    if (
      origin.protocol !== "https:" ||
      !origin.hostname ||
      origin.pathname !== "/" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash
    ) {
      return null;
    }
    return origin.origin;
  } catch {
    return null;
  }
}

export type CommuteEmailPreviewDependencies = {
  schedules: Pick<CommuteService, "listForRider">;
  catalog: Pick<TransitCatalog, "getPlace">;
  planner: Pick<JourneyPlanner, "plan">;
  renderEmail?: (input: CommuteEmailInput) => CommuteEmail;
  clock?: () => Date;
  appOrigin: string;
};

export type CommuteEmailPreview = {
  previewForRider(
    userId: string,
    slot: CommuteSlot,
  ): Promise<CommuteEmail | null>;
};

function validEmail(value: unknown): value is CommuteEmail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.subject === "string" &&
    candidate.subject.length > 0 &&
    candidate.subject.length <= 160 &&
    candidate.subject === candidate.subject.trim() &&
    !/[<>\u0000-\u001f\u007f]/u.test(candidate.subject) &&
    typeof candidate.html === "string" &&
    candidate.html.length > 0 &&
    candidate.html.length <= 200_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.html) &&
    typeof candidate.text === "string" &&
    candidate.text.length > 0 &&
    candidate.text.length <= 50_000 &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(candidate.text) &&
    !INTERNAL_WORDS.test(candidate.subject) &&
    !INTERNAL_WORDS.test(candidate.html) &&
    !INTERNAL_WORDS.test(candidate.text)
  );
}

function placeLabel(place: PlaceChoice) {
  return place.name;
}

export function createCommuteEmailPreview(
  dependencies: CommuteEmailPreviewDependencies,
): CommuteEmailPreview {
  const render = dependencies.renderEmail ?? buildCommuteEmail;
  const clock = dependencies.clock ?? (() => new Date());

  return {
    async previewForRider(userId, slot) {
      if (!validUserId(userId) || !isCommuteSlot(slot)) {
        throw new Error("COMMUTE_PREVIEW_OWNER_INVALID");
      }
      const appOrigin = approvedAppOrigin(dependencies.appOrigin);
      if (!appOrigin) throw new Error("COMMUTE_PREVIEW_ORIGIN_INVALID");
      const commutes = await dependencies.schedules.listForRider(userId);
      if (!Array.isArray(commutes)) throw new Error("COMMUTE_STORE_INVALID");
      const matches = commutes.filter((commute) => commute?.slot === slot);
      if (matches.length === 0) return null;
      if (matches.length !== 1 || !validSchedule(matches[0]!)) {
        throw new Error("COMMUTE_STORE_INVALID");
      }
      const schedule = matches[0]!;
      const departureAt = nextCommuteDeparture(schedule, clock());
      if (!departureAt) throw new Error("COMMUTE_PREVIEW_DATE_UNAVAILABLE");

      const [origin, destination] = await Promise.all([
        dependencies.catalog.getPlace({ placeId: schedule.originPlaceId }),
        dependencies.catalog.getPlace({
          placeId: schedule.destinationPlaceId,
        }),
      ]);
      if (
        !origin ||
        origin.id !== schedule.originPlaceId ||
        !destination ||
        destination.id !== schedule.destinationPlaceId
      ) {
        throw new Error("COMMUTE_PLACE_UNAVAILABLE");
      }

      const request: JourneyRequest = {
        origin: { type: "catalog", placeId: origin.id },
        destination: { type: "catalog", placeId: destination.id },
        departureAt: departureAt.toISOString(),
      };
      const planned: JourneyPlan = await dependencies.planner.plan(request);
      const safePlan: SafeJourneyPlan | null = normalizeJourneyPlan(planned);
      if (!safePlan || safePlan.departureAt !== request.departureAt) {
        throw new Error("COMMUTE_PLAN_INVALID");
      }

      // The current My Trips cards do not expose stable card IDs. Keep the
      // link on the page itself until a reviewed UI anchor is available.
      const manageUrl = new URL("/rider/trips", appOrigin).toString();
      const input: CommuteEmailInput = {
        schedule: {
          originLabel: placeLabel(origin),
          destinationLabel: placeLabel(destination),
          departureLabel: formatDepartureTime(schedule.departureTime),
          arrivalLabel: formatPacific(new Date(safePlan.arrivalAt)),
        },
        plan: safePlan,
        // Preview is intentionally current-only: this seam has no trusted
        // prior journey snapshot, so no unsent history crosses into rendering.
        changes: compareJourneyChanges({
          current: { plan: safePlan },
          previous: null,
        }),
        manageUrl,
        appOrigin,
      };
      const message = render(input);
      if (!validEmail(message)) throw new Error("COMMUTE_EMAIL_INVALID");
      return message;
    },
  };
}
