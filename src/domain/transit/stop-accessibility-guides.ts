import { createHash } from "node:crypto";

export const STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID = "c_mt0719p0vuntmudm6";
export const STOP_ACCESSIBILITY_GUIDE_SOURCE_URL =
  "https://www.sfmta.com/getting-around/sfmta-accessibility/muni-access-guide/access-muni-metro/muni-metro-accessible-stops";
export const STOP_ACCESSIBILITY_GUIDE_TITLE = "Muni Metro Accessible Stops";

const TOP_LEVEL_KEYS = [
  "accessibility_content",
  "input",
  "page_title",
  "product_page_url",
  "scraped_at",
  "source_url",
] as const;
const UNDERGROUND_GUIDANCE =
  "All Muni Metro underground stations (Embarcadero, Montgomery, Powell, Civic Center, Van Ness, Church Street, Castro Street, Forest Hill, Chinatown-Rose-Pak and Union Square-Market Street) are accessible via street-to-concourse elevators and concourse-to-platform elevators.";
const SURFACE_OVERVIEW =
  "The surface portion of the following Metro lines are accessible at the following wayside platforms and surface-level stations: J Church, K Ingleside, L Taraval, M Ocean View, N Judah. The T Third is fully accessible. This information is also available as a map of accessible stops.";
const UNDERGROUND_STATIONS = [
  "Embarcadero",
  "Montgomery",
  "Powell",
  "Civic Center",
  "Van Ness",
  "Church Street",
  "Castro Street",
  "Forest Hill",
  "Chinatown-Rose-Pak",
  "Union Square-Market Street",
] as const;
const SECTIONS = [
  {
    heading: "J CHURCH ACCESSIBILITY:",
    route: "J",
    routeTuples: [["J", "N"], ["J"], ["J"], ["J"], ["J"], ["J"], ["J", "K"]],
  },
  {
    heading: "K INGLESIDE ACCESSIBILITY:",
    route: "K",
    routeTuples: [
      ["K", "L", "M"],
      ["K", "M"],
      ["K"],
      ["K"],
      ["K"],
      ["K"],
      ["K"],
      ["J", "K"],
    ],
  },
  {
    heading: "L TARAVAL ACCESSIBILITY:",
    route: "L",
    routeTuples: [["K", "L", "M"], ["L"], ["L"], ["L"], ["L"], ["L"]],
  },
  {
    heading: "M OCEAN VIEW ACCESSIBILITY:",
    route: "M",
    routeTuples: [
      ["K", "L", "M"],
      ["K", "M"],
      ["M"],
      ["M"],
      ["M"],
      ["M"],
      ["M"],
    ],
  },
  {
    heading: "N JUDAH ACCESSIBILITY:",
    route: "N",
    routeTuples: [
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
      ["N"],
    ],
  },
] as const;
const T_HEADING = "T THIRD ACCESSIBILITY:";
const T_GUIDANCE =
  "All stops on the T Third between Chinatown and Sunnydale are accessible.";
const MAX_CONTENT_LENGTH = 8_000;
const MAX_STATION_LENGTH = 240;
const MAX_LINE_LENGTH = 500;
const SCRAPE_PAST_TOLERANCE_MS = 15 * 60 * 1_000;
const SCRAPE_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;

export type StopAccessibilityGuide = {
  guideId: string;
  stopId: null;
  stationName: string;
  routeNames: string[];
  guidance: string;
  accessibilityState: "unknown";
  reviewed: true;
  publicUrl: typeof STOP_ACCESSIBILITY_GUIDE_SOURCE_URL;
};

export type StopAccessibilityGuideReason = {
  code:
    | "COLLECTOR_ID_MISMATCH"
    | "SOURCE_URL_MISMATCH"
    | "COLLECTION_INCOMPLETE"
    | "ENVELOPE_SHAPE_CHANGED"
    | "SOURCE_IDENTITY_CHANGED"
    | "INVALID_SCRAPED_TIME"
    | "INVALID_CONTENT"
    | "LAYOUT_CHANGED"
    | "DUPLICATE_GUIDE";
  line?: number;
  field?: string;
  message: string;
};

export type StopAccessibilityGuideValidationResult =
  | {
      accepted: true;
      guides: StopAccessibilityGuide[];
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
      reasons: StopAccessibilityGuideReason[];
      report: {
        accepted: false;
        rowCount: number;
        reasons: StopAccessibilityGuideReason[];
      };
    };

