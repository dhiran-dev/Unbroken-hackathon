import { SFMTA_STATION_NAMES } from "./catalog";
import {
  COLLECTION_CONTRACT_VERSION,
  collectorDatasetSchema,
  flattenCollectorDataset,
  type RawElevatorRow,
} from "./contract";
import {
  equipmentIdentity,
  equipmentSourceKey,
  normalizeWhitespace,
  sha256Json,
} from "./identity";
import { parseSfmtaTimestamp } from "./time";

const MIN_ELEVATOR_ROWS = 25;
const MAX_ELEVATOR_ROWS = 45;
const HEALTHY_FRESHNESS_MS = 10 * 60 * 1_000;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export type CollectionClassification =
  | "healthy_no_change"
  | "semantic_service_change"
  | "probable_layout_drift"
  | "source_unavailable"
  | "source_stale"
  | "ambiguous_contract_failure";

export type NormalizedElevatorRow = {
  stationName: string;
  stationAccessibility: "accessible" | "unavailable" | "unknown";
  equipmentName: string;
  equipmentSourceKey: string;
  equipmentStatus: "in_service" | "out_of_service" | "unknown";
  sourceValidAt: Date;
  sourceLastChangedAt: Date | null;
  raw: RawElevatorRow;
};

export type ContractCheck = {
  id: string;
  passed: boolean;
  details: string;
};

export type ContractReport = {
  contractVersion: string;
  valid: boolean;
  checks: ContractCheck[];
  rowCount: number;
  stationCount: number;
  statusCounts: Record<string, number>;
  missingStations: string[];
  unexpectedStations: string[];
  duplicateIdentities: string[];
  missingCriticalFields: string[];
  sourceValidAt: string | null;
  freshnessSeconds: number | null;
  structuralFingerprint: string | null;
  previousStructuralFingerprint: string | null;
  reasonCodes: string[];
  schemaIssues: Array<{ path: string; message: string }>;
};

export type ValidationResult = {
  accepted: boolean;
  classification: CollectionClassification;
  rows: NormalizedElevatorRow[];
  report: ContractReport;
};

function mapStationAccessibility(value: RawElevatorRow["station_accessibility"]) {
  if (value === "accessible") return "accessible" as const;
  if (value === "not_accessible") return "unavailable" as const;
  return "unknown" as const;
}

function addReason(reasons: string[], reason: string) {
  if (!reasons.includes(reason)) reasons.push(reason);
}

