export const COMMUTE_TIMEZONE = "America/Los_Angeles" as const;
export const DEFAULT_REMINDER_MINUTES = 30 as const;

export const COMMUTE_SLOTS = ["first", "return"] as const;
export type CommuteSlot = (typeof COMMUTE_SLOTS)[number];

export const COMMUTE_DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type CommuteDay = (typeof COMMUTE_DAYS)[number];

export const REMINDER_MINUTES = [15, 30, 45, 60] as const;
export type ReminderMinutes = (typeof REMINDER_MINUTES)[number];

export type CommuteDraft = {
  originPlaceId: string;
  destinationPlaceId: string;
  days: readonly CommuteDay[];
  departureTime: string;
  reminderMinutes: ReminderMinutes;
  paused: boolean;
  timezone: typeof COMMUTE_TIMEZONE;
};

export type CommuteDraftInput = {
  originPlaceId?: unknown;
  destinationPlaceId?: unknown;
  days?: unknown;
  departureTime?: unknown;
  reminderMinutes?: unknown;
  paused?: unknown;
};

export type CommuteValidationResult =
  { ok: true; value: CommuteDraft } | { ok: false; code: "COMMUTE_INVALID" };

const PLACE_ID_PATTERN =
  /^(?:stop|station|landmark):[^\s<>\u0000-\u001f\u007f]{1,160}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const INPUT_KEYS = new Set([
  "originPlaceId",
  "destinationPlaceId",
  "days",
  "departureTime",
  "reminderMinutes",
  "paused",
]);
const DAY_SET = new Set<string>(COMMUTE_DAYS);
const REMINDER_SET = new Set<number>(REMINDER_MINUTES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCatalogPlaceId(value: unknown): value is string {
  return typeof value === "string" && PLACE_ID_PATTERN.test(value);
}

function normalizeDays(value: unknown): CommuteDay[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > 7) {
    return null;
  }
  const days = value.filter((day): day is string => typeof day === "string");
  if (
    days.length !== value.length ||
    days.some((day) => !DAY_SET.has(day)) ||
    new Set(days).size !== days.length
  ) {
    return null;
  }
  return COMMUTE_DAYS.filter((day) => days.includes(day));
}

function hasOnlyKnownKeys(value: Record<string, unknown>) {
  return Object.keys(value).every((key) => INPUT_KEYS.has(key));
}

export function isCommuteSlot(value: unknown): value is CommuteSlot {
  return (
    typeof value === "string" && COMMUTE_SLOTS.includes(value as CommuteSlot)
  );
}

export function validateCommuteDraft(input: unknown): CommuteValidationResult {
  if (!isRecord(input) || !hasOnlyKnownKeys(input)) {
    return { ok: false, code: "COMMUTE_INVALID" };
  }

  const originPlaceId = input.originPlaceId;
  const destinationPlaceId = input.destinationPlaceId;
  const days = normalizeDays(input.days);
  const departureTime = input.departureTime;
  const reminderMinutes =
    input.reminderMinutes === undefined
      ? DEFAULT_REMINDER_MINUTES
      : input.reminderMinutes;
  const paused = input.paused === undefined ? false : input.paused;

  if (
    !isCatalogPlaceId(originPlaceId) ||
    !isCatalogPlaceId(destinationPlaceId) ||
    originPlaceId === destinationPlaceId ||
    !days ||
    typeof departureTime !== "string" ||
    !TIME_PATTERN.test(departureTime) ||
    typeof reminderMinutes !== "number" ||
    !Number.isSafeInteger(reminderMinutes) ||
    !REMINDER_SET.has(reminderMinutes) ||
    typeof paused !== "boolean"
  ) {
    return { ok: false, code: "COMMUTE_INVALID" };
  }

  return {
    ok: true,
    value: {
      originPlaceId,
      destinationPlaceId,
      days,
      departureTime,
      reminderMinutes: reminderMinutes as ReminderMinutes,
      paused,
      timezone: COMMUTE_TIMEZONE,
    },
  };
}
