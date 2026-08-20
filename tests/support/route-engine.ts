import type {
  OtpPlanPort,
  OtpPlanPortRequest,
} from "../../src/server/journey/route-engine";

export const routeRequest = {
  origin: {
    label: "24th Street and Mission",
    latitude: 37.75225,
    longitude: -122.41845,
    stopIds: ["STOP-24TH"],
  },
  destination: {
    label: "Market Street",
    latitude: 37.781,
    longitude: -122.413,
    stopIds: ["STOP-MARKET"],
  },
  departureAt: new Date("2026-08-20T12:00:00.000Z"),
};

export type OtpFixture = {
  data: {
    planConnection: {
      routingErrors: unknown[];
      edges: Array<{
        node: {
          start: string;
          end: string;
          legs: Array<Record<string, unknown>>;
        };
      }>;
    };
  };
};

function encodedPolyline(points: Array<[number, number]>) {
  let latitude = 0;
  let longitude = 0;
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1;
    let result = "";
    while (value >= 0x20) {
      result += String.fromCharCode((0x20 | (value & 0x1f)) + 63);
      value >>= 5;
    }
    return result + String.fromCharCode(value + 63);
  };
  return points
    .map(([nextLatitude, nextLongitude]) => {
      const nextLat = Math.round(nextLatitude * 1e5);
      const nextLon = Math.round(nextLongitude * 1e5);
      const value = encode(nextLat - latitude) + encode(nextLon - longitude);
      latitude = nextLat;
      longitude = nextLon;
      return value;
    })
    .join("");
}

export function busPlan(): OtpFixture {
  return {
    data: {
      planConnection: {
        routingErrors: [],
        edges: [
          {
            node: {
              start: "2026-08-20T05:00:00-07:00",
              end: "2026-08-20T05:22:00-07:00",
              legs: [
                {
                  mode: "WALK",
                  startTime: 1_787_227_200_000,
                  endTime: 1_787_227_440_000,
                  distance: 250,
                  from: {
                    name: "24th Street and Mission",
                    lat: 37.75225,
                    lon: -122.41845,
                    stop: null,
                  },
                  to: {
                    name: "24th Street BART",
                    lat: 37.754,
                    lon: -122.4175,
                    stop: { gtfsId: "SF:STOP-24TH" },
                  },
                  legGeometry: { points: "qnleFhzdjVuCyAgEcB" },
                  route: null,
                  trip: null,
                  headsign: null,
                  intermediateStops: [],
                },
                {
                  mode: "BUS",
                  startTime: 1_787_227_620_000,
                  endTime: 1_787_228_400_000,
                  distance: 4_100,
                  from: {
                    name: "24th Street BART",
                    lat: 37.754,
                    lon: -122.4175,
                    stop: { gtfsId: "SF:STOP-24TH" },
                  },
                  to: {
                    name: "Market and 8th",
                    lat: 37.78,
                    lon: -122.414,
                    stop: { gtfsId: "SF:STOP-MARKET-8" },
                  },
                  legGeometry: { points: "oyleFjtdjVwcAkHw|AoK" },
                  route: {
                    gtfsId: "SF:49",
                    shortName: "49",
                    longName: "Van Ness–Mission",
                    color: "005B95",
                  },
                  trip: { gtfsId: "SF:TRIP-49-A" },
                  headsign: "North Point",
                  intermediateStops: [
                    { gtfsId: "SF:STOP-16TH" },
                    { gtfsId: "SF:STOP-VAN-NESS" },
                  ],
                },
                {
                  mode: "WALK",
                  startTime: 1_787_228_400_000,
                  endTime: 1_787_228_520_000,
                  distance: 120,
                  from: {
                    name: "Market and 8th",
                    lat: 37.78,
                    lon: -122.414,
                    stop: { gtfsId: "SF:STOP-MARKET-8" },
                  },
                  to: {
                    name: "Market Street",
                    lat: 37.781,
                    lon: -122.413,
                    stop: null,
                  },
                  legGeometry: { points: "_|qeFn~cjVgEgE" },
                  route: null,
                  trip: null,
                  headsign: null,
                  intermediateStops: [],
                },
              ],
            },
          },
        ],
      },
    },
  };
}

