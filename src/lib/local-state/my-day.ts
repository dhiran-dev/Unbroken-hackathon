/**
 * My Day: a per-date list of caffeine entries persisted in IndexedDB
 * (database `pulserank`, object store `my-day`, keyPath `id`, secondary index
 * `date`). Entries are grouped by `YYYY-MM-DD` date strings.
 *
 * Every function is SSR-safe: on the server reads resolve to empty results and
 * writes are no-ops. Invalid input throws `TypeError` (programmer error),
 * never at import time.
 */

import {
  MY_DAY_DATE_INDEX,
  MY_DAY_STORE,
  requestToPromise,
  transactionToPromise,
  withDatabase,
} from "./db";

export interface MyDayEntry {
  slug: string;
  name: string;
  /** Display label for when the item was/will be consumed (e.g. `"07:30"`). */
  timeLabel: string;
  /** Caffeine amount in milligrams. */
  caffeineMg: number;
}

/** Stored shape: an entry plus its date group, unique id, and creation time. */
export interface MyDayRecord extends MyDayEntry {
  id: string;
  /** Grouping key, formatted `YYYY-MM-DD`. */
  date: string;
  createdAt: number;
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Canonical My Day date semantics: records are grouped by UTC calendar day. */
export function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Canonical My Day time semantics: labels are positioned on the UTC clock. */
export function utcTimeLabel(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** True when the value is a real calendar date formatted `YYYY-MM-DD`. */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parts = value.split("-");
  const year = Number.parseInt(parts[0] ?? "", 10);
  const month = Number.parseInt(parts[1] ?? "", 10);
  const day = Number.parseInt(parts[2] ?? "", 10);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  // Rejects impossible dates like 2026-02-31 via UTC round-trip.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Generates a unique id for a My Day record. */
export function createMyDayId(): string {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef && typeof cryptoRef.randomUUID === "function") {
    return cryptoRef.randomUUID();
  }
  return `myday-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Coerces an unknown value into a {@link MyDayEntry}, or `null` when invalid. */
export function sanitizeMyDayEntry(value: unknown): MyDayEntry | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  const slug = record["slug"];
  const name = record["name"];
  const timeLabel = record["timeLabel"];
  const caffeineMg = record["caffeineMg"];
  if (
    !isNonEmptyString(slug) ||
    !isNonEmptyString(name) ||
    !isNonEmptyString(timeLabel) ||
    !isFiniteNumber(caffeineMg) ||
    caffeineMg < 0
  ) {
    return null;
  }
  return { slug, name, timeLabel, caffeineMg };
}

/** Coerces an unknown stored/imported record into a {@link MyDayRecord}. */
export function sanitizeMyDayRecord(value: unknown): MyDayRecord | null {
  const entry = sanitizeMyDayEntry(value);
  if (!entry) return null;
  const record = value as Record<string, unknown>;
  const id = record["id"];
  const date = record["date"];
  const createdAt = record["createdAt"];
  if (!isNonEmptyString(id) || !isDateString(date)) return null;
  return {
    ...entry,
    id,
    date,
    createdAt: isFiniteNumber(createdAt) ? createdAt : Date.now(),
  };
}

/** Builds a stored record; throws `TypeError` on an invalid date or entry. */
export function createMyDayRecord(
  date: string,
  entry: MyDayEntry,
  createdAt: number = Date.now(),
): MyDayRecord {
  if (!isDateString(date)) {
    throw new TypeError(`Invalid My Day date (expected YYYY-MM-DD): ${String(date)}`);
  }
  if (sanitizeMyDayEntry(entry) === null) {
    throw new TypeError("Invalid My Day entry: slug, name, timeLabel and a "
      + "non-negative caffeineMg are required");
  }
  return { ...entry, id: createMyDayId(), date, createdAt };
}

/** Orders records within a day by `timeLabel`, then insertion time. */
export function compareMyDayRecords(a: MyDayRecord, b: MyDayRecord): number {
  if (a.timeLabel !== b.timeLabel) return a.timeLabel < b.timeLabel ? -1 : 1;
  return a.createdAt - b.createdAt;
}

/** Pure sort (does not mutate input): timeLabel asc, then createdAt asc. */
export function sortMyDayRecords(records: readonly MyDayRecord[]): MyDayRecord[] {
  return [...records].sort(compareMyDayRecords);
}

/**
 * Pure grouping: records grouped by date, date keys sorted ascending, entries
 * within each day ordered by {@link compareMyDayRecords}. Strips storage-only
 * fields from the values.
 */
export function groupMyDayRecords(
  records: readonly MyDayRecord[],
): Record<string, MyDayEntry[]> {
  const buckets = new Map<string, MyDayEntry[]>();
  for (const record of sortMyDayRecords(records)) {
    const bucket = buckets.get(record.date);
    const entry: MyDayEntry = {
      slug: record.slug,
      name: record.name,
      timeLabel: record.timeLabel,
      caffeineMg: record.caffeineMg,
    };
    if (bucket) bucket.push(entry);
    else buckets.set(record.date, [entry]);
  }
  const grouped: Record<string, MyDayEntry[]> = {};
  for (const date of Array.from(buckets.keys()).sort()) {
    grouped[date] = buckets.get(date) ?? [];
  }
  return grouped;
}

function assertValidDate(date: string): void {
  if (!isDateString(date)) {
    throw new TypeError(`Invalid My Day date (expected YYYY-MM-DD): ${String(date)}`);
  }
}

/** Adds an entry under a date group. Returns the stored record, or `null` on the server. */
export async function addMyDayEntry(
  date: string,
  entry: MyDayEntry,
): Promise<MyDayRecord | null> {
  const record = createMyDayRecord(date, entry);
  const db = await withDatabase();
  if (!db) return null;
  const tx = db.transaction(MY_DAY_STORE, "readwrite");
  tx.objectStore(MY_DAY_STORE).put(record);
  await transactionToPromise(tx);
  return record;
}

/** Removes one entry by id. Returns true only when a record was deleted. */
export async function removeMyDayEntry(id: string): Promise<boolean> {
  const db = await withDatabase();
  if (!db) return false;
  const tx = db.transaction(MY_DAY_STORE, "readwrite");
  const store = tx.objectStore(MY_DAY_STORE);
  const existing = await requestToPromise(store.getKey(id));
  if (existing === undefined) return false;
  store.delete(id);
  await transactionToPromise(tx);
  return true;
}

/** Lists the raw records for one date (ordered within the day). Empty on the server. */
export async function listMyDayRecordsForDate(date: string): Promise<MyDayRecord[]> {
  assertValidDate(date);
  const db = await withDatabase();
  if (!db) return [];
  const tx = db.transaction(MY_DAY_STORE, "readonly");
  const index = tx.objectStore(MY_DAY_STORE).index(MY_DAY_DATE_INDEX);
  const records = (await requestToPromise(
    index.getAll(IDBKeyRange.only(date)),
  )) as unknown[];
  return sortMyDayRecords(
    records
      .map((record) => sanitizeMyDayRecord(record))
      .filter((record): record is MyDayRecord => record !== null),
  );
}

/** Lists every stored record across all dates. Empty on the server. */
export async function listMyDayRecords(): Promise<MyDayRecord[]> {
  const db = await withDatabase();
  if (!db) return [];
  const tx = db.transaction(MY_DAY_STORE, "readonly");
  const records = (await requestToPromise(
    tx.objectStore(MY_DAY_STORE).getAll(),
  )) as unknown[];
  return sortMyDayRecords(
    records
      .map((record) => sanitizeMyDayRecord(record))
      .filter((record): record is MyDayRecord => record !== null),
  );
}

/** Entries for one date, ordered within the day. Empty on the server. */
export async function listMyDayEntries(date: string): Promise<MyDayEntry[]> {
  return (await listMyDayRecordsForDate(date)).map((record) => ({
    slug: record.slug,
    name: record.name,
    timeLabel: record.timeLabel,
    caffeineMg: record.caffeineMg,
  }));
}

/** All dates that have at least one entry, ascending. Empty on the server. */
export async function listMyDayDates(): Promise<string[]> {
  const records = await listMyDayRecords();
  return Array.from(new Set(records.map((record) => record.date))).sort();
}

/** Every entry grouped by date ({@link groupMyDayRecords}). Empty on the server. */
export async function listMyDayGrouped(): Promise<Record<string, MyDayEntry[]>> {
  return groupMyDayRecords(await listMyDayRecords());
}

/**
 * Clears stored entries: one date when `date` is given, everything otherwise.
 * No-op on the server.
 */
export async function clearMyDay(date?: string): Promise<void> {
  const db = await withDatabase();
  if (!db) return;
  const tx = db.transaction(MY_DAY_STORE, "readwrite");
  const store = tx.objectStore(MY_DAY_STORE);
  if (date === undefined) {
    store.clear();
  } else {
    assertValidDate(date);
    const index = store.index(MY_DAY_DATE_INDEX);
    const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(date)));
    for (const key of keys) store.delete(key);
  }
  await transactionToPromise(tx);
}
