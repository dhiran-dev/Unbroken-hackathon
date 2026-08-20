import {
  COMMUTE_DAYS,
  COMMUTE_SLOTS,
  REMINDER_MINUTES,
  isCommuteSlot,
  type CommuteDay,
  type CommuteSlot,
  type ReminderMinutes,
} from "@/domain/commute/schedule";
import {
  normalizePlaceGroups,
  type CitywidePlace,
} from "@/domain/journey/citywide-journey-form";
import type { SavedCommute } from "@/domain/commute/service";

export const COMMUTE_ACCOUNT_SLOTS = COMMUTE_SLOTS;

export type CommutePlaceChoice = CitywidePlace;

export type SavedCommuteCard = {
  slot: CommuteSlot;
  commute: SavedCommute | null;
};

export type CommuteFormValue = {
  origin: CommutePlaceChoice | null;
  destination: CommutePlaceChoice | null;
  days: readonly CommuteDay[];
  departureTime: string;
  reminderMinutes: ReminderMinutes;
  paused: boolean;
};

export type CommuteDraft = Omit<CommuteFormValue, "origin" | "destination"> & {
  originPlaceId: string;
  destinationPlaceId: string;
};

export type SafeHistoryEntry = {
  serviceDate: string;
  slot: CommuteSlot;
  status: "sent" | "failed" | "pending" | "suppressed";
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const PLACE_ID_PATTERN =
  /^(?:stop|station|landmark):[^\s<>\u0000-\u001f\u007f]{1,160}$/u;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/u;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const GROUP_IDS = ["nearby_stops", "stations", "places"] as const;
const MAX_PLACE_RELATIONS = 64;
const SF_PLACE_BOUNDS = {
  minimumLatitude: 37.6,
  maximumLatitude: 37.95,
  minimumLongitude: -122.65,
  maximumLongitude: -122.25,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeText(value: unknown, maximum: number): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximum &&
    value.trim() === value &&
    !/[<>\u0000-\u001f\u007f]/u.test(value)
  );
}

function isSafeTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_TIMESTAMP_PATTERN.test(value)) {
    return false;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return false;
  const parsed = new Date(timestamp).toISOString();
  return parsed === value;
}

function normalizeSavedCommute(value: unknown): SavedCommute | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    !isCommuteSlot(value.slot) ||
    !PLACE_ID_PATTERN.test(
      typeof value.originPlaceId === "string" ? value.originPlaceId : "",
    ) ||
    !PLACE_ID_PATTERN.test(
      typeof value.destinationPlaceId === "string"
        ? value.destinationPlaceId
        : "",
    ) ||
    value.originPlaceId === value.destinationPlaceId ||
    !Array.isArray(value.days) ||
    value.days.length === 0 ||
    value.days.length > COMMUTE_DAYS.length ||
    !value.days.every((day) => COMMUTE_DAYS.includes(day as CommuteDay)) ||
    new Set(value.days).size !== value.days.length ||
    typeof value.departureTime !== "string" ||
    !TIME_PATTERN.test(value.departureTime) ||
    typeof value.timezone !== "string" ||
    value.timezone !== "America/Los_Angeles" ||
    typeof value.reminderMinutes !== "number" ||
    !REMINDER_MINUTES.includes(value.reminderMinutes as ReminderMinutes) ||
    typeof value.paused !== "boolean" ||
    !isSafeTimestamp(value.createdAt) ||
    !isSafeTimestamp(value.updatedAt)
  ) {
    return null;
  }

  const originPlaceId = value.originPlaceId as string;
  const destinationPlaceId = value.destinationPlaceId as string;
  const days = value.days as unknown[];
  const departureTime = value.departureTime as string;
  const createdAt = value.createdAt as string;
  const updatedAt = value.updatedAt as string;

  return {
    id: value.id,
    slot: value.slot,
    originPlaceId,
    destinationPlaceId,
    days: COMMUTE_DAYS.filter((day) => days.includes(day)),
    departureTime,
    timezone: "America/Los_Angeles",
    reminderMinutes: value.reminderMinutes as ReminderMinutes,
    paused: value.paused,
    createdAt,
    updatedAt,
  };
}

export function normalizeCommutesPayload(
  value: unknown,
): SavedCommute[] | null {
  if (!isRecord(value) || !Array.isArray(value.commutes)) return null;
  if (value.commutes.length > COMMUTE_ACCOUNT_SLOTS.length) return null;

  const normalized = value.commutes.map(normalizeSavedCommute);
  if (normalized.some((commute) => commute === null)) return null;
  const commutes = normalized.filter(
    (commute): commute is SavedCommute => commute !== null,
  );
  if (
    new Set(commutes.map((commute) => commute.slot)).size !== commutes.length
  ) {
    return null;
  }
  return commutes.sort((left, right) =>
    left.slot === right.slot ? 0 : left.slot === "first" ? -1 : 1,
  );
}

export function normalizeEmailHistoryPayload(
  value: unknown,
): SafeHistoryEntry[] | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.deliveries) ||
    value.deliveries.length > 20
  ) {
    return null;
  }
  const entries: SafeHistoryEntry[] = [];
  const keys = new Set<string>();
  for (const item of value.deliveries) {
    if (!isRecord(item)) return null;
    const serviceDate = item.serviceDate;
    const slot = item.slot;
    const status = item.status;
    if (
      typeof serviceDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(serviceDate) ||
      !Number.isFinite(Date.parse(`${serviceDate}T00:00:00.000Z`)) ||
      new Date(`${serviceDate}T00:00:00.000Z`).toISOString().slice(0, 10) !==
        serviceDate ||
      !isCommuteSlot(slot) ||
      keys.has(`${serviceDate}-${slot}`) ||
      (status !== "sent" &&
        status !== "failed" &&
        status !== "pending" &&
        status !== "suppressed")
    ) {
      return null;
    }
    keys.add(`${serviceDate}-${slot}`);
    entries.push({ serviceDate, slot, status });
  }
  return entries;
}

