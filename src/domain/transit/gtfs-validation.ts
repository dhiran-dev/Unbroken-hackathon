import { createHash } from "node:crypto";

export type GtfsCoverageCounts = {
  stops: number;
  routes: number;
  trips: number;
  stopTimes: number;
  services: number;
  shapePoints: number;
};

export type GtfsValidationPolicy = {
  minimumCounts: GtfsCoverageCounts;
  minimumRetentionRatio: number;
  coordinateBounds: {
    minimumLatitude: number;
    maximumLatitude: number;
    minimumLongitude: number;
    maximumLongitude: number;
  };
  maximumServiceHour: number;
};

type ServiceWeek = [
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
  boolean,
];

export type GtfsValidatedSnapshot = {
  stops: Array<{
    stopId: string;
    stopCode: string | null;
    name: string;
    description: string | null;
    latitude: number;
    longitude: number;
    locationType: number;
    parentStationId: string | null;
    wheelchairBoarding: number;
    platformCode: string | null;
    zoneId: string | null;
  }>;
  shapes: Array<{
    shapeId: string;
    latitude: number;
    longitude: number;
    sequence: number;
    distanceTraveled: number | null;
  }>;
  routes: Array<{
    routeId: string;
    agencyId: string | null;
    shortName: string | null;
    longName: string | null;
    description: string | null;
    routeType: number;
    url: string | null;
    color: string | null;
    textColor: string | null;
    sortOrder: number | null;
  }>;
  services: Array<{
    serviceId: string;
    weekdays: ServiceWeek;
    startDate: string | null;
    endDate: string | null;
    exceptions: Array<{ date: string; type: "added" | "removed" }>;
  }>;
  trips: Array<{
    tripId: string;
    routeId: string;
    serviceId: string;
    shapeId: string | null;
    headsign: string | null;
    shortName: string | null;
    directionId: 0 | 1 | null;
    blockId: string | null;
    wheelchairAccessible: number;
    bikesAllowed: number;
  }>;
  stopTimes: Array<{
    tripId: string;
    stopId: string;
    arrivalSeconds: number | null;
    departureSeconds: number | null;
    stopSequence: number;
    stopHeadsign: string | null;
    pickupType: number;
    dropOffType: number;
    shapeDistanceTraveled: number | null;
    timepoint: number | null;
  }>;
};

export type GtfsCoverageSummary = {
  serviceDate: string;
  activeServiceCount: number;
  counts: GtfsCoverageCounts;
  fingerprint: string;
};

export type GtfsRequiredFile =
  | "agency.txt"
  | "stops.txt"
  | "routes.txt"
  | "trips.txt"
  | "stop_times.txt"
  | "calendar.txt"
  | "calendar_dates.txt"
  | "shapes.txt";

export type GtfsRejectionReason = {
  code:
    | "MISSING_REQUIRED_FILE"
    | "INVALID_CSV"
    | "MISSING_REQUIRED_COLUMN"
    | "INVALID_AGENCY"
    | "INVALID_VALUE"
    | "DUPLICATE_IDENTIFIER"
    | "INVALID_REFERENCE"
    | "INVALID_SERVICE_DATE"
    | "NO_ACTIVE_SERVICE"
    | "INVALID_COORDINATE"
    | "INVALID_TIME"
    | "BELOW_MINIMUM_COUNT"
    | "COVERAGE_CONTRACTION";
  file?: GtfsRequiredFile;
  row?: number;
  field?: string;
  identifier?: string;
  count?: keyof GtfsCoverageCounts;
  actual?: number;
  expected?: number;
};

export type GtfsValidationResult =
  | {
      accepted: true;
      summary: GtfsCoverageSummary;
      snapshot: GtfsValidatedSnapshot;
    }
  | { accepted: false; reasons: GtfsRejectionReason[] };

export type ValidateGtfsFileSetInput = {
  files: Readonly<Record<string, string | undefined>>;
  serviceDate: string;
  policy: GtfsValidationPolicy;
  previousCoverage?: GtfsCoverageSummary | null;
};

