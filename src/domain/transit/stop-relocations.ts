import { createHash } from "node:crypto";

export const STOP_RELOCATION_COLLECTOR_ID = "c_mt01m8hghrt0swozl";
export const STOP_RELOCATION_SOURCE_URL =
  "https://www.sfmta.com/travel-updates/temporary-stop-relocations";

const TOP_LEVEL_KEYS = ["metadata", "stopRelocationData"] as const;
const ROW_KEYS = [
  "Applicant",
  "Dates",
  "Hours",
  "Routes",
  "Status",
  "StopID",
  "StopName",
  "TemporaryStop",
  "Workdays",
] as const;
const REQUIRED_ROW_KEYS = ROW_KEYS.filter((key) => key !== "Applicant");
const ROW_KEY_SET = new Set<string>(ROW_KEYS);
const MAX_ROWS = 100;
const MAX_TEXT = 500;
const MAX_DATE_TEXT = 200;
const MAX_ROUTES = 100;
const MAX_ROUTE_LENGTH = 80;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export type StopRelocation = {
  rowId: string;
  stopId: string;
  stopName: string;
  applicant: string | null;
  routeNames: string[];
  temporaryStop: string;
  scheduleText: string;
  startsAt: Date;
  endsAt: Date;
  latitude: number | null;
  longitude: number | null;
  publicUrl: typeof STOP_RELOCATION_SOURCE_URL;
  boardingInstruction: string;
};

export type StopRelocationReason = {
  code:
    | "COLLECTOR_ID_MISMATCH"
    | "SOURCE_URL_MISMATCH"
    | "COLLECTION_INCOMPLETE"
    | "ENVELOPE_SHAPE_CHANGED"
    | "ROW_COUNT_TOO_LOW"
    | "ROW_COUNT_TOO_HIGH"
    | "ROW_SHAPE_CHANGED"
    | "INVALID_TEXT"
    | "INVALID_ROUTES"
    | "INVALID_DATE"
    | "INVALID_STATUS"
    | "INVALID_STOP_ID"
    | "INVALID_SOURCE_TIME"
    | "INVALID_COORDINATES"
    | "DUPLICATE_ROW";
  row?: number;
  field?: string;
  message: string;
};

export type StopRelocationValidationResult =
  | {
      accepted: true;
      relocations: StopRelocation[];
      sourceUpdatedAt: Date;
      payloadHash: string;
      structuralFingerprint: string;
      report: {
        accepted: true;
        rowCount: number;
        structuralFingerprint: string;
      };
    }
  | {
      accepted: false;
      reasons: StopRelocationReason[];
      report: {
        accepted: false;
        rowCount: number;
        reasons: StopRelocationReason[];
      };
    };

type RawRow = {
  Applicant?: string | null;
  Dates: string;
  Hours: string;
  Routes: string;
  Status: string;
  StopID: string;
  StopName: string;
  TemporaryStop: string;
  Workdays: string;
};

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function exactRowShape(value: Record<string, unknown>): value is RawRow {
  const keys = Object.keys(value);
  if (
    keys.some((key) => !ROW_KEY_SET.has(key)) ||
    REQUIRED_ROW_KEYS.some((key) => !keys.includes(key)) ||
    !(
      keys.length === REQUIRED_ROW_KEYS.length ||
      keys.length === ROW_KEYS.length
    )
  ) {
    return false;
  }
  return (
    (value.Applicant === undefined ||
      value.Applicant === null ||
      typeof value.Applicant === "string") &&
    typeof value.Dates === "string" &&
    typeof value.Hours === "string" &&
    typeof value.Routes === "string" &&
    typeof value.Status === "string" &&
    typeof value.StopID === "string" &&
    typeof value.StopName === "string" &&
    typeof value.TemporaryStop === "string" &&
    typeof value.Workdays === "string"
  );
}

function safeText(value: string, maximum = MAX_TEXT) {
  const text = value
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  return text.length > 0 && text.length <= maximum ? text : null;
}

function parseCalendarDate(value: string, defaultYear: number) {
  const monthNames: Record<string, number> = {
    jan: 1,
    feb: 2,
    mar: 3,
    apr: 4,
    jun: 6,
    jul: 7,
    aug: 8,
    sep: 9,
    sept: 9,
    oct: 10,
    nov: 11,
    dec: 12,
    january: 1,
    february: 2,
    march: 3,
    april: 4,
    may: 5,
    june: 6,
    july: 7,
    august: 8,
    september: 9,
    october: 10,
    november: 11,
    december: 12,
  };
  let year: number;
  let month: number;
  let day: number;
  let yearExplicit: boolean;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  const named = /^([A-Za-z]+)\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(value);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
    yearExplicit = true;
  } else if (us) {
    month = Number(us[1]);
    day = Number(us[2]);
    year = Number(us[3]);
    yearExplicit = true;
  } else if (named && monthNames[named[1]!.toLowerCase()]) {
    month = monthNames[named[1]!.toLowerCase()]!;
    day = Number(named[2]);
    year = named[3] ? Number(named[3]) : defaultYear;
    yearExplicit = Boolean(named[3]);
  } else {
    return null;
  }
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, yearExplicit };
}

