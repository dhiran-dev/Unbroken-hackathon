/**
 * Pacific-time due-window calculation for saved commute schedules.
 *
 * This module deliberately knows nothing about riders, email addresses, or
 * persistence. A caller supplies schedules and the schedule/date tokens that
 * have already been prepared. The caller's durable uniqueness constraint is
 * the final race-safe once-only gate; this calculation keeps a restarted
 * worker from presenting a token it already knows was prepared.
 */

export const PACIFIC_TIME_ZONE = "America/Los_Angeles" as const;

export const REMINDER_LEAD_MINUTES = [15, 30, 45, 60] as const;

export type ReminderLeadMinutes = (typeof REMINDER_LEAD_MINUTES)[number];

/** ISO weekday number in the schedule's Pacific calendar: Monday = 1. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The persistence adapter's small input projection for one saved commute. */
export type SavedCommuteSchedule = {
  id: string;
  active: boolean;
  weekdays: readonly Weekday[];
  /** A Pacific wall-clock time in `HH:mm` form. */
  departureTime: string;
  reminderLeadMinutes: ReminderLeadMinutes;
};

/** A due item safe to hand to a notification planner or outbox adapter. */
export type DueSchedule = {
  scheduleId: string;
  serviceDate: string;
  dueAt: Date;
  departureAt: Date;
  leadMinutes: ReminderLeadMinutes;
  idempotencyKey: string;
};

export type FindDueSchedulesInput = {
  schedules: readonly SavedCommuteSchedule[];
  now: Date;
  /** Durable schedule/date keys already prepared by the notification layer. */
  preparedTokens?: ReadonlySet<string>;
};

type PacificParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

type CalendarDate = Pick<PacificParts, "year" | "month" | "day">;

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

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