const REQUIRED_COLUMNS = {
  "agency.txt": ["agency_name", "agency_url", "agency_timezone"],
  "stops.txt": ["stop_id", "stop_name", "stop_lat", "stop_lon"],
  "routes.txt": [
    "route_id",
    "route_short_name",
    "route_long_name",
    "route_type",
  ],
  "trips.txt": ["route_id", "service_id", "trip_id"],
  "stop_times.txt": [
    "trip_id",
    "arrival_time",
    "departure_time",
    "stop_id",
    "stop_sequence",
  ],
  "calendar.txt": [
    "service_id",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday",
    "start_date",
    "end_date",
  ],
  "calendar_dates.txt": ["service_id", "date", "exception_type"],
  "shapes.txt": [
    "shape_id",
    "shape_pt_lat",
    "shape_pt_lon",
    "shape_pt_sequence",
  ],
} as const satisfies Record<GtfsRequiredFile, readonly string[]>;

const REQUIRED_FILES = Object.keys(REQUIRED_COLUMNS) as GtfsRequiredFile[];
type CsvRow = Record<string, string>;
type ParsedCsv = { headers: string[]; rows: CsvRow[] };

function parseCsv(text: string): ParsedCsv | null {
  const input = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let closedQuote = false;

  const finishRecord = () => {
    record.push(field);
    records.push(record);
    record = [];
    field = "";
    closedQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (inQuotes) {
      if (character !== '"') field += character;
      else if (input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        inQuotes = false;
        closedQuote = true;
      }
      continue;
    }

    if (character === '"') {
      if (field !== "" || closedQuote) return null;
      inQuotes = true;
    } else if (character === ",") {
      record.push(field);
      field = "";
      closedQuote = false;
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && input[index + 1] === "\n") index += 1;
      finishRecord();
    } else {
      if (closedQuote) return null;
      field += character;
    }
  }

  if (inQuotes) return null;
  if (field !== "" || record.length > 0) finishRecord();
  while (records.at(-1)?.every((value) => value === "")) records.pop();
  const [rawHeaders, ...values] = records;
  if (!rawHeaders || rawHeaders.length === 0) return null;
  const headers = rawHeaders.map((header) => header.trim());
  if (
    headers.some((header) => header === "") ||
    new Set(headers).size !== headers.length ||
    values.some((row) => row.length !== headers.length)
  )
    return null;

  return {
    headers,
    rows: values.map((row) =>
      Object.fromEntries(
        headers.map((header, index) => [header, row[index] ?? ""]),
      ),
    ),
  };
}