export function transitPlan(
  modes: Array<"BUS" | "TRAM" | "SUBWAY" | "CABLE_CAR">,
): OtpFixture {
  const origin = {
    name: "Journey origin",
    lat: 37.75225,
    lon: -122.41845,
    stop: null,
  };
  const stop = (index: number) => ({
    name: "Stop " + index,
    lat: 37.754 + index * 0.002,
    lon: -122.4175 + index * 0.001,
    stop: { gtfsId: "SF:STOP-" + index },
  });
  const destination = {
    name: "Journey destination",
    lat: 37.781,
    lon: -122.413,
    stop: null,
  };
  const legs: Array<Record<string, unknown>> = [];
  let cursor = Date.parse("2026-08-20T12:00:00.000Z");
  legs.push({
    mode: "WALK",
    startTime: cursor,
    endTime: cursor + 120_000,
    distance: 100,
    from: origin,
    to: stop(0),
    legGeometry: {
      points: encodedPolyline([
        [origin.lat, origin.lon],
        [stop(0).lat, stop(0).lon],
      ]),
    },
    route: null,
    trip: null,
    headsign: null,
    intermediateStops: [],
  });
  cursor += 120_000;
  modes.forEach((mode, index) => {
    const boarding = stop(index);
    const alighting = stop(index + 1);
    const rideStart = cursor + 120_000;
    legs.push({
      mode,
      startTime: rideStart,
      endTime: rideStart + 300_000,
      distance: 1_000,
      from: boarding,
      to: alighting,
      legGeometry: {
        points: encodedPolyline([
          [boarding.lat, boarding.lon],
          [alighting.lat, alighting.lon],
        ]),
      },
      route: {
        gtfsId: "SF:ROUTE-" + index,
        shortName: mode + "-" + index,
        longName: "Route " + index,
        color: index === 0 ? null : "336699",
      },
      trip: { gtfsId: "SF:TRIP-" + index },
      headsign: "Destination " + index,
      intermediateStops: [{ gtfsId: "SF:MID-" + index }],
    });
    cursor = rideStart + 300_000;
    if (index < modes.length - 1) {
      legs.push({
        mode: "WALK",
        startTime: cursor,
        endTime: cursor + 60_000,
        distance: 50,
        from: alighting,
        to: alighting,
        legGeometry: {
          points: encodedPolyline([
            [alighting.lat, alighting.lon],
            [alighting.lat, alighting.lon],
          ]),
        },
        route: null,
        trip: null,
        headsign: null,
        intermediateStops: [],
      });
      cursor += 60_000;
    }
  });
  legs.push({
    mode: "WALK",
    startTime: cursor,
    endTime: cursor + 120_000,
    distance: 100,
    from: stop(modes.length),
    to: destination,
    legGeometry: {
      points: encodedPolyline([
        [stop(modes.length).lat, stop(modes.length).lon],
        [destination.lat, destination.lon],
      ]),
    },
    route: null,
    trip: null,
    headsign: null,
    intermediateStops: [],
  });
  cursor += 120_000;
  return {
    data: {
      planConnection: {
        routingErrors: [],
        edges: [
          {
            node: {
              start: "2026-08-20T05:00:00-07:00",
              end: new Date(cursor).toISOString(),
              legs,
            },
          },
        ],
      },
    },
  };
}

export class MemoryOtpPlanPort implements OtpPlanPort {
  readonly requests: OtpPlanPortRequest[] = [];

  constructor(private readonly response: unknown) {}

  async plan(request: OtpPlanPortRequest): Promise<unknown> {
    this.requests.push(structuredClone(request));
    return structuredClone(this.response);
  }
}