export function validateCollectorDataset(input: {
  payload: unknown;
  collectedAt: Date;
  expectedSourceUrl: string;
  previousStructuralFingerprint: string | null;
}): ValidationResult {
  const parsed = collectorDatasetSchema.safeParse(input.payload);
  const schemaIssues = parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      }));

  if (!parsed.success) {
    return {
      accepted: false,
      classification: "ambiguous_contract_failure",
      rows: [],
      report: {
        contractVersion: COLLECTION_CONTRACT_VERSION,
        valid: false,
        checks: [
          {
            id: "schema",
            passed: false,
            details: "The Bright Data output does not match the versioned contract.",
          },
        ],
        rowCount: 0,
        stationCount: 0,
        statusCounts: {},
        missingStations: [...SFMTA_STATION_NAMES].sort(),
        unexpectedStations: [],
        duplicateIdentities: [],
        missingCriticalFields: [],
        sourceValidAt: null,
        freshnessSeconds: null,
        structuralFingerprint: null,
        previousStructuralFingerprint: input.previousStructuralFingerprint,
        reasonCodes: ["SCHEMA_INVALID"],
        schemaIssues,
      },
    };
  }

  const rawRows = flattenCollectorDataset(parsed.data);
  const identities = rawRows
    .filter((row) => row.station_name?.trim() && row.equipment_name?.trim())
    .map((row) =>
      equipmentIdentity(row.station_name!, row.equipment_name!),
    );
  const identityCounts = new Map<string, number>();
  for (const identity of identities) {
    identityCounts.set(identity, (identityCounts.get(identity) ?? 0) + 1);
  }
  const duplicateIdentities = [...identityCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([identity]) => identity)
    .sort();

  const stationNames = new Set(
    rawRows
      .map((row) => row.station_name && normalizeWhitespace(row.station_name))
      .filter((value): value is string => Boolean(value)),
  );
  const missingStations = [...SFMTA_STATION_NAMES]
    .filter((name) => !stationNames.has(name))
    .sort();
  const unexpectedStations = [...stationNames]
    .filter((name) => !SFMTA_STATION_NAMES.has(name))
    .sort();
  const stationAccessibilityValues = new Map<string, Set<string>>();
  for (const row of rawRows) {
    if (!row.station_name || !row.station_accessibility) continue;
    const stationName = normalizeWhitespace(row.station_name);
    const values = stationAccessibilityValues.get(stationName) ?? new Set<string>();
    values.add(row.station_accessibility);
    stationAccessibilityValues.set(stationName, values);
  }
  const inconsistentStationStatuses = [...stationAccessibilityValues.entries()]
    .filter(([, values]) => values.size !== 1)
    .map(([stationName]) => stationName)
    .sort();

  const missingCriticalFields: string[] = [];
  const sourceDates: Date[] = [];
  const statusCounts: Record<string, number> & {
    in_service: number;
    out_of_service: number;
    unknown: number;
  } = {
    in_service: 0,
    out_of_service: 0,
    unknown: 0,
  };

  rawRows.forEach((row, index) => {
    if (!row.station_name?.trim()) missingCriticalFields.push(`${index}.station_name`);
    if (!row.equipment_name?.trim()) missingCriticalFields.push(`${index}.equipment_name`);
    if (row.equipment_type !== "elevator") missingCriticalFields.push(`${index}.equipment_type`);
    if (!row.station_accessibility || row.station_accessibility === "unknown") {
      missingCriticalFields.push(`${index}.station_accessibility`);
    }
    if (!row.equipment_status || row.equipment_status === "unknown") {
      missingCriticalFields.push(`${index}.equipment_status`);
    }
    if (!row.last_changed_text || !parseSfmtaTimestamp(row.last_changed_text)) {
      missingCriticalFields.push(`${index}.last_changed_text`);
    }
    const sourceDate = parseSfmtaTimestamp(row.source_valid_text);
    if (!sourceDate) {
      missingCriticalFields.push(`${index}.source_valid_text`);
    } else {
      sourceDates.push(sourceDate);
    }
    statusCounts[row.equipment_status ?? "unknown"] =
      (statusCounts[row.equipment_status ?? "unknown"] ?? 0) + 1;
  });

  const uniqueSourceTimes = [...new Set(sourceDates.map((date) => date.toISOString()))];
  const sourceValidAt = uniqueSourceTimes.length === 1 ? sourceDates[0] : null;
  const freshnessMs = sourceValidAt
    ? input.collectedAt.getTime() - sourceValidAt.getTime()
    : null;
  const fingerprint =
    identities.length === rawRows.length
      ? sha256Json([...identities].sort())
      : null;
  const fingerprintStable =
    input.previousStructuralFingerprint === null ||
    fingerprint === input.previousStructuralFingerprint;
  const sourceUrlValid = rawRows.every(
    (row) => row.source_url === input.expectedSourceUrl,
  );

  const checks: ContractCheck[] = [
    { id: "schema", passed: true, details: "Versioned payload schema matched." },
    {
      id: "single_input_envelope",
      passed: parsed.data.length === 1,
      details: `Received ${parsed.data.length} top-level result envelope(s).`,
    },
    {
      id: "row_count",
      passed: rawRows.length >= MIN_ELEVATOR_ROWS && rawRows.length <= MAX_ELEVATOR_ROWS,
      details: `Received ${rawRows.length} elevator rows; expected ${MIN_ELEVATOR_ROWS}–${MAX_ELEVATOR_ROWS}.`,
    },
    {
      id: "station_coverage",
      passed: missingStations.length === 0 && unexpectedStations.length === 0,
      details: `Found ${stationNames.size} of ${SFMTA_STATION_NAMES.size} expected stations.`,
    },
    {
      id: "unique_identities",
      passed: duplicateIdentities.length === 0,
      details: `${duplicateIdentities.length} duplicate equipment identities found.`,
    },
    {
      id: "critical_fields",
      passed: missingCriticalFields.length === 0,
      details: `${missingCriticalFields.length} missing, unknown, or unparseable critical fields found.`,
    },
    {
      id: "station_status_consistency",
      passed: inconsistentStationStatuses.length === 0,
      details: `${inconsistentStationStatuses.length} stations reported contradictory accessibility states.`,
    },
    {
      id: "status_distribution",
      passed: statusCounts.in_service > 0,
      details: `${statusCounts.in_service} elevators were reported in service.`,
    },
    {
      id: "source_url",
      passed: sourceUrlValid,
      details: sourceUrlValid ? "Every row cites the configured SFMTA source." : "At least one row cites an unexpected source.",
    },
    {
      id: "source_time_consistency",
      passed: uniqueSourceTimes.length === 1 && sourceValidAt !== null,
      details: `Found ${uniqueSourceTimes.length} distinct parseable source-valid timestamps.`,
    },
    {
      id: "source_freshness",
      passed:
        freshnessMs !== null &&
        freshnessMs >= -FUTURE_TOLERANCE_MS &&
        freshnessMs <= HEALTHY_FRESHNESS_MS,
      details:
        freshnessMs === null
          ? "Source freshness could not be calculated."
          : `Source age was ${Math.round(freshnessMs / 1_000)} seconds at collection.`,
    },
    {
      id: "structural_fingerprint",
      passed: fingerprint !== null && fingerprintStable,
      details:
        input.previousStructuralFingerprint === null
          ? "Initial structural baseline is complete."
          : fingerprintStable
            ? "Structural fingerprint matches the last trusted snapshot."
            : "Structural fingerprint differs from the last trusted snapshot.",
    },
  ];

  const reasons: string[] = [];
  const failed = new Set(checks.filter((check) => !check.passed).map((check) => check.id));
  if (failed.has("single_input_envelope")) addReason(reasons, "ENVELOPE_COUNT_INVALID");
  if (failed.has("row_count")) addReason(reasons, "ROW_COUNT_IMPLAUSIBLE");
  if (failed.has("station_coverage")) addReason(reasons, "STATION_COVERAGE_CHANGED");
  if (failed.has("unique_identities")) addReason(reasons, "DUPLICATE_EQUIPMENT_IDENTITY");
  if (failed.has("critical_fields")) addReason(reasons, "CRITICAL_FIELDS_UNKNOWN");
  if (failed.has("station_status_consistency")) addReason(reasons, "STATION_STATUS_CONTRADICTORY");
  if (failed.has("status_distribution")) addReason(reasons, "STATUS_DISTRIBUTION_IMPOSSIBLE");
  if (failed.has("source_url")) addReason(reasons, "SOURCE_URL_MISMATCH");
  if (failed.has("source_time_consistency")) addReason(reasons, "SOURCE_TIME_INVALID");
  if (failed.has("structural_fingerprint")) addReason(reasons, "STRUCTURAL_FINGERPRINT_CHANGED");
  if (freshnessMs !== null && freshnessMs > HEALTHY_FRESHNESS_MS) addReason(reasons, "SOURCE_STALE");
  if (freshnessMs !== null && freshnessMs < -FUTURE_TOLERANCE_MS) addReason(reasons, "SOURCE_TIME_IN_FUTURE");

  const driftFailure =
    failed.has("row_count") ||
    failed.has("station_coverage") ||
    failed.has("unique_identities") ||
    failed.has("structural_fingerprint");
  const staleFailure = freshnessMs !== null && freshnessMs > HEALTHY_FRESHNESS_MS;
  const accepted = checks.every((check) => check.passed);
  const classification: CollectionClassification = accepted
    ? "healthy_no_change"
    : driftFailure
      ? "probable_layout_drift"
      : staleFailure
        ? "source_stale"
        : "ambiguous_contract_failure";

  const normalizedRows: NormalizedElevatorRow[] = accepted
    ? rawRows.map((row) => ({
        stationName: normalizeWhitespace(row.station_name!),
        stationAccessibility: mapStationAccessibility(row.station_accessibility),
        equipmentName: normalizeWhitespace(row.equipment_name!),
        equipmentSourceKey: equipmentSourceKey(row.station_name!, row.equipment_name!),
        equipmentStatus: row.equipment_status!,
        sourceValidAt: sourceValidAt!,
        sourceLastChangedAt: parseSfmtaTimestamp(row.last_changed_text),
        raw: row,
      }))
    : [];

  return {
    accepted,
    classification,
    rows: normalizedRows,
    report: {
      contractVersion: COLLECTION_CONTRACT_VERSION,
      valid: accepted,
      checks,
      rowCount: rawRows.length,
      stationCount: stationNames.size,
      statusCounts,
      missingStations,
      unexpectedStations,
      duplicateIdentities,
      missingCriticalFields,
      sourceValidAt: sourceValidAt?.toISOString() ?? null,
      freshnessSeconds: freshnessMs === null ? null : Math.round(freshnessMs / 1_000),
      structuralFingerprint: fingerprint,
      previousStructuralFingerprint: input.previousStructuralFingerprint,
      reasonCodes: reasons,
      schemaIssues,
    },
  };
}
