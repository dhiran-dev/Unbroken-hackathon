import {
  MAX_ACTIVE_STOP_COUNT,
  STOP_MAP_UNAVAILABLE_MESSAGE,
  isStopMapFeedHash,
} from "@/domain/transit/stop-map";
import { getTransitCatalog } from "@/server/transit/catalog";

import { LazyCitywideStopMap } from "./lazy-citywide-stop-map";

const coverageCountKeys = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;
const safeSnapshotId = /^[^\s<>\u0000-\u001f\u007f]{1,160}$/u;

export type CitywideStopMapShellProps = {
  className?: string;
  height?: number | string;
};

function hasUsableCoverage(value: unknown): value is {
  available: true;
  feedHash: string;
} {
  if (!value || typeof value !== "object") return false;
  const coverage = value as {
    available?: unknown;
    snapshotId?: unknown;
    feedHash?: unknown;
    counts?: unknown;
  };
  if (
    coverage.available !== true ||
    typeof coverage.snapshotId !== "string" ||
    !safeSnapshotId.test(coverage.snapshotId) ||
    typeof coverage.feedHash !== "string" ||
    !isStopMapFeedHash(coverage.feedHash) ||
    !coverage.counts ||
    typeof coverage.counts !== "object"
  ) {
    return false;
  }
  const counts = coverage.counts as Record<string, unknown>;
  return (
    coverageCountKeys.every((key) => {
      const count = counts[key];
      return Number.isSafeInteger(count) && Number(count) >= 0;
    }) &&
    Number(counts.stops) > 0 &&
    Number(counts.stops) <= MAX_ACTIVE_STOP_COUNT
  );
}

function unavailable() {
  return (
    <p aria-live="polite" role="status">
      {STOP_MAP_UNAVAILABLE_MESSAGE}
    </p>
  );
}

export async function CitywideStopMapShell({
  className,
  height,
}: CitywideStopMapShellProps) {
  let coverage: unknown;
  try {
    coverage = await getTransitCatalog().getCoverage();
  } catch {
    return unavailable();
  }
  if (!hasUsableCoverage(coverage)) return unavailable();

  return (
    <LazyCitywideStopMap
      className={className}
      feedHash={coverage.feedHash}
      height={height}
    />
  );
}

export default CitywideStopMapShell;