export function createEmptyCommuteCards(
  commutes: readonly SavedCommute[],
): SavedCommuteCard[] {
  return COMMUTE_ACCOUNT_SLOTS.map((slot) => ({
    slot,
    commute: commutes.find((commute) => commute.slot === slot) ?? null,
  }));
}

export function createCommuteFormValue(
  commute: SavedCommute,
  places: readonly CommutePlaceChoice[],
): CommuteFormValue {
  const byId = new Map(places.map((place) => [place.id, place]));
  return {
    origin: byId.get(commute.originPlaceId) ?? null,
    destination: byId.get(commute.destinationPlaceId) ?? null,
    days: [...commute.days],
    departureTime: commute.departureTime,
    reminderMinutes: commute.reminderMinutes,
    paused: commute.paused,
  };
}

export function normalizePlaceSearchPayload(
  value: unknown,
): [CommutePlaceChoice[], CommutePlaceChoice[], CommutePlaceChoice[]] | null {
  if (!isRecord(value) || !Array.isArray(value.groups)) return null;
  const groups = value.groups;
  if (groups.length !== GROUP_IDS.length) return null;
  const ids = groups.map((group) => (isRecord(group) ? group.id : null));
  if (
    ids.length !== GROUP_IDS.length ||
    ids.some((id, index) => id !== GROUP_IDS[index])
  ) {
    return null;
  }
  const normalized = normalizePlaceGroups(value);
  if (normalized.length !== GROUP_IDS.length) return null;
  if (
    normalized.some((group) =>
      group.places.some((place) => !isSafePlaceChoice(place)),
    )
  ) {
    return null;
  }
  return normalized.map((group) => group.places) as [
    CommutePlaceChoice[],
    CommutePlaceChoice[],
    CommutePlaceChoice[],
  ];
}

export function toCommuteDraft(value: CommuteFormValue): CommuteDraft | null {
  if (
    !isSafePlaceChoice(value.origin) ||
    !isSafePlaceChoice(value.destination) ||
    value.origin.id === value.destination.id ||
    value.days.length === 0 ||
    new Set(value.days).size !== value.days.length ||
    !value.days.every((day) => COMMUTE_DAYS.includes(day)) ||
    !TIME_PATTERN.test(value.departureTime) ||
    !REMINDER_MINUTES.includes(value.reminderMinutes)
  ) {
    return null;
  }
  return {
    originPlaceId: value.origin.id,
    destinationPlaceId: value.destination.id,
    days: COMMUTE_DAYS.filter((day) => value.days.includes(day)),
    departureTime: value.departureTime,
    reminderMinutes: value.reminderMinutes,
    paused: value.paused,
  };
}

export function toStoredCommuteDraft(
  commute: SavedCommute,
  paused: boolean,
): Omit<CommuteDraft, "origin" | "destination"> {
  return {
    originPlaceId: commute.originPlaceId,
    destinationPlaceId: commute.destinationPlaceId,
    days: [...commute.days],
    departureTime: commute.departureTime,
    reminderMinutes: commute.reminderMinutes,
    paused,
  };
}

const DAY_LABELS: Record<CommuteDay, string> = {
  monday: "Monday",
  tuesday: "Tuesday",
  wednesday: "Wednesday",
  thursday: "Thursday",
  friday: "Friday",
  saturday: "Saturday",
  sunday: "Sunday",
};

export function formatCommuteDays(days: readonly CommuteDay[]): string {
  if (days.length === 0) return "No days selected";
  return COMMUTE_DAYS.filter((day) => days.includes(day))
    .map((day) => DAY_LABELS[day])
    .join(", ");
}

export function formatDepartureTime(value: string): string {
  if (!TIME_PATTERN.test(value)) return "Time unavailable";
  const [hourText, minute] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isSafeInteger(hour) || minute === undefined) {
    return "Time unavailable";
  }
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${minute} ${suffix}`;
}

export function slotLabel(slot: CommuteSlot): "First trip" | "Return trip" {
  return slot === "first" ? "First trip" : "Return trip";
}

export function reminderLabel(minutes: ReminderMinutes): string {
  return `${minutes} minutes before`;
}

export function isSafePlaceChoice(value: unknown): value is CommutePlaceChoice {
  if (!isRecord(value)) return false;
  return (
    PLACE_ID_PATTERN.test(typeof value.id === "string" ? value.id : "") &&
    (value.type === "stop" ||
      value.type === "station" ||
      value.type === "landmark") &&
    isSafeText(value.name, 240) &&
    isSafeText(value.description, 500) &&
    typeof value.latitude === "number" &&
    Number.isFinite(value.latitude) &&
    typeof value.longitude === "number" &&
    Number.isFinite(value.longitude) &&
    value.latitude >= SF_PLACE_BOUNDS.minimumLatitude &&
    value.latitude <= SF_PLACE_BOUNDS.maximumLatitude &&
    value.longitude >= SF_PLACE_BOUNDS.minimumLongitude &&
    value.longitude <= SF_PLACE_BOUNDS.maximumLongitude &&
    Array.isArray(value.stopIds) &&
    value.stopIds.length <= MAX_PLACE_RELATIONS &&
    new Set(value.stopIds).size === value.stopIds.length &&
    value.stopIds.every((item) => isSafeText(item, 160)) &&
    Array.isArray(value.routeNames) &&
    value.routeNames.length <= MAX_PLACE_RELATIONS &&
    new Set(value.routeNames).size === value.routeNames.length &&
    value.routeNames.every((item) => isSafeText(item, 160))
  );
}
