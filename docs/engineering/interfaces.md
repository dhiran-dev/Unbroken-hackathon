# Citywide interfaces and contracts

These are the stable seams for implementation tickets. Callers and tests depend on the interface, invariants, errors, and freshness behavior here rather than an adapter's internal format.

## Domain types

```ts
type PlaceInput =
  | { type: "catalog"; placeId: string }
  | {
      type: "current_location";
      latitude: number;
      longitude: number;
      accuracyMeters: number;
    };

type CatalogPlaceRef = { placeId: string };

type PlaceChoice = {
  id: string;
  type: "stop" | "station" | "landmark";
  name: string;
  description: string;
  latitude: number;
  longitude: number;
  stopIds: string[];
  routeNames: string[];
};

type JourneyRequest = {
  origin: PlaceInput;
  destination: PlaceInput;
  departureAt: string;
};

type JourneyPlanStatus =
  | "confirmed"
  | "check_details"
  | "unavailable"
  | "updates_unavailable";

type JourneyLeg = {
  type: "walk" | "wait" | "ride" | "transfer";
  from: string;
  to: string;
  startAt: string;
  endAt: string;
  durationMinutes: number;
  route?: {
    id: string;
    name: string;
    color: string;
    destination: string;
  };
  instruction: string;
  geometry: GeoJSON.LineString;
  accessibility: {
    state: "confirmed" | "unknown" | "blocked";
    reasons: string[];
  };
};

type SourceTime = {
  source:
    | "schedule"
    | "arrivals"
    | "vehicles"
    | "service_changes"
    | "stop_changes"
    | "elevators"
    | "station_access";
  checkedAt: string;
  sourceUpdatedAt: string | null;
  freshness: "current" | "older" | "unavailable";
  sourceUrl: string;
};

type JourneyPlan = {
  status: JourneyPlanStatus;
  title: string;
  summary: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  legs: JourneyLeg[];
  warnings: string[];
  changes: string[];
  sources: SourceTime[];
  map: {
    bounds: MapBounds;
    origin: GeoJSON.Point;
    destination: GeoJSON.Point;
    affectedStops: GeoJSON.FeatureCollection;
  };
};
```

The internal journey fingerprint is stable for semantically identical plans and never returned by a public endpoint.

## Deep modules

```ts
interface TransitCatalog {
  searchPlaces(input: PlaceSearch): Promise<PlaceChoice[]>;
  getPlace(ref: CatalogPlaceRef): Promise<PlaceChoice | null>;
  getCoverage(): Promise<TransitCoverage>;
}

interface RouteEngine {
  planCandidates(request: RouteEngineRequest): Promise<RouteCandidate[]>;
}

interface RealtimeTransit {
  getTripUpdates(at: Date): Promise<TripUpdateView>;
  getVehicles(bounds?: MapBounds): Promise<VehicleView[]>;
  getAlerts(at: Date): Promise<ServiceAlertView[]>;
}

interface AccessibilityEvidence {
  evaluate(
    candidate: RouteCandidate,
    at: Date,
  ): Promise<AccessibilityAssessment>;
}

interface JourneyPlanner {
  plan(request: JourneyRequest): Promise<JourneyPlan>;
}

interface AdmissionPolicy {
  reserveNewRider(email: string): Promise<AdmissionReservation>;
  activateRider(reservationId: string, userId: string): Promise<void>;
  releaseExpiredReservations(now: Date): Promise<number>;
}

interface NotificationPlanner {
  prepareDueNotifications(now: Date): Promise<number>;
  buildMessage(outboxId: string): Promise<CommuteEmail>;
}
```

### Interface invariants

- `TransitCatalog` returns active, selectable places only. Search text never becomes a place reference implicitly.
- `RouteEngine` returns zero to five normalized static candidates and never makes a public accessibility claim.
- `RealtimeTransit` returns only contract-valid, current views. Stale or invalid feed data is represented as unavailable rather than partially merged.
- `AccessibilityEvidence` evaluates every dependency needed by a candidate and cannot translate missing evidence into confirmed.
- `JourneyPlanner` is deterministic for the same request and trusted source state. It may return no confirmed journey and never calls an LLM.
- `AdmissionPolicy` reserves under a database lock before account creation, lets existing riders continue, and leaves no user/account row after capacity rejection.
- `NotificationPlanner` is Pacific-time aware, prepares at most one outbox item per schedule/service date, and contains no raw email address.

## Public routes

