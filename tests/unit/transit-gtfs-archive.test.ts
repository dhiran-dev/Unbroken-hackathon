import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import {
  downloadMuniGtfsArchive,
  GtfsArchiveError,
  MUNI_GTFS_ARCHIVE_SOURCE,
  type FetchImplementation,
} from "@/server/transit/gtfs-archive";

function archive(entries: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(
      Object.entries(entries).map(([name, text]) => [name, strToU8(text)]),
    ),
  );
}

function response(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return new Response(Uint8Array.from(bytes).buffer, {
    headers: { "content-type": "application/zip", ...headers },
  });
}

async function rejectedCode(
  fetchImplementation: FetchImplementation,
  code: GtfsArchiveError["code"],
) {
  const promise = downloadMuniGtfsArchive({
    apiToken: "private-token",
    fetchImplementation,
  });
  await expect(promise).rejects.toMatchObject({
    name: "GtfsArchiveError",
    code,
  });
  await expect(promise).rejects.not.toThrow(/private-token|api_key/i);
}

describe("official Muni schedule archive", () => {
  it("downloads the fixed SF feed and returns provenance with validator-ready text files", async () => {
    const bytes = archive({
      "feed/AGENCY.TXT": "agency_id,agency_name\nSF,Muni",
      "feed/stops.txt": "stop_id,stop_name\n1,Market St",
      "feed/readme.md": "not part of GTFS",
    });
    const fetchImplementation = vi.fn<FetchImplementation>(async () =>
      response(bytes, {
        "content-length": String(bytes.byteLength),
        etag: '"feed-v1"',
        "last-modified": "Wed, 19 Aug 2026 12:00:00 GMT",
      }),
    );

    const result = await downloadMuniGtfsArchive({
      apiToken: "private-token",
      fetchImplementation,
      now: () => new Date("2026-08-19T12:01:02.000Z"),
    });

    const requestedUrl = new URL(
      String(fetchImplementation.mock.calls[0]?.[0]),
    );
    expect(`${requestedUrl.origin}${requestedUrl.pathname}`).toBe(
      MUNI_GTFS_ARCHIVE_SOURCE.url,
    );
    expect(requestedUrl.searchParams.get("operator_id")).toBe("SF");
    expect(requestedUrl.searchParams.get("api_key")).toBe("private-token");
    expect(result).toEqual({
      operatorId: "SF",
      checkedAt: "2026-08-19T12:01:02.000Z",
      archiveByteLength: bytes.byteLength,
      archiveSha256: createHash("sha256").update(bytes).digest("hex"),
      headers: {
        contentType: "application/zip",
        contentLength: bytes.byteLength,
        etag: '"feed-v1"',
        lastModified: "Wed, 19 Aug 2026 12:00:00 GMT",
      },
      files: {
        "agency.txt": "agency_id,agency_name\nSF,Muni",
        "stops.txt": "stop_id,stop_name\n1,Market St",
      },
    });
  });

  it("requires a nonblank token before making a request", async () => {
    const fetchImplementation = vi.fn<FetchImplementation>();
    await expect(
      downloadMuniGtfsArchive({ apiToken: "   ", fetchImplementation }),
    ).rejects.toMatchObject({ code: "TOKEN_REQUIRED" });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("rejects unsuccessful and non-ZIP responses with safe errors", async () => {
    await rejectedCode(
      vi.fn(async () => new Response("denied", { status: 403 })),
      "HTTP_ERROR",
    );
    await rejectedCode(
      vi.fn(
        async () =>
          new Response("html", { headers: { "content-type": "text/html" } }),
      ),
      "INVALID_CONTENT_TYPE",
    );
  });

  it("rejects declared and streamed archive bytes above the limit", async () => {
    const bytes = archive({ "stops.txt": "x" });
    await rejectedCode(
      vi.fn(async () => response(bytes, { "content-length": "999999999" })),
      "ARCHIVE_TOO_LARGE",
    );
    await expect(
      downloadMuniGtfsArchive({
        apiToken: "private-token",
        fetchImplementation: vi.fn(async () => response(bytes)),
        limits: { maximumArchiveBytes: bytes.byteLength - 1 },
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_TOO_LARGE" });
  });

  it("rejects unsafe and duplicate normalized text paths", async () => {
    await rejectedCode(
      vi.fn(async () => response(archive({ "../stops.txt": "x" }))),
      "UNSAFE_ENTRY",
    );
    await rejectedCode(
      vi.fn(async () =>
        response(archive({ "a/stops.txt": "x", "b/STOPS.TXT": "y" })),
      ),
      "DUPLICATE_FILE",
    );
  });

  it("rejects encrypted entries before extraction", async () => {
    const bytes = archive({ "stops.txt": "x" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = bytes.findIndex(
      (_, index) =>
        index + 4 <= bytes.length && view.getUint32(index, true) === 0x02014b50,
    );
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 1, true);
    await rejectedCode(
      vi.fn(async () => response(bytes)),
      "ENCRYPTED_ENTRY",
    );
  });

  it("rejects per-file expansion and malformed archives", async () => {
    const bytes = archive({ "stops.txt": "a large text file" });
    await expect(
      downloadMuniGtfsArchive({
        apiToken: "private-token",
        fetchImplementation: vi.fn(async () => response(bytes)),
        limits: { maximumFileBytes: 2 },
      }),
    ).rejects.toMatchObject({ code: "ENTRY_TOO_LARGE" });
    await rejectedCode(
      vi.fn(async () => response(strToU8("not a zip"))),
      "INVALID_ZIP",
    );
  });

  it("rejects archives without GTFS text files", async () => {
    await rejectedCode(
      vi.fn(async () => response(archive({ "readme.md": "hello" }))),
      "EMPTY_ARCHIVE",
    );
  });

  it("accepts the official source's small bounded trailer after the ZIP end record", async () => {
    const zipped = archive({ "stops.txt": "stop_id,stop_name\n1,Market" });
    const trailer = strToU8("provider trailer");
    const bytes = new Uint8Array(zipped.byteLength + trailer.byteLength);
    bytes.set(zipped);
    bytes.set(trailer, zipped.byteLength);

    const result = await downloadMuniGtfsArchive({
      apiToken: "private-token",
      fetchImplementation: vi.fn(async () => response(bytes)),
    });

    expect(result.files["stops.txt"]).toBe("stop_id,stop_name\n1,Market");
    expect(result.archiveByteLength).toBe(bytes.byteLength);
  });

  it("rejects a ZIP whose expanded bytes disagree with its directory", async () => {
    const bytes = archive({ "stops.txt": "stop_id,stop_name\n1,Market" });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const central = bytes.findIndex(
      (_, index) =>
        index + 4 <= bytes.length && view.getUint32(index, true) === 0x02014b50,
    );
    view.setUint32(central + 24, view.getUint32(central + 24, true) + 1, true);

    await rejectedCode(
      vi.fn(async () => response(bytes)),
      "INVALID_ZIP",
    );
  });
});
