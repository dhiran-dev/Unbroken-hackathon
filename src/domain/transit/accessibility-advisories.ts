import { createHash } from "node:crypto";

export const ACCESSIBILITY_ADVISORY_COLLECTOR_ID = "c_mt00zyx63815q2j9g";
export const ACCESSIBILITY_ADVISORY_SOURCE_URL =
  "https://www.sfmta.com/travel-transit-updates?field_transit_type_disrupted_value=Accessibility";

const EXPECTED_KEYS = [
  "body_text",
  "detail_url",
  "input",
  "neighborhoods_affected",
  "product_page_url",
  "relocation_rows",
  "routes_affected",
  "scraped_at",
  "service_affected",
  "source_url",
  "stops_affected",
  "title",
] as const;
const EXPECTED_KEY_SET = new Set<string>(EXPECTED_KEYS);
const MAX_ROWS = 100;
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_ENTITY_COUNT = 100;
const MAX_ENTITY_LENGTH = 80;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
const MAX_COLLECTION_AGE_MS = 90 * 60 * 1_000;

export type AccessibilityAdvisory = {
  advisoryId: string;
  title: string;
  description: string;
  affectedStops: string[];
  affectedRoutes: string[];
  startsAt: Date | null;
  endsAt: Date | null;
  publicUrl: string;
};

type RawAccessibilityAdvisory = {
  body_text: string;
  detail_url: string;
  input: Record<string, unknown>;
  neighborhoods_affected: string[];
  product_page_url: string;
  relocation_rows: unknown[];
  routes_affected: string[];
  scraped_at: string;
  service_affected: string[];
  source_url: string;
  stops_affected: string[];
  title: string;
};

export type AccessibilityValidationReason = {
  code:
    | "COLLECTOR_ID_MISMATCH"
    | "SOURCE_URL_MISMATCH"
    | "COLLECTION_INCOMPLETE"
    | "ROW_COUNT_TOO_LOW"
    | "ROW_COUNT_TOO_HIGH"
    | "ROW_SHAPE_CHANGED"
    | "RELOCATION_ROWS_PRESENT"
    | "INVALID_DETAIL_URL"
    | "DUPLICATE_ADVISORY"
    | "INVALID_TEXT"
    | "INVALID_SCRAPED_AT"
    | "SCRAPE_TIME_IMPLAUSIBLE"
    | "ACCESSIBILITY_TAG_MISSING"
    | "AFFECTED_ENTITY_MISSING"
    | "INVALID_AFFECTED_ENTITY";
  row?: number;
  field?: string;
  message: string;
};