function pacificYear(value: Date) {
  if (Number.isNaN(value.valueOf())) return Number.NaN;
  return Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      year: "numeric",
    }).format(value),
  );
}

function pacificStart(value: { year: number; month: number; day: number }) {
  const noonUtc = Date.UTC(value.year, value.month - 1, value.day, 12);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    timeZoneName: "longOffset",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(noonUtc));
  const offset = parts.find((part) => part.type === "timeZoneName")?.value;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset ?? "");
  if (!match) throw new Error("Pacific time offset is unavailable.");
  const minutes =
    (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
  return new Date(
    Date.UTC(value.year, value.month - 1, value.day) - minutes * 60_000,
  );
}

function parseDateRange(value: string, sourceUpdatedAt: Date) {
  if (value.length === 0 || value.length > MAX_DATE_TEXT) return null;
  const parts = value.split(/\s+(?:-|–|—|to|through)\s+/i);
  if (parts.length < 1 || parts.length > 2) return null;
  const sourceYear = pacificYear(sourceUpdatedAt);
  const startDate = parseCalendarDate(parts[0]!.trim(), sourceYear);
  let endDate = parseCalendarDate((parts[1] ?? parts[0])!.trim(), sourceYear);
  if (!startDate || !endDate) return null;
  if (startDate.yearExplicit !== endDate.yearExplicit) return null;
  if (parts.length === 2 && endDate.month < startDate.month) {
    if (
      startDate.yearExplicit ||
      endDate.yearExplicit ||
      startDate.month !== 12 ||
      endDate.month !== 1
    ) {
      if (startDate.year > endDate.year) return null;
    } else {
      endDate = { ...endDate, year: endDate.year + 1 };
    }
  }
  const startsAt = pacificStart(startDate);
  const endStart = pacificStart(endDate);
  if (startsAt > endStart) return null;
  const nextDay = new Date(
    Date.UTC(endDate.year, endDate.month - 1, endDate.day + 1),
  );
  const endsAt = new Date(
    pacificStart({
      year: nextDay.getUTCFullYear(),
      month: nextDay.getUTCMonth() + 1,
      day: nextDay.getUTCDate(),
    }).valueOf() - 1,
  );
  return { startsAt, endsAt };
}

function routeNames(value: string) {
  const match = /^(Inbound|Outbound)\s*:\s*(.+)$/i.exec(value.trim());
  if (!match) return null;
  const direction =
    match[1]!.toLowerCase() === "inbound" ? "Inbound" : "Outbound";
  const routes = match[2]!
    .split(/[,;]/)
    .map((route) => safeText(direction + " " + route, MAX_ROUTE_LENGTH))
    .filter((route): route is string => route !== null);
  if (routes.length === 0 || routes.length > MAX_ROUTES) return null;
  return [...new Set(routes)].sort((left, right) => left.localeCompare(right));
}

function relocationScheduleText(input: {
  dates: string;
  hours: string;
  status: string;
  workdays: string;
}) {
  const statusText =
    input.status === "Currently Closed"
      ? "SFMTA says this stop is currently closed."
      : input.status === "Closing Today"
        ? "SFMTA says this stop is closing today."
        : "SFMTA says this stop is closing soon.";
  const dates = input.dates.replace(/\s+(?:-|–|—|to|through)\s+/i, " through ");
  const days = input.workdays
    .split(";")
    .map((day) => day.trim())
    .filter(Boolean);
  const dayText = new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  }).format(days);
  const hours = input.hours.replace(/\s+(?:-|–|—|to|through)\s+/i, " to ");
  return (
    statusText +
    " This move applies " +
    dates +
    ", on " +
    dayText +
    ", from " +
    hours +
    "."
  );
}

function coordinateFor(
  coordinates:
    | Readonly<
        Record<number, { latitude: number | null; longitude: number | null }>
      >
    | undefined,
  index: number,
) {
  const coordinate = coordinates?.[index];
  if (!coordinate)
    return { valid: true as const, latitude: null, longitude: null };
  if (coordinate.latitude === null && coordinate.longitude === null) {
    return { valid: true as const, latitude: null, longitude: null };
  }
  if (
    typeof coordinate.latitude !== "number" ||
    typeof coordinate.longitude !== "number" ||
    !Number.isFinite(coordinate.latitude) ||
    !Number.isFinite(coordinate.longitude) ||
    coordinate.latitude < 37.6 ||
    coordinate.latitude > 37.9 ||
    coordinate.longitude < -122.55 ||
    coordinate.longitude > -122.3
  ) {
    return { valid: false as const, latitude: null, longitude: null };
  }
  return {
    valid: true as const,
    latitude: coordinate.latitude,
    longitude: coordinate.longitude,
  };
}