function parseInteger(value: string | undefined, fallback?: number) {
  if ((value === undefined || value === "") && fallback !== undefined)
    return fallback;
  if (!value || !/^-?\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseNumber(value: string | undefined) {
  if (!value || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseGtfsDate(value: string | undefined) {
  if (!value || !/^\d{8}$/.test(value)) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function compactDate(value: string) {
  return value.replaceAll("-", "");
}

function parseServiceTime(
  value: string | undefined,
  maximumHour: number,
): number | null | "invalid" {
  if (!value) return null;
  const match = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(value);
  if (!match) return "invalid";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  if (hour > maximumHour || minute > 59 || second > 59) return "invalid";
  return hour * 3600 + minute * 60 + second;
}

function nullable(value: string | undefined) {
  return value ? value : null;
}

function invalidOptionalInteger(
  value: string | undefined,
  allowed: (parsed: number) => boolean,
) {
  if (!value) return false;
  const parsed = parseInteger(value);
  return parsed === null || !allowed(parsed);
}

function invalidOptionalNumber(
  value: string | undefined,
  allowed: (parsed: number) => boolean,
) {
  if (!value) return false;
  const parsed = parseNumber(value);
  return parsed === null || !allowed(parsed);
}

function addRequiredValueReasons(
  reasons: GtfsRejectionReason[],
  file: GtfsRequiredFile,
  rows: CsvRow[],
  fields: readonly string[],
) {
  rows.forEach((row, index) => {
    for (const field of fields) {
      if (!row[field]?.trim()) {
        reasons.push({
          code: "INVALID_VALUE",
          file,
          row: index + 2,
          field,
        });
      }
    }
  });
}

function addDuplicateReasons(
  reasons: GtfsRejectionReason[],
  file: GtfsRequiredFile,
  rows: CsvRow[],
  key: (row: CsvRow) => string,
) {
  const seen = new Set<string>();
  rows.forEach((row, index) => {
    const identifier = key(row);
    if (!identifier) return;
    if (seen.has(identifier)) {
      reasons.push({
        code: "DUPLICATE_IDENTIFIER",
        file,
        row: index + 2,
        identifier,
      });
    }
    seen.add(identifier);
  });
}

function activeServiceIds(
  calendar: CsvRow[],
  calendarDates: CsvRow[],
  serviceDate: string,
) {
  const date = new Date(`${serviceDate}T12:00:00.000Z`);
  const fields = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ] as const;
  const field = fields[date.getUTCDay()]!;
  const compact = compactDate(serviceDate);
  const active = new Set(
    calendar
      .filter(
        (row) =>
          row[field] === "1" &&
          (row.start_date ?? "") <= compact &&
          (row.end_date ?? "") >= compact,
      )
      .map((row) => row.service_id ?? ""),
  );
  for (const row of calendarDates) {
    if (row.date !== compact) continue;
    if (row.exception_type === "1") active.add(row.service_id ?? "");
    if (row.exception_type === "2") active.delete(row.service_id ?? "");
  }
  active.delete("");
  return active;
}

function canonicalFeedFingerprint(
  parsed: ReadonlyMap<GtfsRequiredFile, ParsedCsv>,
) {
  const canonical = [...parsed.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([file, csv]) => {
      const headers = [...csv.headers].sort();
      const rows = csv.rows
        .map((row) => headers.map((header) => row[header] ?? ""))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
      return JSON.stringify([file, headers, rows]);
    })
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateGtfsFileSet(
  input: ValidateGtfsFileSetInput,
): GtfsValidationResult {
  const reasons: GtfsRejectionReason[] = [];
  const parsed = new Map<GtfsRequiredFile, ParsedCsv>();

  for (const file of REQUIRED_FILES) {
    const text = input.files[file];
    if (text === undefined) {
      reasons.push({ code: "MISSING_REQUIRED_FILE", file });
      continue;
    }
    const csv = parseCsv(text);
    if (!csv) {
      reasons.push({ code: "INVALID_CSV", file });
      continue;
    }
    parsed.set(file, csv);
    for (const field of REQUIRED_COLUMNS[file]) {
      if (!csv.headers.includes(field))
        reasons.push({ code: "MISSING_REQUIRED_COLUMN", file, field });
    }
  }
  if (reasons.length > 0) return { accepted: false, reasons };

  const agency = parsed.get("agency.txt")!.rows;
  const stops = parsed.get("stops.txt")!.rows;
  const routes = parsed.get("routes.txt")!.rows;
  const trips = parsed.get("trips.txt")!.rows;
  const stopTimes = parsed.get("stop_times.txt")!.rows;
  const calendar = parsed.get("calendar.txt")!.rows;
  const calendarDates = parsed.get("calendar_dates.txt")!.rows;
  const shapes = parsed.get("shapes.txt")!.rows;

  addRequiredValueReasons(reasons, "agency.txt", agency, [
    "agency_name",
    "agency_url",
    "agency_timezone",
  ]);
  addRequiredValueReasons(reasons, "stops.txt", stops, [
    "stop_id",
    "stop_name",
  ]);
  addRequiredValueReasons(reasons, "routes.txt", routes, [
    "route_id",
    "route_type",
  ]);
  addRequiredValueReasons(reasons, "trips.txt", trips, [
    "route_id",
    "service_id",
    "trip_id",
  ]);
  addRequiredValueReasons(reasons, "stop_times.txt", stopTimes, [
    "trip_id",
    "stop_id",
    "stop_sequence",
  ]);
  addRequiredValueReasons(reasons, "calendar.txt", calendar, [
    "service_id",
    "start_date",
    "end_date",
  ]);
  addRequiredValueReasons(reasons, "calendar_dates.txt", calendarDates, [
    "service_id",
    "date",
    "exception_type",
  ]);
  addRequiredValueReasons(reasons, "shapes.txt", shapes, [
    "shape_id",
    "shape_pt_lat",
    "shape_pt_lon",
    "shape_pt_sequence",
  ]);

  if (
    agency.length !== 1 ||
    agency[0]?.agency_timezone !== "America/Los_Angeles" ||
    (agency[0]?.agency_id && agency[0]?.agency_id !== "SF")
  )
    reasons.push({ code: "INVALID_AGENCY", file: "agency.txt" });

  addDuplicateReasons(reasons, "stops.txt", stops, (row) => row.stop_id ?? "");
  addDuplicateReasons(
    reasons,
    "routes.txt",
    routes,
    (row) => row.route_id ?? "",
  );
  addDuplicateReasons(reasons, "trips.txt", trips, (row) => row.trip_id ?? "");
  addDuplicateReasons(
    reasons,
    "calendar.txt",
    calendar,
    (row) => row.service_id ?? "",
  );
  addDuplicateReasons(
    reasons,
    "calendar_dates.txt",
    calendarDates,
    (row) => `${row.service_id ?? ""}\u0000${row.date ?? ""}`,
  );
  addDuplicateReasons(
    reasons,
    "stop_times.txt",
    stopTimes,
    (row) => `${row.trip_id ?? ""}\u0000${row.stop_sequence ?? ""}`,
  );
  addDuplicateReasons(
    reasons,
    "shapes.txt",
    shapes,
    (row) => `${row.shape_id ?? ""}\u0000${row.shape_pt_sequence ?? ""}`,
  );

  const stopIds = new Set(stops.map((row) => row.stop_id ?? ""));
  const routeIds = new Set(routes.map((row) => row.route_id ?? ""));
  const serviceIds = new Set(
    [...calendar, ...calendarDates].map((row) => row.service_id ?? ""),
  );
  const tripIds = new Set(trips.map((row) => row.trip_id ?? ""));
  const shapeIds = new Set(shapes.map((row) => row.shape_id ?? ""));

  stops.forEach((row, index) => {
    const latitude = parseNumber(row.stop_lat);
    const longitude = parseNumber(row.stop_lon);
    if (
      latitude === null ||
      longitude === null ||
      latitude < input.policy.coordinateBounds.minimumLatitude ||
      latitude > input.policy.coordinateBounds.maximumLatitude ||
      longitude < input.policy.coordinateBounds.minimumLongitude ||
      longitude > input.policy.coordinateBounds.maximumLongitude
    )
      reasons.push({
        code: "INVALID_COORDINATE",
        file: "stops.txt",
        row: index + 2,
      });
    if (!row.stop_name) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "stops.txt",
        row: index + 2,
        field: "stop_name",
      });
    }
    for (const [field, maximum] of [
      ["location_type", 4],
      ["wheelchair_boarding", 2],
    ] as const) {
      if (
        invalidOptionalInteger(
          row[field],
          (value) => value >= 0 && value <= maximum,
        )
      ) {
        reasons.push({
          code: "INVALID_VALUE",
          file: "stops.txt",
          row: index + 2,
          field,
        });
      }
    }
    if (row.parent_station && !stopIds.has(row.parent_station)) {
      reasons.push({
        code: "INVALID_REFERENCE",
        file: "stops.txt",
        row: index + 2,
        field: "parent_station",
        identifier: row.parent_station,
      });
    }
  });

  routes.forEach((row, index) => {
    if (!row.route_short_name && !row.route_long_name) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "routes.txt",
        row: index + 2,
        field: "route_short_name",
      });
    }
    if (
      parseInteger(row.route_type) === null ||
      parseInteger(row.route_type)! < 0
    ) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "routes.txt",
        row: index + 2,
        field: "route_type",
      });
    }
    if (invalidOptionalInteger(row.route_sort_order, (value) => value >= 0)) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "routes.txt",
        row: index + 2,
        field: "route_sort_order",
      });
    }
  });

  calendar.forEach((row, index) => {
    const dayFields = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    if (
      !parseGtfsDate(row.start_date) ||
      !parseGtfsDate(row.end_date) ||
      (row.start_date ?? "") > (row.end_date ?? "") ||
      dayFields.some((field) => row[field] !== "0" && row[field] !== "1")
    )
      reasons.push({
        code: "INVALID_VALUE",
        file: "calendar.txt",
        row: index + 2,
      });
  });
  calendarDates.forEach((row, index) => {
    if (
      !parseGtfsDate(row.date) ||
      (row.exception_type !== "1" && row.exception_type !== "2")
    ) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "calendar_dates.txt",
        row: index + 2,
      });
    }
  });

  trips.forEach((row, index) => {
    if (!routeIds.has(row.route_id ?? ""))
      reasons.push({
        code: "INVALID_REFERENCE",
        file: "trips.txt",
        row: index + 2,
        field: "route_id",
        identifier: row.route_id,
      });
    if (!serviceIds.has(row.service_id ?? ""))
      reasons.push({
        code: "INVALID_REFERENCE",
        file: "trips.txt",
        row: index + 2,
        field: "service_id",
        identifier: row.service_id,
      });
    if (row.shape_id && !shapeIds.has(row.shape_id))
      reasons.push({
        code: "INVALID_REFERENCE",
        file: "trips.txt",
        row: index + 2,
        field: "shape_id",
        identifier: row.shape_id,
      });
    for (const field of ["wheelchair_accessible", "bikes_allowed"] as const) {
      if (
        invalidOptionalInteger(row[field], (value) => value >= 0 && value <= 2)
      ) {
        reasons.push({
          code: "INVALID_VALUE",
          file: "trips.txt",
          row: index + 2,
          field,
        });
      }
    }
    if (
      row.direction_id &&
      row.direction_id !== "0" &&
      row.direction_id !== "1"
    ) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "trips.txt",
        row: index + 2,
        field: "direction_id",
      });
    }
  });

  stopTimes.forEach((row, index) => {
    if (!tripIds.has(row.trip_id ?? ""))
      reasons.push({
        code: "INVALID_REFERENCE",
        file: "stop_times.txt",
        row: index + 2,
        field: "trip_id",
        identifier: row.trip_id,
      });
    if (!stopIds.has(row.stop_id ?? ""))
      reasons.push({
        code: "INVALID_REFERENCE",
        file: "stop_times.txt",
        row: index + 2,
        field: "stop_id",
        identifier: row.stop_id,
      });
    if (
      parseInteger(row.stop_sequence) === null ||
      parseInteger(row.stop_sequence)! < 0
    )
      reasons.push({
        code: "INVALID_VALUE",
        file: "stop_times.txt",
        row: index + 2,
        field: "stop_sequence",
      });
    const arrival = parseServiceTime(
      row.arrival_time,
      input.policy.maximumServiceHour,
    );
    const departure = parseServiceTime(
      row.departure_time,
      input.policy.maximumServiceHour,
    );
    if (
      (arrival === null && departure === null) ||
      arrival === "invalid" ||
      departure === "invalid"
    )
      reasons.push({
        code: "INVALID_TIME",
        file: "stop_times.txt",
        row: index + 2,
      });
    for (const [field, maximum] of [
      ["pickup_type", 3],
      ["drop_off_type", 3],
      ["timepoint", 1],
    ] as const) {
      if (
        invalidOptionalInteger(
          row[field],
          (value) => value >= 0 && value <= maximum,
        )
      ) {
        reasons.push({
          code: "INVALID_VALUE",
          file: "stop_times.txt",
          row: index + 2,
          field,
        });
      }
    }
    if (invalidOptionalNumber(row.shape_dist_traveled, (value) => value >= 0)) {
      reasons.push({
        code: "INVALID_VALUE",
        file: "stop_times.txt",
        row: index + 2,
        field: "shape_dist_traveled",
      });
    }
  });

  shapes.forEach((row, index) => {
    const latitude = parseNumber(row.shape_pt_lat);
    const longitude = parseNumber(row.shape_pt_lon);
    const sequence = parseInteger(row.shape_pt_sequence);
    if (
      !row.shape_id ||
      sequence === null ||
      sequence < 0 ||
      invalidOptionalNumber(row.shape_dist_traveled, (value) => value >= 0) ||
      latitude === null ||
      longitude === null ||
      latitude < input.policy.coordinateBounds.minimumLatitude ||
      latitude > input.policy.coordinateBounds.maximumLatitude ||
      longitude < input.policy.coordinateBounds.minimumLongitude ||
      longitude > input.policy.coordinateBounds.maximumLongitude
    )
      reasons.push({
        code: "INVALID_COORDINATE",
        file: "shapes.txt",
        row: index + 2,
      });
  });

  const compact = /^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)
    ? compactDate(input.serviceDate)
    : "";
  if (!parseGtfsDate(compact)) reasons.push({ code: "INVALID_SERVICE_DATE" });
  const activeServices = compact
    ? activeServiceIds(calendar, calendarDates, input.serviceDate)
    : new Set<string>();
  if (activeServices.size === 0) reasons.push({ code: "NO_ACTIVE_SERVICE" });

  serviceIds.delete("");
  const counts: GtfsCoverageCounts = {
    stops: stops.length,
    routes: routes.length,
    trips: trips.length,
    stopTimes: stopTimes.length,
    services: serviceIds.size,
    shapePoints: shapes.length,
  };
  for (const count of Object.keys(counts) as Array<keyof GtfsCoverageCounts>) {
    const actual = counts[count];
    const minimum = input.policy.minimumCounts[count];
    if (actual < minimum)
      reasons.push({
        code: "BELOW_MINIMUM_COUNT",
        count,
        actual,
        expected: minimum,
      });
    const previous = input.previousCoverage?.counts[count];
    if (
      previous !== undefined &&
      actual < previous * input.policy.minimumRetentionRatio
    ) {
      reasons.push({
        code: "COVERAGE_CONTRACTION",
        count,
        actual,
        expected: Math.ceil(previous * input.policy.minimumRetentionRatio),
      });
    }
  }
  if (reasons.length > 0) return { accepted: false, reasons };

  const exceptions = new Map<
    string,
    Array<{ date: string; type: "added" | "removed" }>
  >();
  for (const row of calendarDates) {
    const existing = exceptions.get(row.service_id!) ?? [];
    existing.push({
      date: parseGtfsDate(row.date)!,
      type: row.exception_type === "1" ? "added" : "removed",
    });
    exceptions.set(row.service_id!, existing);
  }
  const calendarByService = new Map(
    calendar.map((row) => [row.service_id!, row]),
  );

  return {
    accepted: true,
    summary: {
      serviceDate: input.serviceDate,
      activeServiceCount: activeServices.size,
      counts,
      fingerprint: canonicalFeedFingerprint(parsed),
    },
    snapshot: {
      stops: stops.map((row) => ({
        stopId: row.stop_id!,
        stopCode: nullable(row.stop_code),
        name: row.stop_name!,
        description: nullable(row.stop_desc),
        latitude: Number(row.stop_lat),
        longitude: Number(row.stop_lon),
        locationType: parseInteger(row.location_type, 0)!,
        parentStationId: nullable(row.parent_station),
        wheelchairBoarding: parseInteger(row.wheelchair_boarding, 0)!,
        platformCode: nullable(row.platform_code),
        zoneId: nullable(row.zone_id),
      })),
      shapes: shapes.map((row) => ({
        shapeId: row.shape_id!,
        latitude: Number(row.shape_pt_lat),
        longitude: Number(row.shape_pt_lon),
        sequence: Number(row.shape_pt_sequence),
        distanceTraveled: parseNumber(row.shape_dist_traveled),
      })),
      routes: routes.map((row) => ({
        routeId: row.route_id!,
        agencyId: nullable(row.agency_id),
        shortName: nullable(row.route_short_name),
        longName: nullable(row.route_long_name),
        description: nullable(row.route_desc),
        routeType: Number(row.route_type),
        url: nullable(row.route_url),
        color: nullable(row.route_color),
        textColor: nullable(row.route_text_color),
        sortOrder: parseInteger(row.route_sort_order),
      })),
      services: [...serviceIds].sort().map((serviceId) => {
        const row = calendarByService.get(serviceId);
        const weekdays: ServiceWeek = row
          ? [
              row.monday === "1",
              row.tuesday === "1",
              row.wednesday === "1",
              row.thursday === "1",
              row.friday === "1",
              row.saturday === "1",
              row.sunday === "1",
            ]
          : [false, false, false, false, false, false, false];
        return {
          serviceId,
          weekdays,
          startDate: row ? parseGtfsDate(row.start_date) : null,
          endDate: row ? parseGtfsDate(row.end_date) : null,
          exceptions: exceptions.get(serviceId) ?? [],
        };
      }),
      trips: trips.map((row) => ({
        tripId: row.trip_id!,
        routeId: row.route_id!,
        serviceId: row.service_id!,
        shapeId: nullable(row.shape_id),
        headsign: nullable(row.trip_headsign),
        shortName: nullable(row.trip_short_name),
        directionId:
          row.direction_id === "0" ? 0 : row.direction_id === "1" ? 1 : null,
        blockId: nullable(row.block_id),
        wheelchairAccessible: parseInteger(row.wheelchair_accessible, 0)!,
        bikesAllowed: parseInteger(row.bikes_allowed, 0)!,
      })),
      stopTimes: stopTimes.map((row) => ({
        tripId: row.trip_id!,
        stopId: row.stop_id!,
        arrivalSeconds: parseServiceTime(
          row.arrival_time,
          input.policy.maximumServiceHour,
        ) as number | null,
        departureSeconds: parseServiceTime(
          row.departure_time,
          input.policy.maximumServiceHour,
        ) as number | null,
        stopSequence: Number(row.stop_sequence),
        stopHeadsign: nullable(row.stop_headsign),
        pickupType: parseInteger(row.pickup_type, 0)!,
        dropOffType: parseInteger(row.drop_off_type, 0)!,
        shapeDistanceTraveled: parseNumber(row.shape_dist_traveled),
        timepoint: parseInteger(row.timepoint),
      })),
    },
  };
}
