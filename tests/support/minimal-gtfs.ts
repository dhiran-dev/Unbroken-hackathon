import type { GtfsValidationPolicy } from "@/domain/transit/gtfs-validation";

export const minimalGtfsPolicy: GtfsValidationPolicy = {
  minimumCounts: {
    stops: 2,
    routes: 1,
    trips: 1,
    stopTimes: 2,
    services: 1,
    shapePoints: 2,
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

export function minimalGtfsFeed(options?: {
  startsOn?: string;
  endsOn?: string;
}): Record<string, string> {
  return {
    "agency.txt": [
      "agency_id,agency_name,agency_url,agency_timezone",
      "SF,Muni,https://www.sfmta.com,America/Los_Angeles",
    ].join("\n"),
    "stops.txt": [
      "stop_id,stop_name,stop_lat,stop_lon",
      "STOP-A,Market at 5th,37.7834,-122.4071",
      "STOP-B,Embarcadero,37.7929,-122.3969",
    ].join("\n"),
    "routes.txt": [
      "route_id,agency_id,route_short_name,route_long_name,route_type",
      "ROUTE-N,SF,N,Judah,0",
    ].join("\n"),
    "trips.txt": [
      "route_id,service_id,trip_id,shape_id",
      "ROUTE-N,WEEKDAY,TRIP-1,SHAPE-N",
    ].join("\n"),
    "stop_times.txt": [
      "trip_id,arrival_time,departure_time,stop_id,stop_sequence",
      "TRIP-1,08:00:00,08:00:00,STOP-A,1",
      "TRIP-1,08:10:00,08:10:00,STOP-B,2",
    ].join("\n"),
    "calendar.txt": [
      "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date",
      `WEEKDAY,1,1,1,1,1,0,0,${options?.startsOn ?? "20260801"},${options?.endsOn ?? "20260831"}`,
    ].join("\n"),
    "calendar_dates.txt": "service_id,date,exception_type",
    "shapes.txt": [
      "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence",
      "SHAPE-N,37.7834,-122.4071,1",
      "SHAPE-N,37.7929,-122.3969,2",
    ].join("\n"),
  };
}