type RawEnvelope = {
  accessibility_content: string;
  input: { url: string };
  page_title: string;
  product_page_url: string;
  scraped_at: string;
  source_url: string;
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

function isStrictIsoTimestamp(value: string) {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = Number(match[8] ?? 0);
  const offsetMinute = Number(match[9] ?? 0);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day &&
    hour <= 23 &&
    minute <= 59 &&
    second <= 59 &&
    offsetHour <= 23 &&
    offsetMinute <= 59 &&
    Number.isFinite(new Date(value).valueOf())
  );
}

function isRawEnvelope(value: unknown): value is RawEnvelope {
  if (!isRecord(value) || !exactKeys(value, TOP_LEVEL_KEYS)) return false;
  return (
    typeof value.accessibility_content === "string" &&
    isRecord(value.input) &&
    exactKeys(value.input, ["url"]) &&
    typeof value.input.url === "string" &&
    typeof value.page_title === "string" &&
    typeof value.product_page_url === "string" &&
    typeof value.scraped_at === "string" &&
    typeof value.source_url === "string"
  );
}

function safeSourceLine(value: string, maximum: number) {
  if (
    value.length === 0 ||
    value.length > maximum ||
    /<[^>]*>|[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  const normalized = value.replaceAll(/\s+/g, " ").trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : null;
}

function surfaceGuide(
  line: string,
  route: string,
  expectedRoutes: readonly string[],
  order: number,
): StopAccessibilityGuide | null {
  const safeLine = safeSourceLine(line, MAX_LINE_LENGTH);
  if (!safeLine) return null;
  const match = /^(.+?) \(([JKLMNT](?:, [JKLMNT])*)\)$/.exec(safeLine);
  if (!match) return null;
  const stationName = safeSourceLine(match[1]!, MAX_STATION_LENGTH);
  const routeNames = match[2]!.split(", ");
  if (
    !stationName ||
    routeNames.length !== expectedRoutes.length ||
    routeNames.some((name, index) => name !== expectedRoutes[index]) ||
    !routeNames.includes(route) ||
    new Set(routeNames).size !== routeNames.length
  )
    return null;
  return {
    guideId: `guide-${String(order).padStart(3, "0")}-${sha256(
      JSON.stringify({ order, section: route, stationName }),
    ).slice(0, 24)}`,
    stopId: null,
    stationName,
    routeNames,
    guidance: safeLine,
    accessibilityState: "unknown",
    reviewed: true,
    publicUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
  };
}

function rejected(
  reasons: StopAccessibilityGuideReason[],
  rowCount: number,
): StopAccessibilityGuideValidationResult {
  return {
    accepted: false,
    reasons,
    report: { accepted: false, rowCount, reasons },
  };
}

export function validateStopAccessibilityGuides(input: {
  collectorId: string;
  sourceUrl: string;
  datasetComplete: boolean;
  envelope: unknown;
  collectedAt: Date;
}): StopAccessibilityGuideValidationResult {
  const reasons: StopAccessibilityGuideReason[] = [];
  if (input.collectorId !== STOP_ACCESSIBILITY_GUIDE_COLLECTOR_ID) {
    reasons.push({
      code: "COLLECTOR_ID_MISMATCH",
      message: "The accessible-stop collector identity changed.",
    });
  }
  if (input.sourceUrl !== STOP_ACCESSIBILITY_GUIDE_SOURCE_URL) {
    reasons.push({
      code: "SOURCE_URL_MISMATCH",
      message: "The accessible-stop source changed.",
    });
  }
  if (!input.datasetComplete) {
    reasons.push({
      code: "COLLECTION_INCOMPLETE",
      message: "The accessible-stop collection did not finish.",
    });
  }
  if (!isRawEnvelope(input.envelope)) {
    reasons.push({
      code: "ENVELOPE_SHAPE_CHANGED",
      message: "The accessible-stop response shape changed.",
    });
    return rejected(reasons, 0);
  }
  const envelope = input.envelope;
  if (
    envelope.input.url !== STOP_ACCESSIBILITY_GUIDE_SOURCE_URL ||
    envelope.product_page_url !== STOP_ACCESSIBILITY_GUIDE_SOURCE_URL ||
    envelope.source_url !== STOP_ACCESSIBILITY_GUIDE_SOURCE_URL ||
    envelope.page_title !== STOP_ACCESSIBILITY_GUIDE_TITLE
  ) {
    reasons.push({
      code: "SOURCE_IDENTITY_CHANGED",
      message: "The accessible-stop page identity changed.",
    });
  }
  const strictTimestamp = isStrictIsoTimestamp(envelope.scraped_at);
  const scrapedAt = new Date(envelope.scraped_at);
  if (
    !strictTimestamp ||
    Number.isNaN(scrapedAt.valueOf()) ||
    scrapedAt.valueOf() <
      input.collectedAt.valueOf() - SCRAPE_PAST_TOLERANCE_MS ||
    scrapedAt.valueOf() >
      input.collectedAt.valueOf() + SCRAPE_FUTURE_TOLERANCE_MS
  ) {
    reasons.push({
      code: "INVALID_SCRAPED_TIME",
      field: "scraped_at",
      message: "The accessible-stop scrape time is invalid.",
    });
  }
  const content = envelope.accessibility_content;
  if (
    content.length === 0 ||
    content.length > MAX_CONTENT_LENGTH ||
    /<[^>]*>|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)
  ) {
    reasons.push({
      code: "INVALID_CONTENT",
      field: "accessibility_content",
      message: "The accessible-stop guidance contains unsafe text.",
    });
    return rejected(reasons, 0);
  }
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.replaceAll(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
  if (
    lines.length !== 50 ||
    lines[0] !== UNDERGROUND_GUIDANCE ||
    lines[1] !== SURFACE_OVERVIEW
  ) {
    reasons.push({
      code: "LAYOUT_CHANGED",
      message: "The accessible-stop guidance layout changed.",
    });
    return rejected(reasons, lines.length);
  }

  const guides: StopAccessibilityGuide[] = UNDERGROUND_STATIONS.map(
    (stationName, order) => ({
      guideId: `guide-${String(order).padStart(3, "0")}-${sha256(
        JSON.stringify({ order, section: "underground", stationName }),
      ).slice(0, 24)}`,
      stopId: null,
      stationName,
      routeNames: ["Muni Metro"],
      guidance: UNDERGROUND_GUIDANCE,
      accessibilityState: "unknown",
      reviewed: true,
      publicUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    }),
  );
  let cursor = 2;
  for (const section of SECTIONS) {
    if (lines[cursor] !== section.heading) {
      reasons.push({
        code: "LAYOUT_CHANGED",
        line: cursor + 1,
        message: "An accessible-stop route section moved or changed.",
      });
      return rejected(reasons, lines.length);
    }
    cursor += 1;
    const sectionStations = new Set<string>();
    for (
      let sectionIndex = 0;
      sectionIndex < section.routeTuples.length;
      sectionIndex += 1
    ) {
      const guide = surfaceGuide(
        lines[cursor]!,
        section.route,
        section.routeTuples[sectionIndex]!,
        guides.length,
      );
      if (!guide) {
        reasons.push({
          code: "LAYOUT_CHANGED",
          line: cursor + 1,
          message: "An accessible-stop surface entry changed shape.",
        });
      } else {
        const stationIdentity = guide.stationName.toLowerCase();
        if (sectionStations.has(stationIdentity)) {
          reasons.push({
            code: "DUPLICATE_GUIDE",
            line: cursor + 1,
            message:
              "An accessible-stop entry repeats within its route section.",
          });
        }
        sectionStations.add(stationIdentity);
        guides.push(guide);
      }
      cursor += 1;
    }
  }
  if (lines[cursor] !== T_HEADING || lines[cursor + 1] !== T_GUIDANCE) {
    reasons.push({
      code: "LAYOUT_CHANGED",
      line: cursor + 1,
      message: "The T Third accessible-stop guidance changed.",
    });
  } else {
    guides.push({
      guideId: `guide-${String(guides.length).padStart(3, "0")}-${sha256(
        JSON.stringify({
          order: guides.length,
          section: "T",
          stationName: T_GUIDANCE,
        }),
      ).slice(0, 24)}`,
      stopId: null,
      stationName: "T Third between Chinatown and Sunnydale",
      routeNames: ["T"],
      guidance: T_GUIDANCE,
      accessibilityState: "unknown",
      reviewed: true,
      publicUrl: STOP_ACCESSIBILITY_GUIDE_SOURCE_URL,
    });
  }
  if (reasons.length > 0 || guides.length !== 52) {
    if (
      guides.length !== 52 &&
      !reasons.some((reason) => reason.code === "LAYOUT_CHANGED")
    ) {
      reasons.push({
        code: "LAYOUT_CHANGED",
        message: "The accessible-stop guide count changed.",
      });
    }
    return rejected(reasons, lines.length);
  }
  const structuralFingerprint = sha256(
    JSON.stringify({
      top: TOP_LEVEL_KEYS,
      input: ["url"],
      headings: [...SECTIONS.map((section) => section.heading), T_HEADING],
      routeTuples: SECTIONS.map((section) => section.routeTuples),
      lines: 50,
      guides: 52,
    }),
  );
  const payloadHash = sha256(JSON.stringify(guides));
  return {
    accepted: true,
    guides,
    payloadHash,
    structuralFingerprint,
    report: {
      accepted: true,
      rowCount: guides.length,
      structuralFingerprint,
    },
  };
}

export function stopAccessibilityGuideEvidenceHash(input: {
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
