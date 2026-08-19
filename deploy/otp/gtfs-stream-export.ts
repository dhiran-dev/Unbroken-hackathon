import { open, utimes, writeFile } from "node:fs/promises";
import { sql as applicationSql } from "../../src/server/db/client";
import type { GtfsCoverageSummary } from "../../src/domain/transit/gtfs-validation";
import type { GtfsExportProvenance } from "./gtfs-export";

const FILE_TIME = new Date("1980-01-01T00:00:00.000Z");
const SHA256 = /^[a-f0-9]{64}$/;
const COUNT_KEYS = [
  "stops",
  "routes",
  "trips",
  "stopTimes",
  "services",
  "shapePoints",
] as const;
export const GTFS_FILE_ORDER = [
  "agency.txt",
  "stops.txt",
  "routes.txt",
  "trips.txt",
  "stop_times.txt",
  "calendar.txt",
  "calendar_dates.txt",
  "shapes.txt",
] as const;

function csv(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll(`"`, `""`)}"` : text;
}
function line(values: readonly unknown[]) {
  return values.map(csv).join(",") + "\n";
}
function time(value: unknown) {
  if (value === null) return "";
  const seconds = Number(value);
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}
function date(value: unknown) {
  return value === null ? "" : String(value).replaceAll("-", "");
}
function parseCoverage(value: unknown): GtfsCoverageSummary {
  const candidate = value as Partial<GtfsCoverageSummary> | null;
  if (
    !candidate ||
    !candidate.counts ||
    typeof candidate.fingerprint !== "string" ||
    !SHA256.test(candidate.fingerprint) ||
    COUNT_KEYS.some(
      (key) =>
        !Number.isSafeInteger(candidate.counts?.[key]) ||
        (candidate.counts?.[key] ?? 0) <= 0,
    )
  )
    throw new Error("Invalid active coverage.");
  return candidate as GtfsCoverageSummary;
}

type CursorQuery = {
  cursor: (rows: number) => AsyncIterable<Array<Record<string, unknown>>>;
};
async function streamRows(
  path: string,
  headers: readonly string[],
  query: CursorQuery,
  map: (row: Record<string, unknown>) => readonly unknown[],
) {
  const file = await open(path, "wx", 0o600);
  let count = 0;
  try {
    await file.write(line(headers));
    for await (const batch of query.cursor(20_000)) {
      let chunk = "";
      for (const row of batch) {
        chunk += line(map(row));
        count += 1;
      }
      await file.write(chunk);
    }
  } finally {
    await file.close();
  }
  await utimes(path, FILE_TIME, FILE_TIME);
  return count;
}

