import type { MyDayRecord } from "@/lib/local-state/my-day";

export type LocalStoreStatus = "available" | "unavailable" | "error";

export type TimelinePoint = {
  minute: number;
  totalMg: number;
  record?: MyDayRecord;
};

export type DayTimeline = {
  points: TimelinePoint[];
  maxMg: number;
  latest?: MyDayRecord;
};

/** Sum only the entries that are actually stored for the selected date. */
export function sumMyDayCaffeine(records: readonly MyDayRecord[]): number {
  return records.reduce((total, record) => total + record.caffeineMg, 0);
}

/**
 * Parses the display formats currently accepted by the My Day UI. Unknown
 * labels stay unknown so a chart never invents a position for an entry.
 */
export function parseTimeLabel(value: string): number | null {
  const label = value.trim();
  const twentyFourHour = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(label);
  if (twentyFourHour) {
    return Number(twentyFourHour[1]) * 60 + Number(twentyFourHour[2]);
  }

  const twelveHour = /^(\d{1,2})(?::([0-5]\d))?\s*([ap])m$/i.exec(label);
  if (!twelveHour) return null;
  const hour = Number(twelveHour[1]);
  if (hour < 1 || hour > 12) return null;
  const minute = Number(twelveHour[2] ?? "0");
  const isPm = twelveHour[3]?.toLowerCase() === "p";
  return ((hour % 12) + (isPm ? 12 : 0)) * 60 + minute;
}

/**
 * Builds a cumulative timeline from stored entries. Entries whose time label
 * cannot be parsed remain available in the list but are intentionally omitted
 * from the plot rather than assigned a made-up x coordinate.
 */
export function buildDayTimeline(records: readonly MyDayRecord[]): DayTimeline {
  const timed = records
    .map((record) => ({ record, minute: parseTimeLabel(record.timeLabel) }))
    .filter((item): item is { record: MyDayRecord; minute: number } => item.minute !== null)
    .sort((a, b) => a.minute - b.minute || a.record.createdAt - b.record.createdAt);

  let totalMg = 0;
  const points: TimelinePoint[] = [{ minute: 0, totalMg: 0 }];
  for (const item of timed) {
    totalMg += item.record.caffeineMg;
    points.push({ minute: item.minute, totalMg, record: item.record });
  }

  return {
    points,
    maxMg: Math.max(totalMg, 0),
    latest: timed.at(-1)?.record,
  };
}

/** Returns the next parseable entry after the supplied minute, if any. */
export function nextMyDayRecord(
  records: readonly MyDayRecord[],
  currentMinute: number,
): MyDayRecord | null {
  const candidates = records
    .map((record) => ({ record, minute: parseTimeLabel(record.timeLabel) }))
    .filter((item): item is { record: MyDayRecord; minute: number } => item.minute !== null)
    .filter((item) => item.minute > currentMinute)
    .sort((a, b) => a.minute - b.minute || a.record.createdAt - b.record.createdAt);
  return candidates[0]?.record ?? null;
}

export function currentMinute(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Formats a local-store count without turning a failed read into a false zero.
 * A store can be healthy while an individual read fails, so the caller passes
 * that per-store issue separately from the storage health status.
 */
export function localStoreCountText(
  count: number,
  status: LocalStoreStatus,
  readFailed: boolean,
  suffix: string,
): string {
  if (status === "error" || readFailed) return "Error";
  if (status === "unavailable") return "Unavailable";
  return `${count} ${suffix}`;
}

/** Summarizes both browser stores without implying persistence when either is unavailable. */
export function storageBadgeText(
  localStorageStatus: LocalStoreStatus,
  indexedDbStatus: LocalStoreStatus,
): "Stored locally" | "Storage unavailable" | "Storage error" {
  if (localStorageStatus === "error" || indexedDbStatus === "error") return "Storage error";
  if (localStorageStatus === "available" && indexedDbStatus === "available") return "Stored locally";
  return "Storage unavailable";
}

/** Current minute in the UTC day used by the browser-local My Day date key. */
export function utcMinute(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}
