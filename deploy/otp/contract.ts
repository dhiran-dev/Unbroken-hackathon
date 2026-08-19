export const OTP_PINS = {
  configVersion: "unbroken-sf-otp-v1",
  otpVersion: "2.9.0",
  image: {
    index:
      "docker.io/opentripplanner/opentripplanner@sha256:a7eac7da397faa9ec9dee407d4204895d24df4981500662fa6793aae0e71fd8f",
    linuxAmd64:
      "sha256:f5e8e6cf771d0e7c742ce54e79770f0dc8b921f3382d7ad9507e4d13447e97de",
    linuxArm64:
      "sha256:b43dee5a664d5b130eb72d69c9cef7876251bec1b0a9168056ccf12e9646daf9",
    releaseCommit: "9babe45ffc9327933129f705c648137ecd96cdbe",
    jarBytes: 183_261_367,
    jarSha256:
      "112824122cd1a89e2dff6b5b3088ffbd4f04c3c0a400ca9f08f17b762f5325f6",
  },
  osm: {
    sourceUrl:
      "https://download.geofabrik.de/north-america/us/california/norcal-260818.osm.pbf",
    sourceBytes: 649_346_007,
    sourceMd5: "c768ad7dc1b4f2d15ff551f9c8016641",
    sourceSha256:
      "f25984fd70d3516b2753bae457fbf25dbe985817d198c746d87b4a1557ec186d",
    extractionStrategy: "complete_ways",
    setBounds: true,
    extractedBytes: 19_894_206,
    extractedSha256:
      "c7b3a04f1bd447be696ccd8bad0c94aa63a92e54ec499c3e260536448458e910",
    osmiumVersion: "osmium version 1.16.0 (libosmium 2.20.0)",
    nodes: 2_393_795,
    ways: 285_040,
    relations: 7_243,
    missingWayNodes: 0,
    lastTimestamp: "2026-08-18T20:20:21Z",
    bbox: "-122.58,37.68,-122.31,37.86",
  },
  healthPath: "/otp/actuators/health",
  graphqlPath: "/otp/gtfs/v1",
  origin: { latitude: 37.75225, longitude: -122.41845 },
  destination: { latitude: 37.808, longitude: -122.4177 },
  requestedItineraries: 5,
} as const;

export type OtpBuildManifest = {
  configVersion: string;
  image: {
    index: string;
    linuxAmd64: string;
    linuxArm64: string;
    releaseCommit: string;
    jarBytes: number;
    jarSha256: string;
  };
  osm: {
    sourceUrl: string;
    sourceBytes: number;
    sourceMd5: string;
    sourceSha256: string;
    bbox: string;
    extractionStrategy: string;
    setBounds: boolean;
    extractedBytes: number;
    extractedSha256: string;
    osmiumVersion: string;
    nodes: number;
    ways: number;
    relations: number;
    missingWayNodes: number;
    lastTimestamp: string;
  };
  gtfs: {
    fileName: string;
    activeArchiveSha256: string;
    stagedSha256: string;
  };
  graph: {
    fileName: string;
    bytes: number;
    sha256: string;
  };
};

export type OtpServiceEvidence = {
  image: string;
  platformManifest: string;
  configVersion: string;
  graphSha256: string;
  otpVersion: string;
  privateNetwork: boolean;
  hostPorts: number[];
  readOnly: boolean;
  memoryLimitBytes: number;
  javaMaxHeapBytes: number;
  healthPath: string;
  graphqlPath: string;
};

export type OtpDeploymentInputs = {
  manifest: unknown;
  service: OtpServiceEvidence;
  health: { statusCode: number; body: unknown };
  serviceDateTime: string;
  plan: { statusCode: number; body: unknown };
  wheelchairProbe: { statusCode: number; body: unknown };
};

export type OtpPlanRequest = {
  path: typeof OTP_PINS.graphqlPath;
  body: {
    query: string;
    variables: {
      serviceDateTime: string;
    };
  };
};

