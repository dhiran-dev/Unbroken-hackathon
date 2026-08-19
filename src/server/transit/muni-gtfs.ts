import { createHash } from "node:crypto";

import type { GtfsValidationPolicy } from "@/domain/transit/gtfs-validation";
import {
  downloadMuniGtfsArchive,
  MUNI_GTFS_ARCHIVE_SOURCE,
  type DownloadMuniGtfsArchiveInput,
  GtfsArchiveError,
} from "@/server/transit/gtfs-archive";
import type { GtfsArchiveLoader } from "@/server/transit/gtfs-refresh";

export const MUNI_GTFS_VALIDATION_POLICY: GtfsValidationPolicy = {
  minimumCounts: {
    stops: 2_500,
    routes: 50,
    trips: 40_000,
    stopTimes: 1_500_000,
    services: 1,
    shapePoints: 35_000,
  },
  minimumRetentionRatio: 0.8,
  coordinateBounds: {
    minimumLatitude: 37.6,
    maximumLatitude: 37.95,
    minimumLongitude: -122.65,
    maximumLongitude: -122.25,
  },
  maximumServiceHour: 47,
};

function safeSourceUrl() {
  const url = new URL(MUNI_GTFS_ARCHIVE_SOURCE.url);
  url.searchParams.set("operator_id", MUNI_GTFS_ARCHIVE_SOURCE.operatorId);
  return url.toString();
}

function sourceDate(value: string | null) {
  if (!value) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new GtfsArchiveError(
      "INVALID_SOURCE_TIMESTAMP",
      "The schedule source supplied an invalid update time.",
    );
  }
  return new Date(milliseconds);
}

export function createMuniGtfsArchiveLoader(
  input: DownloadMuniGtfsArchiveInput,
): GtfsArchiveLoader {
  return {
    async load() {
      const downloaded = await downloadMuniGtfsArchive(input);
      const manifest = Object.fromEntries(
        Object.entries(downloaded.files).map(([name, text]) => {
          const bytes = new TextEncoder().encode(text);
          return [
            name,
            {
              bytes: bytes.byteLength,
              sha256: createHash("sha256").update(bytes).digest("hex"),
            },
          ];
        }),
      );
      return {
        files: downloaded.files,
        feedHash: downloaded.archiveSha256,
        checkedAt: new Date(downloaded.checkedAt),
        sourceUpdatedAt: sourceDate(downloaded.headers.lastModified),
        sourceUrl: safeSourceUrl(),
        etag: downloaded.headers.etag,
        lastModified: downloaded.headers.lastModified,
        manifest,
      };
    },
  };
}