export class PostgresStreamingGtfsExporter {
  constructor(private readonly database = applicationSql) {}
  async activeIdentity() {
    const rows = await this.database<
      { id: string; feed_hash: string; coverage: unknown }[]
    >`select id, feed_hash, coverage from transit_feed_snapshots where status = 'active' order by accepted_at desc nulls last limit 1`;
    const active = rows[0];
    if (!active || !SHA256.test(active.feed_hash))
      throw new Error("No trusted active feed.");
    const value = parseCoverage(active.coverage);
    return {
      snapshotId: active.id,
      activeArchiveSha256: active.feed_hash,
      coverageFingerprint: value.fingerprint,
      counts: value.counts,
    };
  }
  async exportFiles(
    directory: string,
  ): Promise<
    Omit<
      GtfsExportProvenance,
      "generatedArchiveBytes" | "generatedArchiveSha256"
    >
  > {
    return this.database.begin(
      "isolation level repeatable read read only",
      async (transaction) => {
        const records = await transaction<
          { id: string; feed_hash: string; coverage: unknown }[]
        >`select id, feed_hash, coverage from transit_feed_snapshots where status = 'active' order by accepted_at desc nulls last limit 1`;
        const active = records[0];
        if (!active || !SHA256.test(active.feed_hash))
          throw new Error("No trusted active feed.");
        const expected = parseCoverage(active.coverage);
        const id = active.id;
        await writeFile(
          `${directory}/agency.txt`,
          line(["agency_id", "agency_name", "agency_url", "agency_timezone"]) +
            line([
              "SF",
              "San Francisco Municipal Transportation Agency",
              "https://www.sfmta.com",
              "America/Los_Angeles",
            ]),
          { mode: 0o600 },
        );
        await utimes(`${directory}/agency.txt`, FILE_TIME, FILE_TIME);
        const counts = {
          stops: await streamRows(
            `${directory}/stops.txt`,
            [
              "stop_id",
              "stop_code",
              "stop_name",
              "stop_desc",
              "stop_lat",
              "stop_lon",
              "location_type",
              "parent_station",
              "wheelchair_boarding",
              "platform_code",
              "zone_id",
            ],
            transaction`select stop_id, stop_code, stop_name, stop_description, latitude, longitude, location_type, parent_station_id, wheelchair_boarding, platform_code, zone_id from transit_stops where snapshot_id = ${id} order by stop_id collate "C"`,
            (r) => [
              r.stop_id,
              r.stop_code,
              r.stop_name,
              r.stop_description,
              r.latitude,
              r.longitude,
              r.location_type,
              r.parent_station_id,
              r.wheelchair_boarding,
              r.platform_code,
              r.zone_id,
            ],
          ),
          routes: await streamRows(
            `${directory}/routes.txt`,
            [
              "route_id",
              "agency_id",
              "route_short_name",
              "route_long_name",
              "route_desc",
              "route_type",
              "route_url",
              "route_color",
              "route_text_color",
              "route_sort_order",
            ],
            transaction`select route_id, agency_id, short_name, long_name, description, route_type, url, color, text_color, sort_order from transit_routes where snapshot_id = ${id} order by route_id collate "C"`,
            (r) => [
              r.route_id,
              r.agency_id,
              r.short_name,
              r.long_name,
              r.description,
              r.route_type,
              r.url,
              r.color,
              r.text_color,
              r.sort_order,
            ],
          ),
          trips: await streamRows(
            `${directory}/trips.txt`,
            [
              "route_id",
              "service_id",
              "trip_id",
              "trip_headsign",
              "trip_short_name",
              "direction_id",
              "block_id",
              "shape_id",
              "wheelchair_accessible",
              "bikes_allowed",
            ],
            transaction`select route_id, service_id, trip_id, headsign, short_name, direction_id, block_id, shape_id, wheelchair_accessible, bikes_allowed from transit_trips where snapshot_id = ${id} order by trip_id collate "C"`,
            (r) => [
              r.route_id,
              r.service_id,
              r.trip_id,
              r.headsign,
              r.short_name,
              r.direction_id,
              r.block_id,
              r.shape_id,
              r.wheelchair_accessible,
              r.bikes_allowed,
            ],
          ),
          stopTimes: await streamRows(
            `${directory}/stop_times.txt`,
            [
              "trip_id",
              "arrival_time",
              "departure_time",
              "stop_id",
              "stop_sequence",
              "stop_headsign",
              "pickup_type",
              "drop_off_type",
              "shape_dist_traveled",
              "timepoint",
            ],
            transaction`select trip_id, arrival_seconds, departure_seconds, stop_id, stop_sequence, stop_headsign, pickup_type, drop_off_type, shape_distance_traveled, timepoint from transit_stop_times where snapshot_id = ${id} order by trip_id collate "C", stop_sequence`,
            (r) => [
              r.trip_id,
              time(r.arrival_seconds),
              time(r.departure_seconds),
              r.stop_id,
              r.stop_sequence,
              r.stop_headsign,
              r.pickup_type,
              r.drop_off_type,
              r.shape_distance_traveled,
              r.timepoint,
            ],
          ),
          services: 0,
          shapePoints: await streamRows(
            `${directory}/shapes.txt`,
            [
              "shape_id",
              "shape_pt_lat",
              "shape_pt_lon",
              "shape_pt_sequence",
              "shape_dist_traveled",
            ],
            transaction`select shape_id, latitude, longitude, sequence, distance_traveled from transit_shapes where snapshot_id = ${id} order by shape_id collate "C", sequence`,
            (r) => [
              r.shape_id,
              r.latitude,
              r.longitude,
              r.sequence,
              r.distance_traveled,
            ],
          ),
        };
        const services = await transaction<
          Record<string, unknown>[]
        >`select service_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday, starts_on, ends_on, exceptions from transit_services where snapshot_id = ${id} order by service_id collate "C"`;
        counts.services = services.length;
        const calendar = await open(`${directory}/calendar.txt`, "wx", 0o600);
        const calendarDates = await open(
          `${directory}/calendar_dates.txt`,
          "wx",
          0o600,
        );
        try {
          await calendar.write(
            line([
              "service_id",
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
              "start_date",
              "end_date",
            ]),
          );
          await calendarDates.write(
            line(["service_id", "date", "exception_type"]),
          );
          for (const row of services) {
            if (row.starts_on !== null && row.ends_on !== null)
              await calendar.write(
                line([
                  row.service_id,
                  Number(row.monday),
                  Number(row.tuesday),
                  Number(row.wednesday),
                  Number(row.thursday),
                  Number(row.friday),
                  Number(row.saturday),
                  Number(row.sunday),
                  date(row.starts_on),
                  date(row.ends_on),
                ]),
              );
            if (!Array.isArray(row.exceptions))
              throw new Error("Invalid active service exceptions.");
            for (const exception of row.exceptions) {
              if (
                !exception ||
                typeof exception !== "object" ||
                !("type" in exception) ||
                !("date" in exception) ||
                (exception.type !== "added" && exception.type !== "removed")
              )
                throw new Error("Invalid active service exception.");
              await calendarDates.write(
                line([
                  row.service_id,
                  date(exception.date),
                  exception.type === "added" ? 1 : 2,
                ]),
              );
            }
          }
        } finally {
          await Promise.all([calendar.close(), calendarDates.close()]);
        }
        await Promise.all([
          utimes(`${directory}/calendar.txt`, FILE_TIME, FILE_TIME),
          utimes(`${directory}/calendar_dates.txt`, FILE_TIME, FILE_TIME),
        ]);
        if (COUNT_KEYS.some((key) => counts[key] !== expected.counts[key]))
          throw new Error("Active coverage does not match persisted rows.");
        return {
          snapshotId: active.id,
          activeArchiveSha256: active.feed_hash,
          coverageFingerprint: expected.fingerprint,
          counts,
        };
      },
    );
  }
}
