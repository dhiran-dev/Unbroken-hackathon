import { createHash } from "node:crypto";

import { unzipSync } from "fflate";

export const MUNI_GTFS_ARCHIVE_SOURCE = {
  url: "https://api.511.org/transit/datafeeds",
  operatorId: "SF",
} as const;

export type MuniGtfsArchive = {
  operatorId: typeof MUNI_GTFS_ARCHIVE_SOURCE.operatorId;
  checkedAt: string;
  archiveByteLength: number;
  archiveSha256: string;
  headers: {
    contentType: string;
    contentLength: number | null;
    etag: string | null;
    lastModified: string | null;
  };
  files: Readonly<Record<string, string>>;
};

export type GtfsArchiveLimits = {
  maximumArchiveBytes: number;
  maximumFiles: number;
  maximumFileBytes: number;
  maximumExpandedBytes: number;
  timeoutMilliseconds: number;
};

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type DownloadMuniGtfsArchiveInput = {
  apiToken: string;
  fetchImplementation?: FetchImplementation;
  now?: () => Date;
  limits?: Partial<GtfsArchiveLimits>;
};

export type GtfsArchiveErrorCode =
  | "TOKEN_REQUIRED"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_CONTENT_TYPE"
  | "ARCHIVE_TOO_LARGE"
  | "INVALID_ZIP"
  | "UNSAFE_ENTRY"
  | "TOO_MANY_FILES"
  | "ENTRY_TOO_LARGE"
  | "ARCHIVE_EXPANSION_TOO_LARGE"
  | "ENCRYPTED_ENTRY"
  | "UNSUPPORTED_COMPRESSION"
  | "DUPLICATE_FILE"
  | "INVALID_TEXT"
  | "INVALID_SOURCE_TIMESTAMP"
  | "EMPTY_ARCHIVE";

export class GtfsArchiveError extends Error {
  constructor(
    readonly code: GtfsArchiveErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GtfsArchiveError";
  }
}

const DEFAULT_LIMITS: GtfsArchiveLimits = {
  maximumArchiveBytes: 32 * 1024 * 1024,
  maximumFiles: 128,
  maximumFileBytes: 256 * 1024 * 1024,
  maximumExpandedBytes: 512 * 1024 * 1024,
  timeoutMilliseconds: 30_000,
};

const ALLOWED_CONTENT_TYPES = new Set([
  "application/zip",
  "application/octet-stream",
  "application/x-zip-compressed",
]);

const MAXIMUM_PROVIDER_TRAILER_BYTES = 4 * 1024;

const ZIP = {
  centralFile: 0x02014b50,
  endOfCentralDirectory: 0x06054b50,
  localFile: 0x04034b50,
} as const;

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

type ZipEntry = {
  name: string;
  normalizedName: string | null;
  crc32: number;
  expandedSize: number;
};

function fail(code: GtfsArchiveErrorCode, message: string): never {
  throw new GtfsArchiveError(code, message);
}

function mergedLimits(overrides: Partial<GtfsArchiveLimits> | undefined) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new TypeError(`${name} must be a positive integer.`);
    }
  }
  return limits;
}

function contentLength(headers: Headers) {
  const value = headers.get("content-length");
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

async function readBoundedBytes(response: Response, maximumBytes: number) {
  const declaredLength = contentLength(response.headers);
  if (declaredLength !== null && declaredLength > maximumBytes) {
    fail("ARCHIVE_TOO_LARGE", "The schedule archive is larger than allowed.");
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maximumBytes) {
      fail("ARCHIVE_TOO_LARGE", "The schedule archive is larger than allowed.");
    }
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    total += item.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      fail("ARCHIVE_TOO_LARGE", "The schedule archive is larger than allowed.");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(
    0,
    view.byteLength - 65_557 - MAXIMUM_PROVIDER_TRAILER_BYTES,
  );
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) !== ZIP.endOfCentralDirectory) continue;
    const commentLength = view.getUint16(offset + 20, true);
    const trailingBytes = view.byteLength - (offset + 22 + commentLength);
    if (trailingBytes >= 0 && trailingBytes <= MAXIMUM_PROVIDER_TRAILER_BYTES) {
      return offset;
    }
  }
  fail("INVALID_ZIP", "The schedule archive is not a valid ZIP file.");
}