export function validateStopRelocations(input: {
  collectorId: string;
  sourceUrl: string;
  datasetComplete: boolean;
  envelope: unknown;
  collectedAt: Date;
  previousRowCount: number | null;
  coordinates?: Readonly<
    Record<number, { latitude: number | null; longitude: number | null }>
  >;
}): StopRelocationValidationResult {
  const reasons: StopRelocationReason[] = [];
  const add = (reason: StopRelocationReason) => reasons.push(reason);
  if (input.collectorId !== STOP_RELOCATION_COLLECTOR_ID) {
    add({
      code: "COLLECTOR_ID_MISMATCH",
      message: "The stop relocation collector identity changed.",
    });
  }
  if (input.sourceUrl !== STOP_RELOCATION_SOURCE_URL) {
    add({
      code: "SOURCE_URL_MISMATCH",
      message: "The stop relocation source changed.",
    });
  }
  if (!input.datasetComplete) {
    add({
      code: "COLLECTION_INCOMPLETE",
      message: "The stop relocation collection did not finish.",
    });
  }
  if (!isRecord(input.envelope) || !exactKeys(input.envelope, TOP_LEVEL_KEYS)) {
    return {
      accepted: false,
      reasons: [
        ...reasons,
        {
          code: "ENVELOPE_SHAPE_CHANGED",
          message: "The stop relocation response shape changed.",
        },
      ],
      report: {
        accepted: false,
        rowCount: 0,
        reasons: [
          ...reasons,
          {
            code: "ENVELOPE_SHAPE_CHANGED",
            message: "The stop relocation response shape changed.",
          },
        ],
      },
    };
  }
  const metadata = input.envelope.metadata;
  const rows = input.envelope.stopRelocationData;
  if (
    !isRecord(metadata) ||
    !exactKeys(metadata, ["lastCompiled"]) ||
    typeof metadata.lastCompiled !== "string" ||
    !Array.isArray(rows)
  ) {
    const shapeReason = {
      code: "ENVELOPE_SHAPE_CHANGED" as const,
      message: "The stop relocation response shape changed.",
    };
    return {
      accepted: false,
      reasons: [...reasons, shapeReason],
      report: {
        accepted: false,
        rowCount: 0,
        reasons: [...reasons, shapeReason],
      },
    };
  }
  const sourceTimestampIsIso =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(
      metadata.lastCompiled,
    );
  const sourceUpdatedAt = new Date(metadata.lastCompiled);
  if (
    !sourceTimestampIsIso ||
    Number.isNaN(sourceUpdatedAt.valueOf()) ||
    sourceUpdatedAt.valueOf() >
      input.collectedAt.valueOf() + FUTURE_TOLERANCE_MS
  ) {
    add({
      code: "INVALID_SOURCE_TIME",
      field: "lastCompiled",
      message: "The SFMTA source time is invalid.",
    });
  }
  const minimumRows = Math.max(
    6,
    Math.ceil((input.previousRowCount ?? 6) * 0.8),
  );
  if (rows.length < minimumRows) {
    add({
      code: "ROW_COUNT_TOO_LOW",
      message: "The stop relocation list is smaller than the safe baseline.",
    });
  }
  if (rows.length > MAX_ROWS) {
    add({
      code: "ROW_COUNT_TOO_HIGH",
      message: "The stop relocation list exceeds the safe limit.",
    });
  }

  const relocations: StopRelocation[] = [];
  if (
    input.coordinates &&
    Object.keys(input.coordinates).some((key) => {
      const index = Number(key);
      return !Number.isSafeInteger(index) || index < 0 || index >= rows.length;
    })
  ) {
    add({
      code: "INVALID_COORDINATES",
      message: "Stop relocation coordinates do not match the source rows.",
    });
  }
  const ids = new Set<string>();
  for (const [index, candidate] of rows.slice(0, MAX_ROWS + 1).entries()) {
    if (!isRecord(candidate) || !exactRowShape(candidate)) {
      add({
        code: "ROW_SHAPE_CHANGED",
        row: index,
        message: "A stop relocation row shape changed.",
      });
      continue;
    }
    const applicant =
      candidate.Applicant == null || candidate.Applicant.trim() === ""
        ? null
        : safeText(candidate.Applicant, 200);
    const stopId = safeText(candidate.StopID, 40);
    const stopName = safeText(candidate.StopName, 200);
    const temporaryStop = safeText(candidate.TemporaryStop);
    const dateText = safeText(candidate.Dates, MAX_DATE_TEXT);
    const hours = safeText(candidate.Hours, 200);
    const status = safeText(candidate.Status, 100);
    const workdays = safeText(candidate.Workdays, 200);
    if (
      (candidate.Applicant != null &&
        candidate.Applicant.trim() !== "" &&
        !applicant) ||
      !stopId ||
      !stopName ||
      !temporaryStop ||
      !dateText ||
      !hours ||
      !status ||
      !workdays
    ) {
      add({
        code: "INVALID_TEXT",
        row: index,
        message: "A stop relocation text field is missing or too long.",
      });
    }
    const routes = routeNames(candidate.Routes);
    if (!routes)
      add({
        code: "INVALID_ROUTES",
        row: index,
        field: "Routes",
        message: "A stop relocation route list is invalid.",
      });
    if (stopId && !/^\d{5}$/.test(stopId))
      add({
        code: "INVALID_STOP_ID",
        row: index,
        field: "StopID",
        message: "A stop relocation stop ID is invalid.",
      });
    const statusValid =
      status === "Currently Closed" ||
      status === "Closing Today" ||
      status === "Closing Soon";
    if (status && !statusValid)
      add({
        code: "INVALID_STATUS",
        row: index,
        field: "Status",
        message: "A stop relocation status is invalid.",
      });
    const dates = parseDateRange(candidate.Dates.trim(), sourceUpdatedAt);
    if (!dates)
      add({
        code: "INVALID_DATE",
        row: index,
        field: "Dates",
        message: "A stop relocation date range is invalid.",
      });
    const coordinate = coordinateFor(input.coordinates, index);
    if (!coordinate.valid)
      add({
        code: "INVALID_COORDINATES",
        row: index,
        message: "A stop relocation coordinate is outside San Francisco.",
      });

    if (
      stopId &&
      /^\d{5}$/.test(stopId) &&
      stopName &&
      temporaryStop &&
      hours &&
      status &&
      statusValid &&
      workdays &&
      dateText &&
      routes &&
      dates &&
      coordinate.valid
    ) {
      const scheduleText = relocationScheduleText({
        dates: dateText,
        hours,
        status,
        workdays,
      });
      const semantic = {
        stopId,
        stopName,
        routeNames: routes,
        temporaryStop,
        scheduleText,
        hours,
        status,
        workdays,
        latitude: coordinate.latitude,
        longitude: coordinate.longitude,
      };
      const rowId = `relocation-${sha256(JSON.stringify(semantic)).slice(0, 32)}`;
      if (ids.has(rowId)) {
        add({
          code: "DUPLICATE_ROW",
          row: index,
          message: "The stop relocation list contains an exact duplicate row.",
        });
      } else {
        ids.add(rowId);
        relocations.push({
          rowId,
          stopId,
          stopName,
          applicant,
          routeNames: routes,
          temporaryStop,
          scheduleText,
          startsAt: dates.startsAt,
          endsAt: dates.endsAt,
          latitude: coordinate.latitude,
          longitude: coordinate.longitude,
          publicUrl: STOP_RELOCATION_SOURCE_URL,
          boardingInstruction: `Board at ${temporaryStop}. ${scheduleText}`,
        });
      }
    }
  }
  if (reasons.length > 0 || Number.isNaN(sourceUpdatedAt.valueOf())) {
    return {
      accepted: false,
      reasons,
      report: { accepted: false, rowCount: rows.length, reasons },
    };
  }
  relocations.sort((left, right) => left.rowId.localeCompare(right.rowId));
  const structuralFingerprint = sha256(
    JSON.stringify({
      top: TOP_LEVEL_KEYS,
      metadata: ["lastCompiled"],
      rows: ROW_KEYS,
    }),
  );
  const payloadHash = sha256(
    JSON.stringify(
      relocations.map((row) => ({
        ...row,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      })),
    ),
  );
  return {
    accepted: true,
    relocations,
    sourceUpdatedAt,
    payloadHash,
    structuralFingerprint,
    report: {
      accepted: true,
      rowCount: relocations.length,
      structuralFingerprint,
    },
  };
}

export function stopRelocationEvidenceHash(input: {
  status: "rejected" | "unavailable";
  checkedAt: Date;
  report: Record<string, unknown>;
}) {
  return sha256(
    JSON.stringify({
      status: input.status,
      checkedAt: input.checkedAt.toISOString(),
      report: input.report,
    }),
  );
}