export type OtpVerificationResult =
  | {
      ready: true;
      evidence: {
        configVersion: typeof OTP_PINS.configVersion;
        otpVersion: typeof OTP_PINS.otpVersion;
        imageIndex: typeof OTP_PINS.image.index;
        platformManifest: string;
        graphSha256: string;
        gtfsSha256: string;
        gtfsGeneratedZipSha256: string;
        osmSha256: string;
        serviceDateTime: string;
        requestedItineraries: typeof OTP_PINS.requestedItineraries;
        accessibilityClaim: false;
        candidateRole: "static_candidates_only";
        wheelchairFilteredCandidateCount: 0;
        itineraryCount: number;
        transitItineraryCount: number;
      };
    }
  | {
      ready: false;
      code:
        | "BUILD_EVIDENCE_INVALID"
        | "SERVICE_CONTRACT_INVALID"
        | "SERVICE_NOT_READY"
        | "PLAN_INVALID";
      message: "Current updates are unavailable.";
    };

const SHA256 = /^[a-f0-9]{64}$/;
const MD5 = /^[a-f0-9]{32}$/;
const ISO_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/;
const TRANSIT_MODES = new Set([
  "BUS",
  "CABLE_CAR",
  "FERRY",
  "FUNICULAR",
  "GONDOLA",
  "RAIL",
  "SUBWAY",
  "TRAM",
  "TROLLEYBUS",
  "MONORAIL",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function validIsoDateTime(value: string) {
  const match = ISO_OFFSET.exec(value);
  if (!match) return false;
  const [year, month, day, hour, minute, second] = match
    .slice(1, 7)
    .map(Number);
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined ||
    second === undefined ||
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return false;
  const offsetHours = match[9] ? Number(match[9]) : 0;
  const offsetMinutes = match[10] ? Number(match[10]) : 0;
  if (offsetHours > 23 || offsetMinutes > 59) return false;
  const offset =
    match[7] === "Z"
      ? 0
      : (match[8] === "+" ? 1 : -1) *
        (offsetHours * 60 + offsetMinutes) *
        60_000;
  const instant = new Date(
    Date.UTC(year, month - 1, day, hour, minute, second) - offset,
  );
  const local = new Date(instant.valueOf() + offset);
  return (
    Number.isFinite(instant.valueOf()) &&
    local.getUTCFullYear() === year &&
    local.getUTCMonth() === month - 1 &&
    local.getUTCDate() === day &&
    local.getUTCHours() === hour &&
    local.getUTCMinutes() === minute &&
    local.getUTCSeconds() === second
  );
}

function isBuildManifest(value: unknown): value is OtpBuildManifest {
  if (!isRecord(value)) return false;
  const image = value.image;
  const osm = value.osm;
  const gtfs = value.gtfs;
  const graph = value.graph;
  if (
    !isRecord(image) ||
    !isRecord(osm) ||
    !isRecord(gtfs) ||
    !isRecord(graph)
  ) {
    return false;
  }
  return (
    value.configVersion === OTP_PINS.configVersion &&
    image.index === OTP_PINS.image.index &&
    image.linuxAmd64 === OTP_PINS.image.linuxAmd64 &&
    image.linuxArm64 === OTP_PINS.image.linuxArm64 &&
    image.releaseCommit === OTP_PINS.image.releaseCommit &&
    image.jarBytes === OTP_PINS.image.jarBytes &&
    image.jarSha256 === OTP_PINS.image.jarSha256 &&
    osm.sourceUrl === OTP_PINS.osm.sourceUrl &&
    osm.sourceBytes === OTP_PINS.osm.sourceBytes &&
    osm.sourceMd5 === OTP_PINS.osm.sourceMd5 &&
    MD5.test(String(osm.sourceMd5)) &&
    osm.bbox === OTP_PINS.osm.bbox &&
    osm.sourceSha256 === OTP_PINS.osm.sourceSha256 &&
    osm.extractionStrategy === OTP_PINS.osm.extractionStrategy &&
    osm.setBounds === OTP_PINS.osm.setBounds &&
    osm.extractedBytes === OTP_PINS.osm.extractedBytes &&
    osm.extractedSha256 === OTP_PINS.osm.extractedSha256 &&
    osm.osmiumVersion === OTP_PINS.osm.osmiumVersion &&
    osm.nodes === OTP_PINS.osm.nodes &&
    osm.ways === OTP_PINS.osm.ways &&
    osm.relations === OTP_PINS.osm.relations &&
    osm.missingWayNodes === OTP_PINS.osm.missingWayNodes &&
    osm.lastTimestamp === OTP_PINS.osm.lastTimestamp &&
    typeof gtfs.fileName === "string" &&
    gtfs.fileName.length <= 200 &&
    /gtfs/i.test(gtfs.fileName) &&
    typeof gtfs.activeArchiveSha256 === "string" &&
    SHA256.test(gtfs.activeArchiveSha256) &&
    typeof gtfs.stagedSha256 === "string" &&
    SHA256.test(gtfs.stagedSha256) &&
    graph.fileName === "graph.obj" &&
    isPositiveInteger(graph.bytes) &&
    typeof graph.sha256 === "string" &&
    SHA256.test(graph.sha256)
  );
}

function isServiceContractValid(
  service: OtpServiceEvidence,
  manifest: OtpBuildManifest,
) {
  const platformManifestIsPinned =
    service.platformManifest === OTP_PINS.image.linuxAmd64 ||
    service.platformManifest === OTP_PINS.image.linuxArm64;
  return (
    service.image === OTP_PINS.image.index &&
    platformManifestIsPinned &&
    service.configVersion === OTP_PINS.configVersion &&
    service.otpVersion === OTP_PINS.otpVersion &&
    service.graphSha256 === manifest.graph.sha256 &&
    service.privateNetwork === true &&
    Array.isArray(service.hostPorts) &&
    service.hostPorts.length === 0 &&
    service.readOnly === true &&
    service.memoryLimitBytes === 4_294_967_296 &&
    service.javaMaxHeapBytes === 3_221_225_472 &&
    service.javaMaxHeapBytes < service.memoryLimitBytes &&
    service.healthPath === OTP_PINS.healthPath &&
    service.graphqlPath === OTP_PINS.graphqlPath
  );
}

function planCounts(body: unknown) {
  if (!isRecord(body) || "errors" in body || !isRecord(body.data)) return null;
  const connection = body.data.planConnection;
  if (!isRecord(connection) || !Array.isArray(connection.edges)) return null;
  if (
    connection.edges.length === 0 ||
    connection.edges.length > OTP_PINS.requestedItineraries
  ) {
    return null;
  }
  let transitItineraryCount = 0;
  for (const edge of connection.edges) {
    if (
      !isRecord(edge) ||
      !isRecord(edge.node) ||
      !Array.isArray(edge.node.legs)
    ) {
      return null;
    }
    const modes: string[] = [];
    for (const leg of edge.node.legs) {
      if (!isRecord(leg) || typeof leg.mode !== "string") return null;
      modes.push(leg.mode);
    }
    if (modes.some((mode) => TRANSIT_MODES.has(mode))) {
      transitItineraryCount += 1;
    }
  }
  if (transitItineraryCount === 0) return null;
  return {
    itineraryCount: connection.edges.length,
    transitItineraryCount,
  };
}

function failure(
  code: Exclude<OtpVerificationResult, { ready: true }>["code"],
): OtpVerificationResult {
  return {
    ready: false,
    code,
    message: "Current updates are unavailable.",
  };
}

export function createOtpPlanRequest(serviceDateTime: string): OtpPlanRequest {
  if (!validIsoDateTime(serviceDateTime)) {
    throw new Error("A valid service date and time is required.");
  }
  return {
    path: OTP_PINS.graphqlPath,
    body: {
      query: `query VerifyOtp($serviceDateTime: OffsetDateTime!) {
  planConnection(
    origin: { location: { coordinate: { latitude: 37.75225, longitude: -122.41845 } } }
    destination: { location: { coordinate: { latitude: 37.808, longitude: -122.4177 } } }
    dateTime: { earliestDeparture: $serviceDateTime }
    first: 5
    modes: { transitOnly: true, transit: { access: [WALK], egress: [WALK], transfer: [WALK], transit: [{ mode: BUS }, { mode: TRAM }, { mode: SUBWAY }, { mode: CABLE_CAR }] } }
  ) {
    edges { node { start end legs { mode } } }
    routingErrors { code inputField }
  }
}`,
      variables: { serviceDateTime },
    },
  };
}

export function createOtpWheelchairProbeRequest(
  serviceDateTime: string,
): OtpPlanRequest {
  const request = createOtpPlanRequest(serviceDateTime);
  return {
    ...request,
    body: {
      ...request.body,
      query: request.body.query.replace(
        "  ) {",
        "    preferences: { accessibility: { wheelchair: { enabled: true } } }\n  ) {",
      ),
    },
  };
}

function isExpectedUnknownWheelchairProbe(input: {
  statusCode: number;
  body: unknown;
}) {
  if (input.statusCode !== 200 || !isRecord(input.body)) return false;
  const data = input.body.data;
  if (!isRecord(data) || !isRecord(data.planConnection)) return false;
  const routingErrors = data.planConnection.routingErrors;
  if (
    !Array.isArray(data.planConnection.edges) ||
    data.planConnection.edges.length !== 0 ||
    !Array.isArray(routingErrors)
  ) {
    return false;
  }
  return routingErrors.some(
    (error) => isRecord(error) && error.code === "NO_STOPS_IN_RANGE",
  );
}

export function verifyOtpDeployment(
  input: OtpDeploymentInputs,
): OtpVerificationResult {
  if (!isBuildManifest(input.manifest)) {
    return failure("BUILD_EVIDENCE_INVALID");
  }
  if (!isServiceContractValid(input.service, input.manifest)) {
    return failure("SERVICE_CONTRACT_INVALID");
  }
  if (
    input.health.statusCode !== 200 ||
    !isRecord(input.health.body) ||
    input.health.body.status !== "UP"
  ) {
    return failure("SERVICE_NOT_READY");
  }
  if (
    !validIsoDateTime(input.serviceDateTime) ||
    input.plan.statusCode !== 200
  ) {
    return failure("PLAN_INVALID");
  }
  const counts = planCounts(input.plan.body);
  if (!isExpectedUnknownWheelchairProbe(input.wheelchairProbe)) {
    return failure("PLAN_INVALID");
  }
  if (!counts) return failure("PLAN_INVALID");
  return {
    ready: true,
    evidence: {
      configVersion: OTP_PINS.configVersion,
      otpVersion: OTP_PINS.otpVersion,
      imageIndex: OTP_PINS.image.index,
      platformManifest: input.service.platformManifest,
      graphSha256: input.manifest.graph.sha256,
      gtfsSha256: input.manifest.gtfs.activeArchiveSha256,
      gtfsGeneratedZipSha256: input.manifest.gtfs.stagedSha256,
      osmSha256: input.manifest.osm.extractedSha256,
      serviceDateTime: input.serviceDateTime,
      requestedItineraries: OTP_PINS.requestedItineraries,
      accessibilityClaim: false,
      candidateRole: "static_candidates_only",
      wheelchairFilteredCandidateCount: 0,
      itineraryCount: counts.itineraryCount,
      transitItineraryCount: counts.transitItineraryCount,
    },
  };
}