function safeEntryName(name: string) {
  if (
    name.includes("\0") ||
    name.includes("\\") ||
    name.startsWith("/") ||
    /^[a-zA-Z]:/.test(name) ||
    name.split("/").some((part) => part === ".." || part === ".")
  )
    fail("UNSAFE_ENTRY", "The schedule archive contains an unsafe path.");
}

function preflightZip(bytes: Uint8Array, limits: GtfsArchiveLimits) {
  if (bytes.byteLength < 22) {
    fail("INVALID_ZIP", "The schedule archive is not a valid ZIP file.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = findEndOfCentralDirectory(view);
  const disk = view.getUint16(end + 4, true);
  const centralDisk = view.getUint16(end + 6, true);
  const entriesOnDisk = view.getUint16(end + 8, true);
  const entryCount = view.getUint16(end + 10, true);
  const centralSize = view.getUint32(end + 12, true);
  const centralOffset = view.getUint32(end + 16, true);
  if (
    disk !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize !== end
  )
    fail("INVALID_ZIP", "The schedule archive uses an unsupported ZIP layout.");
  if (entryCount > limits.maximumFiles) {
    fail("TOO_MANY_FILES", "The schedule archive contains too many files.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const entries: ZipEntry[] = [];
  const normalizedNames = new Set<string>();
  let expandedBytes = 0;
  let cursor = centralOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > end || view.getUint32(cursor, true) !== ZIP.centralFile) {
      fail("INVALID_ZIP", "The schedule archive directory is malformed.");
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const crc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const expandedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (
      next > end ||
      compressedSize === 0xffffffff ||
      expandedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      fail("INVALID_ZIP", "The schedule archive directory is malformed.");
    }
    if ((flags & 1) !== 0 || (flags & 64) !== 0) {
      fail("ENCRYPTED_ENTRY", "Encrypted schedule files are not allowed.");
    }
    if (method !== 0 && method !== 8) {
      fail(
        "UNSUPPORTED_COMPRESSION",
        "The schedule archive uses unsupported compression.",
      );
    }

    let name: string;
    try {
      name = decoder.decode(
        bytes.subarray(cursor + 46, cursor + 46 + nameLength),
      );
    } catch {
      fail("UNSAFE_ENTRY", "The schedule archive contains an invalid path.");
    }
    safeEntryName(name);
    if (expandedSize > limits.maximumFileBytes) {
      fail("ENTRY_TOO_LARGE", "A schedule file is larger than allowed.");
    }
    expandedBytes += expandedSize;
    if (expandedBytes > limits.maximumExpandedBytes) {
      fail(
        "ARCHIVE_EXPANSION_TOO_LARGE",
        "The expanded schedule is larger than allowed.",
      );
    }

    if (
      localOffset + 30 > centralOffset ||
      view.getUint32(localOffset, true) !== ZIP.localFile
    ) {
      fail("INVALID_ZIP", "A schedule archive entry is malformed.");
    }
    const localFlags = view.getUint16(localOffset + 6, true);
    const localMethod = view.getUint16(localOffset + 8, true);
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const localDataEnd =
      localOffset + 30 + localNameLength + localExtraLength + compressedSize;
    if (
      localFlags !== flags ||
      localMethod !== method ||
      localDataEnd > centralOffset
    ) {
      fail("INVALID_ZIP", "A schedule archive entry is inconsistent.");
    }
    let localName: string;
    try {
      localName = decoder.decode(
        bytes.subarray(localOffset + 30, localOffset + 30 + localNameLength),
      );
    } catch {
      fail("UNSAFE_ENTRY", "The schedule archive contains an invalid path.");
    }
    if (localName !== name)
      fail("INVALID_ZIP", "A schedule archive path is inconsistent.");

    const basename = name.split("/").at(-1) ?? "";
    const normalizedName =
      !name.endsWith("/") && basename.toLowerCase().endsWith(".txt")
        ? basename.toLowerCase()
        : null;
    if (normalizedName) {
      if (normalizedNames.has(normalizedName)) {
        fail(
          "DUPLICATE_FILE",
          "The schedule archive contains duplicate file names.",
        );
      }
      normalizedNames.add(normalizedName);
    }
    entries.push({ name, normalizedName, crc32, expandedSize });
    cursor = next;
  }
  if (cursor !== end)
    fail("INVALID_ZIP", "The schedule archive directory is malformed.");
  if (normalizedNames.size === 0)
    fail("EMPTY_ARCHIVE", "The schedule archive has no GTFS text files.");
  return entries;
}

function crc32(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function extractTextFiles(bytes: Uint8Array, entries: ZipEntry[]) {
  const wanted = new Map(
    entries
      .filter((entry) => entry.normalizedName)
      .map((entry) => [entry.name, entry]),
  );
  let extracted: Record<string, Uint8Array>;
  try {
    extracted = unzipSync(bytes, { filter: (file) => wanted.has(file.name) });
  } catch {
    fail("INVALID_ZIP", "The schedule archive could not be expanded.");
  }

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const files: Array<[string, string]> = [];
  for (const [name, contents] of Object.entries(extracted)) {
    const entry = wanted.get(name);
    if (
      !entry ||
      !entry.normalizedName ||
      contents.byteLength !== entry.expandedSize ||
      crc32(contents) !== entry.crc32
    ) {
      fail(
        "INVALID_ZIP",
        "A schedule archive file failed its integrity check.",
      );
    }
    try {
      files.push([entry.normalizedName, decoder.decode(contents)]);
    } catch {
      fail("INVALID_TEXT", "A schedule file is not valid UTF-8 text.");
    }
  }
  if (files.length !== wanted.size) {
    fail("INVALID_ZIP", "The schedule archive is missing an expected file.");
  }
  return Object.fromEntries(
    files.sort(([left], [right]) => left.localeCompare(right)),
  );
}

export async function downloadMuniGtfsArchive(
  input: DownloadMuniGtfsArchiveInput,
): Promise<MuniGtfsArchive> {
  if (!input.apiToken.trim())
    fail("TOKEN_REQUIRED", "A 511 schedule token is required.");
  const limits = mergedLimits(input.limits);
  const url = new URL(MUNI_GTFS_ARCHIVE_SOURCE.url);
  url.searchParams.set("api_key", input.apiToken);
  url.searchParams.set("operator_id", MUNI_GTFS_ARCHIVE_SOURCE.operatorId);

  let response: Response;
  try {
    response = await (input.fetchImplementation ?? fetch)(url, {
      method: "GET",
      signal: AbortSignal.timeout(limits.timeoutMilliseconds),
    });
  } catch {
    fail("NETWORK_ERROR", "The schedule archive request failed.");
  }
  if (!response.ok)
    fail("HTTP_ERROR", "The schedule source rejected the request.");
  const contentType = (response.headers.get("content-type") ?? "")
    .split(";", 1)[0]!
    .trim()
    .toLowerCase();
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    fail(
      "INVALID_CONTENT_TYPE",
      "The schedule source did not return a ZIP archive.",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = await readBoundedBytes(response, limits.maximumArchiveBytes);
  } catch (error) {
    if (error instanceof GtfsArchiveError) throw error;
    fail("NETWORK_ERROR", "The schedule archive request failed.");
  }
  const entries = preflightZip(bytes, limits);
  const files = extractTextFiles(bytes, entries);
  const declaredLength = contentLength(response.headers);

  return {
    operatorId: MUNI_GTFS_ARCHIVE_SOURCE.operatorId,
    checkedAt: (input.now ?? (() => new Date()))().toISOString(),
    archiveByteLength: bytes.byteLength,
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    headers: {
      contentType: response.headers.get("content-type") ?? "",
      contentLength: declaredLength,
      etag: response.headers.get("etag"),
      lastModified: response.headers.get("last-modified"),
    },
    files,
  };
}