export type AccessibilityValidationResult =
  | {
      accepted: true;
      advisories: AccessibilityAdvisory[];
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
      reasons: AccessibilityValidationReason[];
      report: {
        accepted: false;
        rowCount: number;
        reasons: AccessibilityValidationReason[];
      };
    };

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function decodeEntities(value: string) {
  return value
    .replaceAll(/&nbsp;/gi, " ")
    .replaceAll(/&amp;/gi, "&")
    .replaceAll(/&lt;/gi, "<")
    .replaceAll(/&gt;/gi, ">")
    .replaceAll(/&quot;/gi, '"')
    .replaceAll(/&#39;|&apos;/gi, "'");
}

function safeText(value: string) {
  return decodeEntities(value)
    .replaceAll(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replaceAll(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replaceAll(/<[^>]+>/g, " ")
    .replaceAll(/[\u0000-\u001f\u007f]/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
}

function safeDetailUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.sfmta.com" ||
      url.port !== "" ||
      url.username !== "" ||
      url.password !== "" ||
      url.search !== "" ||
      url.hash !== "" ||
      url.pathname.length > 512
    ) {
      return null;
    }
    const decodedPath = decodeURIComponent(url.pathname);
    if (
      decodedPath.length > 512 ||
      !decodedPath.startsWith("/travel-updates/") ||
      decodedPath.length <= "/travel-updates/".length ||
      decodedPath.includes("\\") ||
      decodedPath.includes("//") ||
      decodedPath.split("/").includes("..") ||
      /[\u0000-\u001f\u007f]/u.test(decodedPath)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeEntities(value: string[]) {
  if (value.length > MAX_ENTITY_COUNT) return null;
  const normalized = value.map(safeText);
  if (
    normalized.some(
      (item) => item.length === 0 || item.length > MAX_ENTITY_LENGTH,
    )
  ) {
    return null;
  }
  return [...new Set(normalized)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function rowShapeIsExact(
  row: Record<string, unknown>,
): row is RawAccessibilityAdvisory {
  const keys = Object.keys(row);
  if (
    keys.length !== EXPECTED_KEYS.length ||
    keys.some((key) => !EXPECTED_KEY_SET.has(key))
  ) {
    return false;
  }
  return (
    typeof row.body_text === "string" &&
    typeof row.detail_url === "string" &&
    isRecord(row.input) &&
    isStringArray(row.neighborhoods_affected) &&
    typeof row.product_page_url === "string" &&
    Array.isArray(row.relocation_rows) &&
    isStringArray(row.routes_affected) &&
    typeof row.scraped_at === "string" &&
    isStringArray(row.service_affected) &&
    typeof row.source_url === "string" &&
    isStringArray(row.stops_affected) &&
    typeof row.title === "string"
  );
}

function canonicalAdvisory(advisory: AccessibilityAdvisory) {
  return {
    advisoryId: advisory.advisoryId,
    title: advisory.title,
    description: advisory.description,
    affectedStops: advisory.affectedStops,
    affectedRoutes: advisory.affectedRoutes,
    startsAt: advisory.startsAt?.toISOString() ?? null,
    endsAt: advisory.endsAt?.toISOString() ?? null,
    publicUrl: advisory.publicUrl,
  };
}

export function validateAccessibilityAdvisories(input: {
  collectorId: string;
  sourceUrl: string;
  rows: readonly unknown[];
  at: Date;
  previousRowCount: number | null;
  listingComplete: boolean;
  detailNavigationComplete: boolean;
}): AccessibilityValidationResult {
  const reasons: AccessibilityValidationReason[] = [];
  const add = (
    reason: Omit<AccessibilityValidationReason, "message"> & {
      message: string;
    },
  ) => reasons.push(reason);

  if (input.collectorId !== ACCESSIBILITY_ADVISORY_COLLECTOR_ID) {
    add({
      code: "COLLECTOR_ID_MISMATCH",
      message: "The configured accessibility collector identity changed.",
    });
  }
  if (input.sourceUrl !== ACCESSIBILITY_ADVISORY_SOURCE_URL) {
    add({
      code: "SOURCE_URL_MISMATCH",
      message: "The accessibility advisory source changed.",
    });
  }
  if (!input.listingComplete || !input.detailNavigationComplete) {
    add({
      code: "COLLECTION_INCOMPLETE",
      message:
        "The accessibility advisory collection did not finish every required page.",
    });
  }

  const minimumRows = Math.max(
    11,
    Math.ceil((input.previousRowCount ?? 11) * 0.8),
  );
  if (input.rows.length < minimumRows) {
    add({
      code: "ROW_COUNT_TOO_LOW",
      message: "The advisory collection is smaller than the safe baseline.",
    });
  }
  if (input.rows.length > MAX_ROWS) {
    add({
      code: "ROW_COUNT_TOO_HIGH",
      message: "The advisory collection exceeds the safe limit.",
    });
  }

  const normalized: AccessibilityAdvisory[] = [];
  const advisoryIds = new Set<string>();
  for (const [index, candidate] of input.rows.entries()) {
    if (!isRecord(candidate) || !rowShapeIsExact(candidate)) {
      add({
        code: "ROW_SHAPE_CHANGED",
        row: index,
        message: "An advisory row no longer matches the expected fields.",
      });
      continue;
    }
    if (candidate.relocation_rows.length !== 0) {
      add({
        code: "RELOCATION_ROWS_PRESENT",
        row: index,
        field: "relocation_rows",
        message: "An advisory row contains unexpected relocation details.",
      });
    }
    const publicUrl = safeDetailUrl(candidate.detail_url);
    const sourceUrl = safeDetailUrl(candidate.source_url);
    const productPageUrl = safeDetailUrl(candidate.product_page_url);
    if (!publicUrl || !sourceUrl || !productPageUrl) {
      add({
        code: "INVALID_DETAIL_URL",
        row: index,
        message: "An advisory link is not an allowed SFMTA detail link.",
      });
    } else if (publicUrl !== sourceUrl || publicUrl !== productPageUrl) {
      add({
        code: "SOURCE_URL_MISMATCH",
        row: index,
        message:
          "An advisory row does not use one consistent official detail link.",
      });
    }

    const title = safeText(candidate.title);
    const description = safeText(candidate.body_text);
    if (
      title.length === 0 ||
      title.length > MAX_TITLE_LENGTH ||
      description.length === 0 ||
      description.length > MAX_DESCRIPTION_LENGTH
    ) {
      add({
        code: "INVALID_TEXT",
        row: index,
        message: "An advisory title or description is missing or too long.",
      });
    }

    const scrapedAt = new Date(candidate.scraped_at);
    if (Number.isNaN(scrapedAt.valueOf())) {
      add({
        code: "INVALID_SCRAPED_AT",
        row: index,
        field: "scraped_at",
        message: "An advisory collection time is invalid.",
      });
    } else if (
      scrapedAt.valueOf() > input.at.valueOf() + FUTURE_TOLERANCE_MS ||
      input.at.valueOf() - scrapedAt.valueOf() > MAX_COLLECTION_AGE_MS
    ) {
      add({
        code: "SCRAPE_TIME_IMPLAUSIBLE",
        row: index,
        field: "scraped_at",
        message: "An advisory collection time is outside the safe window.",
      });
    }

    if (!candidate.service_affected.includes("Accessibility")) {
      add({
        code: "ACCESSIBILITY_TAG_MISSING",
        row: index,
        field: "service_affected",
        message: "An advisory is not marked as an accessibility change.",
      });
    }

    const affectedRoutes = normalizeEntities(candidate.routes_affected);
    const affectedStops = normalizeEntities(candidate.stops_affected);
    if (!affectedRoutes || !affectedStops) {
      add({
        code: "INVALID_AFFECTED_ENTITY",
        row: index,
        message: "An affected route or stop is outside the safe limits.",
      });
    } else if (affectedRoutes.length + affectedStops.length === 0) {
      add({
        code: "AFFECTED_ENTITY_MISSING",
        row: index,
        message: "An advisory does not identify an affected route or stop.",
      });
    }

    if (
      publicUrl &&
      title.length > 0 &&
      title.length <= MAX_TITLE_LENGTH &&
      description.length > 0 &&
      description.length <= MAX_DESCRIPTION_LENGTH &&
      affectedRoutes &&
      affectedStops
    ) {
      const advisoryId = `advisory-${sha256(publicUrl).slice(0, 32)}`;
      if (advisoryIds.has(advisoryId)) {
        add({
          code: "DUPLICATE_ADVISORY",
          row: index,
          message: "The advisory collection contains a duplicate detail link.",
        });
      } else {
        advisoryIds.add(advisoryId);
        normalized.push({
          advisoryId,
          title,
          description,
          affectedStops,
          affectedRoutes,
          // The verified 12-field source provides no effective-date fields.
          startsAt: null,
          endsAt: null,
          publicUrl,
        });
      }
    }
  }

  if (reasons.length > 0) {
    return {
      accepted: false,
      reasons,
      report: { accepted: false, rowCount: input.rows.length, reasons },
    };
  }

  normalized.sort((left, right) =>
    left.advisoryId.localeCompare(right.advisoryId),
  );
  const structuralFingerprint = sha256(
    JSON.stringify({
      keys: EXPECTED_KEYS,
      types: [
        "string",
        "string",
        "object",
        "string[]",
        "string",
        "empty[]",
        "string[]",
        "string",
        "string[]",
        "string",
        "string[]",
        "string",
      ],
    }),
  );
  const payloadHash = sha256(JSON.stringify(normalized.map(canonicalAdvisory)));
  return {
    accepted: true,
    advisories: normalized,
    payloadHash,
    structuralFingerprint,
    report: {
      accepted: true,
      rowCount: normalized.length,
      structuralFingerprint,
    },
  };
}

export function accessibilityEvidenceHash(input: {
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
