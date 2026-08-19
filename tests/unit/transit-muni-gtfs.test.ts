import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { FetchImplementation } from "@/server/transit/gtfs-archive";
import { createMuniGtfsArchiveLoader } from "@/server/transit/muni-gtfs";

describe("Muni GTFS refresh adapter", () => {
  it("keeps the token out of stored provenance and hashes each normalized text file", async () => {
    const text = "stop_id,stop_name\n1,Market";
    const bytes = zipSync({ "feed/stops.txt": strToU8(text) });
    const fetchImplementation = vi.fn<FetchImplementation>(
      async () =>
        new Response(Uint8Array.from(bytes).buffer, {
          headers: {
            "content-type": "application/zip",
            "last-modified": "Wed, 19 Aug 2026 12:00:00 GMT",
            etag: '"feed-v1"',
          },
        }),
    );

    const result = await createMuniGtfsArchiveLoader({
      apiToken: "private-token",
      fetchImplementation,
      now: () => new Date("2026-08-19T12:01:02.000Z"),
    }).load();

    expect(result).toMatchObject({
      feedHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      checkedAt: new Date("2026-08-19T12:01:02.000Z"),
      sourceUpdatedAt: new Date("2026-08-19T12:00:00.000Z"),
      etag: '"feed-v1"',
      manifest: {
        "stops.txt": {
          bytes: new TextEncoder().encode(text).byteLength,
          sha256: createHash("sha256")
            .update(new TextEncoder().encode(text))
            .digest("hex"),
        },
      },
    });
    expect(result.sourceUrl).toContain("operator_id=SF");
    expect(result.sourceUrl).not.toMatch(/private-token|api_key/i);
    expect(result).not.toHaveProperty("archiveBytes");
  });

  it("rejects a malformed official update timestamp", async () => {
    const bytes = zipSync({
      "feed/stops.txt": strToU8("stop_id,stop_name\n1,Market"),
    });
    const loader = createMuniGtfsArchiveLoader({
      apiToken: "private-token",
      fetchImplementation: vi.fn(
        async () =>
          new Response(Uint8Array.from(bytes).buffer, {
            headers: {
              "content-type": "application/zip",
              "last-modified": "not-a-date",
            },
          }),
      ),
    });

    await expect(loader.load()).rejects.toMatchObject({
      name: "GtfsArchiveError",
      code: "INVALID_SOURCE_TIMESTAMP",
    });
  });
});