function calendarDateString(date: CalendarDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(
    2,
    "0",
  )}-${String(date.day).padStart(2, "0")}`;
}

function addCalendarDays(date: CalendarDate, amount: number): CalendarDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day));
  shifted.setUTCDate(shifted.getUTCDate() + amount);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function isoWeekday(date: CalendarDate): Weekday {
  const day = new Date(
    Date.UTC(date.year, date.month - 1, date.day),
  ).getUTCDay();
  return (day === 0 ? 7 : day) as Weekday;
}

function wallClockFromDate(date: Date): PacificParts {
  return pacificParts(date);
}

function wallClockEquals(date: Date, wallClock: PacificParts): boolean {
  const actual = wallClockFromDate(date);
  return (
    actual.year === wallClock.year &&
    actual.month === wallClock.month &&
    actual.day === wallClock.day &&
    actual.hour === wallClock.hour &&
    actual.minute === wallClock.minute
  );
}

/** Return the Pacific offset at an instant, in whole minutes east of UTC. */
function offsetMinutesAt(instant: Date): number {
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

function offsetsNear(naiveUtc: number): number[] {
  const offsets = new Set<number>();
  for (const delta of [-2 * DAY_MS, -DAY_MS, 0, DAY_MS, 2 * DAY_MS]) {
    offsets.add(offsetMinutesAt(new Date(naiveUtc + delta)));
  }
  return [...offsets];
}

/**
 * Resolve one Pacific wall-clock value to an instant.
 *
 * Normal times have one match. During fall-back, the earlier instant is used
 * so one saved service date produces one predictable occurrence. During the
 * spring-forward gap, the wall clock is shifted by the DST gap to the next
 * valid instant, matching the usual recurring-calendar policy.
 */
function pacificWallClockToDate(wallClock: PacificParts): Date | null {
  const naiveUtc = Date.UTC(
    wallClock.year,
    wallClock.month - 1,
    wallClock.day,
    wallClock.hour,
    wallClock.minute,
  );
  if (!Number.isFinite(naiveUtc)) return null;

  const matches = (naive: number, expected: PacificParts): Date[] =>
    offsetsNear(naive)
      .map((offset) => new Date(naive - offset * MINUTE_MS))
      .filter((candidate) => wallClockEquals(candidate, expected))
      .sort((left, right) => left.getTime() - right.getTime());

  const exactMatches = matches(naiveUtc, wallClock);
  if (exactMatches[0]) return exactMatches[0];

  // No exact match means this wall-clock time is in a forward DST gap. The
  // Twelve-hour samples are safely on opposite sides for America/Los_Angeles.
  const beforeOffset = offsetMinutesAt(new Date(naiveUtc - 12 * HOUR_MS));
  const afterOffset = offsetMinutesAt(new Date(naiveUtc + 12 * HOUR_MS));
  if (afterOffset <= beforeOffset) return null;

  const gapMinutes = afterOffset - beforeOffset;
  const shiftedNaive = naiveUtc + gapMinutes * MINUTE_MS;
  const shiftedDate = new Date(shiftedNaive);
  const shiftedWallClock = {
    year: shiftedDate.getUTCFullYear(),
    month: shiftedDate.getUTCMonth() + 1,
    day: shiftedDate.getUTCDate(),
    hour: shiftedDate.getUTCHours(),
    minute: shiftedDate.getUTCMinutes(),
  };
  return matches(shiftedNaive, shiftedWallClock)[0] ?? null;
}

function parseDepartureTime(
  value: string,
): Pick<PacificParts, "hour" | "minute"> | null {
  if (typeof value !== "string") return null;
  const match = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(value);
  if (!match) return null;
  return {
    hour: Number(value.slice(0, 2)),
    minute: Number(value.slice(3, 5)),
  };
}

function isReminderLead(value: number): value is ReminderLeadMinutes {
  return (REMINDER_LEAD_MINUTES as readonly number[]).includes(value);
}

function isValidSchedule(schedule: SavedCommuteSchedule): boolean {
  return (
    typeof schedule.id === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u.test(schedule.id) &&
    typeof schedule.active === "boolean" &&
    Array.isArray(schedule.weekdays) &&
    schedule.weekdays.length > 0 &&
    schedule.weekdays.every(
      (weekday) =>
        Number.isSafeInteger(weekday) && weekday >= 1 && weekday <= 7,
    ) &&
    parseDepartureTime(schedule.departureTime) !== null &&
    isReminderLead(schedule.reminderLeadMinutes)
  );
}

function dueForDate(
  schedule: SavedCommuteSchedule,
  serviceDate: CalendarDate,
  now: Date,
  preparedTokens: ReadonlySet<string>,
): DueSchedule | null {
  if (!schedule.active || !isValidSchedule(schedule)) return null;
  if (!schedule.weekdays.includes(isoWeekday(serviceDate))) return null;

  const departureTime = parseDepartureTime(schedule.departureTime);
  if (!departureTime) return null;

  const serviceDateText = calendarDateString(serviceDate);
  const idempotencyKey = `commute/${schedule.id}/${serviceDateText}`;
  if (preparedTokens.has(idempotencyKey)) return null;

  const departureAt = pacificWallClockToDate({
    ...serviceDate,
    ...departureTime,
  });
  if (!departureAt) return null;

  const dueAt = new Date(
    departureAt.getTime() - schedule.reminderLeadMinutes * MINUTE_MS,
  );
  const nowMs = now.getTime();
  if (nowMs < dueAt.getTime() || nowMs >= departureAt.getTime()) return null;

  return {
    scheduleId: schedule.id,
    serviceDate: serviceDateText,
    dueAt: new Date(dueAt),
    departureAt: new Date(departureAt),
    leadMinutes: schedule.reminderLeadMinutes,
    idempotencyKey,
  };
}

/**
 * Find active saved commutes whose reminder window is open right now.
 *
 * The next Pacific calendar date is also considered because a one-hour lead
 * can begin on the preceding date for a departure just after midnight.
 */
export function findDueSchedules({
  schedules,
  now,
  preparedTokens = new Set<string>(),
}: FindDueSchedulesInput): DueSchedule[] {
  if (!Number.isFinite(now.getTime())) return [];

  const today = pacificParts(now);
  const serviceDates = [today, addCalendarDays(today, 1)];
  const due: DueSchedule[] = [];
  const seenTokens = new Set<string>();

  for (const schedule of schedules) {
    for (const serviceDate of serviceDates) {
      const candidate = dueForDate(schedule, serviceDate, now, preparedTokens);
      if (!candidate || seenTokens.has(candidate.idempotencyKey)) continue;
      seenTokens.add(candidate.idempotencyKey);
      due.push(candidate);
    }
  }

  return due.sort(
    (left, right) =>
      left.dueAt.getTime() - right.dueAt.getTime() ||
      (left.scheduleId < right.scheduleId
        ? -1
        : left.scheduleId > right.scheduleId
          ? 1
          : 0),
  );
}