| Route | Contract |
| --- | --- |
| `GET /api/public/places?q=&latitude=&longitude=` | Returns selectable catalog results grouped by type/proximity; no raw search strings become IDs. |
| `POST /api/public/journeys` | Accepts catalog references or a validated one-time current location; returns one deterministic `JourneyPlan`. |
| `GET /api/public/map/stops.geojson?v=<feedHash>` | Compressed, immutable-by-hash active-stop features; consumers set `cluster: false`. |
| `GET /api/public/live?bbox=&routeIds=` | Current validated vehicle positions only; bounds and route filters are limited and validated. |
| `GET /api/public/status` | Elevators, service changes, stop moves, accessibility guidance, freshness, and source links. |
| `GET /api/public/signup-availability` | Boolean and plain message only; no provider counts or internal circuit details. |
| `GET /api/me/commutes` | Current rider's first/return schedules only. |
| `PUT /api/me/commutes/:slot` | Creates or replaces `first` or `return`; rejects current-location places and all other slots. |
| `DELETE /api/me/commutes/:slot` | Deletes one current rider schedule idempotently. |
| `POST /api/me/commutes/:slot/preview` | Returns deterministic browser-equivalent email content without sending. |
| `GET /api/me/email-history` | Returns the current rider's safe delivery history without provider secrets. |
| `GET /api/public/routes` | Preserved 11-station compatibility adapter during the hackathon. |

Every public error uses plain language and a stable machine code. Provider responses, internal URLs, collector IDs, query text, tokens, account counts, row-level evidence, and journey fingerprints stay private.

## Database ownership

Migration ownership is serialized.

### `0002_citywide_transit.sql`

- `transit_feed_snapshots`
- `transit_stops`
- `transit_routes`
- `transit_trips`
- `transit_stop_times`
- `transit_services`
- `transit_landmarks`
- `realtime_feed_snapshots`
- `realtime_trip_updates`
- `realtime_vehicle_positions`
- `realtime_alerts`
- `source_snapshots`
- `accessibility_advisories`
- `stop_relocations`
- `stop_accessibility_guides`

Static import uses staging tables in one transaction. Promotion requires required-file presence, referential integrity, valid service dates, plausible row counts and ratios, valid coordinates/times, and stable fingerprints. One active snapshot is visible at a time.

### `0003_rider_accounts.sql`

- Add `rider` without changing `owner` or `admin` authority.
- `rider_profiles`
- `signup_capacity`
- `signup_reservations`

`signup_capacity` has one locked policy row: maximum 40 accounts, active and reserved counts, open/paused admission, and email-service circuit state. Reservations expire after ten minutes. Provider-linking rules prevent Google from attaching to an operator account.

### `0004_commute_notifications.sql`

- `commute_schedules`
- `journey_plan_snapshots`
- `notification_outbox`
- `email_deliveries`
- `email_budget_ledger`

Unique `(user_id, slot)` permits only `first` and `return`. Unique `(schedule_id, service_date)` prevents duplicate preparation. A permanent unique outbox key and Resend key `commute/<scheduleId>/<serviceDate>` prevent duplicate sending. Retries end at departure.

## Feature flags

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `CITYWIDE_DATA_ENABLED` | Citywide refresh/import jobs do not claim work; existing initial product continues. | Versioned citywide sources may refresh and promote trusted snapshots. |
| `CITYWIDE_PLANNER_ENABLED` | Public compatibility planner remains; citywide endpoints return a plain unavailable state. | Citywide search, plan, map, live, and expanded status surfaces are available. |
| `PUBLIC_GOOGLE_SIGNUP_ENABLED` | Existing Google riders may continue only when provider login is intentionally retained; no new public admission starts. | Google is shown as the sole public account action and first-time riders cross atomic admission. |
| `COMMUTE_EMAILS_ENABLED` | Schedules remain editable; no due notification is prepared or sent. | Budgeted due schedules may prepare and send deterministic updates. |

## Environment contract

New configuration keys are `TRANSIT_511_API_TOKEN`, fixed `TRANSIT_511_OPERATOR_ID=SF`, `TRANSIT_DATA_DIR`, private `OTP_BASE_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, fixed `PUBLIC_RIDER_CAP=40`, fixed `PUBLIC_COMMUTES_PER_RIDER=2`, fixed `EMAIL_DAILY_BUDGET=80`, fixed `EMAIL_MONTHLY_BUDGET=2480`, and the public CARTO light/dark style URLs.

Secrets are server-only and never appear in client bundles, logs, committed planning files, committed fixtures, or error bodies. The existing exact non-TLS database exception remains limited to the owner-authorized host, port, and database already enforced in `src/lib/env.ts`.

## Public wording

Internal states map exactly:

| State | Rider wording |
| --- | --- |
| `confirmed` | Step-free details confirmed |
| `check_details` | Some details need checking |
| `unavailable` | No step-free route confirmed |
| `updates_unavailable` | Current updates are unavailable |

Walking guidance uses: “This path avoids mapped stairs. Some sidewalk details may be missing.”

Rider pages may say From, To, Use my location, Leave now, Find a step-free route, My trips, First trip, Return trip, Days, Usual departure time, Remind me, and Send a test preview. They do not expose job, queue, worker, collector, GTFS, OTP, GraphQL, schema, fingerprint, or protobuf.

The distinct labels “Checked by UNBROKEN at” and “SFMTA updated at” are visually prominent on every journey/status result; neither may be replaced by the ambiguous label “last updated.”
