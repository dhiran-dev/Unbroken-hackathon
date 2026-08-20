export type RealtimeFeedType = "trip_updates" | "vehicles" | "alerts";

export type RealtimeProvenance = {
  checkedAt: Date;
  sourceUpdatedAt: Date;
  sourceUrl: "https://511.org/open-data/transit";
};

export type TripUpdate = {
  updateId: string;
  entityId: string;
  tripId: string;
  routeId: string | null;
  scheduleRelationship: string;
  stopId: string | null;
  stopSequence: number | null;
  arrivalDelaySeconds: number | null;
  departureDelaySeconds: number | null;
  arrivalAt: Date | null;
  departureAt: Date | null;
};

export type VehicleView = {
  entityId: string;
  vehicleId: string | null;
  label: string | null;
  tripId: string;
  routeId: string;
  stopId: string | null;
  currentStopSequence: number | null;
  currentStatus: string | null;
  latitude: number;
  longitude: number;
  bearing: number | null;
  speedMetersPerSecond: number | null;
  observedAt: Date;
};

export type CurrentVehicleSnapshotView =
  | ({ state: "current"; vehicles: VehicleView[] } & RealtimeProvenance)
  | { state: "unavailable"; vehicles: [] };

export type ServiceAlertView = {
  entityId: string;
  cause: string | null;
  effect: string | null;
  header: string;
  description: string | null;
  url: string | null;
  activePeriods: Array<{ startsAt: Date | null; endsAt: Date | null }>;
  informedEntities: Array<{
    agencyId: string | null;
    routeId: string | null;
    tripId: string | null;
    stopId: string | null;
  }>;
};

export type TripUpdateView =
  | ({ state: "current"; updates: TripUpdate[] } & RealtimeProvenance)
  | { state: "unavailable"; updates: [] };

export type MapBounds = {
  west: number;
  south: number;
  east: number;
  north: number;
};

export type TrustedRealtimeSnapshot = RealtimeProvenance & {
  feedType: RealtimeFeedType;
  expiresAt: Date;
  tripUpdates: TripUpdate[];
  vehicles: VehicleView[];
  alerts: ServiceAlertView[];
};

export interface RealtimeReadStore {
  getTrustedSnapshot(
    feedType: RealtimeFeedType,
    at: Date,
  ): Promise<TrustedRealtimeSnapshot | null>;
}

export interface RealtimeTransit {
  getTripUpdates(at: Date): Promise<TripUpdateView>;
  getVehicles(bounds?: MapBounds): Promise<VehicleView[]>;
  getCurrentVehicles(at: Date): Promise<CurrentVehicleSnapshotView>;
  getAlerts(at: Date): Promise<ServiceAlertView[]>;
}

function validBounds(bounds: MapBounds) {
  return (
    [bounds.west, bounds.south, bounds.east, bounds.north].every(
      Number.isFinite,
    ) &&
    bounds.west >= -122.58 &&
    bounds.east <= -122.31 &&
    bounds.south >= 37.68 &&
    bounds.north <= 37.86 &&
    bounds.west <= bounds.east &&
    bounds.south <= bounds.north
  );
}

function provenance(snapshot: TrustedRealtimeSnapshot): RealtimeProvenance {
  return {
    checkedAt: new Date(snapshot.checkedAt),
    sourceUpdatedAt: new Date(snapshot.sourceUpdatedAt),
    sourceUrl: "https://511.org/open-data/transit",
  };
}

export function createRealtimeTransit(
  store: RealtimeReadStore,
  clock: () => Date = () => new Date(),
): RealtimeTransit {
  return {
    async getTripUpdates(at) {
      const snapshot = await store.getTrustedSnapshot("trip_updates", at);
      if (!snapshot) return { state: "unavailable", updates: [] };
      return {
        state: "current",
        ...provenance(snapshot),
        updates: snapshot.tripUpdates.map((update) => ({
          ...update,
          arrivalAt: update.arrivalAt ? new Date(update.arrivalAt) : null,
          departureAt: update.departureAt ? new Date(update.departureAt) : null,
        })),
      };
    },

    async getVehicles(bounds) {
      const snapshot = await store.getTrustedSnapshot("vehicles", clock());
      if (!snapshot || (bounds && !validBounds(bounds))) return [];
      const vehicles = bounds
        ? snapshot.vehicles.filter(
            (vehicle) =>
              vehicle.longitude >= bounds.west &&
              vehicle.longitude <= bounds.east &&
              vehicle.latitude >= bounds.south &&
              vehicle.latitude <= bounds.north,
          )
        : snapshot.vehicles;
      return vehicles.map((vehicle) => ({
        ...vehicle,
        observedAt: new Date(vehicle.observedAt),
      }));
    },

    async getCurrentVehicles(at) {
      const snapshot = await store.getTrustedSnapshot("vehicles", at);
      if (!snapshot) return { state: "unavailable", vehicles: [] };
      return {
        state: "current",
        ...provenance(snapshot),
        vehicles: snapshot.vehicles.map((vehicle) => ({
          ...vehicle,
          observedAt: new Date(vehicle.observedAt),
        })),
      };
    },

    async getAlerts(at) {
      const snapshot = await store.getTrustedSnapshot("alerts", at);
      if (!snapshot) return [];
      return snapshot.alerts
        .filter(
          (alert) =>
            alert.activePeriods.length === 0 ||
            alert.activePeriods.some(
              (period) =>
                (!period.startsAt || period.startsAt <= at) &&
                (!period.endsAt || period.endsAt >= at),
            ),
        )
        .map((alert) => ({
          ...alert,
          activePeriods: alert.activePeriods.map((period) => ({
            startsAt: period.startsAt ? new Date(period.startsAt) : null,
            endsAt: period.endsAt ? new Date(period.endsAt) : null,
          })),
          informedEntities: alert.informedEntities.map((entity) => ({
            ...entity,
          })),
        }));
    },
  };
}
