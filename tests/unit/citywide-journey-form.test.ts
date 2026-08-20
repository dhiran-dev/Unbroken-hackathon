import { describe, expect, it } from "vitest";

import {
  buildCitywideJourneyRequest,
  CITYWIDE_FORM_ERROR_MESSAGES,
  createJourneySubmitRequestCoordinator,
  createOneTimeLocationAttemptCoordinator,
  createPlaceSearchRequestCoordinator,
  createCitywideJourneyFormState,
  flattenPlaceGroups,
  movePlaceHighlight,
  normalizeJourneyPlan,
  normalizePlaceGroups,
  selectCatalogPlace,
  selectCurrentLocation,
  safeResponseMessage,
  serializeFutureDeparture,
  setDepartureMode,
  setFutureDeparture,
  setJourneyFieldText,
  swapJourneyFields,
  unselectedPlaceError,
  validateCurrentLocation,
  validateGeolocationPosition,
  type CitywidePlace,
} from "@/domain/journey/citywide-journey-form";

const origin: CitywidePlace = {
  id: "stop:origin",
  type: "stop",
  name: "Market Street",
  description: "Muni stop",
  latitude: 37.78,
  longitude: -122.41,
  stopIds: ["origin"],
  routeNames: ["5 Fulton"],
};

const destination: CitywidePlace = {
  id: "landmark:ferry-building",
  type: "landmark",
  name: "Ferry Building",
  description: "Destination point",
  latitude: 37.7955,
  longitude: -122.3937,
  stopIds: [],
  routeNames: [],
};

const now = new Date("2026-08-20T12:00:00.000Z");

function selectedState() {
  let state = createCitywideJourneyFormState();
  state = selectCatalogPlace(state, "origin", origin);
  state = selectCatalogPlace(state, "destination", destination);
  return state;
}

describe("citywide journey form state seam", () => {
  it("clears a selected place when its text is edited", () => {
    const state = selectCatalogPlace(
      createCitywideJourneyFormState(),
      "origin",
      origin,
    );

    const edited = setJourneyFieldText(state, "origin", "Market Street e");

    expect(edited.origin).toEqual({ text: "Market Street e", selection: null });
    expect(buildCitywideJourneyRequest(edited, now)).toEqual({
      request: null,
      error: CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces,
    });
  });

  it("keeps the exact list-selection copy separate from request validation", () => {
    const state = setJourneyFieldText(
      createCitywideJourneyFormState(),
      "origin",
      "typed place",
    );

    expect(unselectedPlaceError(state)).toBe(
      CITYWIDE_FORM_ERROR_MESSAGES.unselectedPlace,
    );
    expect(buildCitywideJourneyRequest(state, now).error).toBe(
      CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces,
    );
  });

  it("keeps selected values and their typed labels together when swapping", () => {
    const swapped = swapJourneyFields(selectedState());

    expect(swapped.origin.selection).toEqual({
      kind: "catalog",
      place: destination,
    });
    expect(swapped.origin.text).toBe("Ferry Building");
    expect(swapped.destination.selection).toEqual({
      kind: "catalog",
      place: origin,
    });
  });

  it("builds an exact leave-now request and captures one ISO departure", () => {
    expect(buildCitywideJourneyRequest(selectedState(), now)).toEqual({
      request: {
        origin: { type: "catalog", placeId: "stop:origin" },
        destination: {
          type: "catalog",
          placeId: "landmark:ferry-building",
        },
        departureAt: "2026-08-20T12:00:00.000Z",
      },
      error: null,
    });
  });

  it("serializes a real future local date and rejects impossible or past dates", () => {
    expect(serializeFutureDeparture("2026-08-20T05:30", now)).toBe(null);
    const expectedFuture = new Date(2026, 7, 20, 20, 0, 0, 0).toISOString();
    expect(serializeFutureDeparture("2026-08-20T20:00", now)).toBe(
      expectedFuture,
    );
    expect(serializeFutureDeparture("2026-02-30T13:30", now)).toBe(null);

    let state = selectedState();
    state = setDepartureMode(state, "future");
    state = setFutureDeparture(state, "2026-08-20T20:00");
    expect(buildCitywideJourneyRequest(state, now).request?.departureAt).toBe(
      expectedFuture,
    );
  });

  it("rejects same endpoints and unselected fields with one rider-safe message", () => {
    let state = createCitywideJourneyFormState();
    state = selectCatalogPlace(state, "origin", origin);
    state = selectCatalogPlace(state, "destination", origin);
    expect(buildCitywideJourneyRequest(state, now)).toEqual({
      request: null,
      error: CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces,
    });

    state = setJourneyFieldText(state, "destination", "Ferry Building");
    expect(buildCitywideJourneyRequest(state, now)).toEqual({
      request: null,
      error: CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces,
    });
  });

  it("accepts one-time current location input only inside the route bounds", () => {
    let state = createCitywideJourneyFormState();
    const location = validateCurrentLocation(37.78, -122.41, 40);
    expect(location).toEqual({
      ok: true,
      input: {
        type: "current_location",
        latitude: 37.78,
        longitude: -122.41,
        accuracyMeters: 40,
      },
    });
    if (location.ok) {
      state = selectCurrentLocation(state, "origin", location.input);
      state = selectCatalogPlace(state, "destination", destination);
    }
    expect(buildCitywideJourneyRequest(state, now).request?.origin).toEqual({
      type: "current_location",
      latitude: 37.78,
      longitude: -122.41,
      accuracyMeters: 40,
    });
  });

  it("allows exactly one location attempt, including after a failure", () => {
    const coordinator = createOneTimeLocationAttemptCoordinator();

    expect(coordinator.begin()).toBe(true);
    expect(coordinator.begin()).toBe(false);
  });

  it.each([
    ["denied/unavailable", null, CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable],
    [
      "inaccurate",
      { coords: { latitude: 37.78, longitude: -122.41, accuracy: 1_001 } },
      CITYWIDE_FORM_ERROR_MESSAGES.locationInaccurate,
    ],
    [
      "outside",
      { coords: { latitude: 38, longitude: -122.41, accuracy: 20 } },
      CITYWIDE_FORM_ERROR_MESSAGES.locationOutside,
    ],
  ] as const)("returns the exact %s location copy", (_name, position, message) => {
    expect(validateGeolocationPosition(position)).toMatchObject({
      ok: false,
      message,
    });
  });

  it("normalizes fixed grouped results and never derives an ID from typed text", () => {
    const groups = normalizePlaceGroups({
      groups: [
        {
          id: "places",
          label: "attacker label",
          places: [destination, { ...destination, id: "not-a-place-id" }],
        },
      ],
    });

    expect(groups.map((group) => group.id)).toEqual([
      "nearby_stops",
      "stations",
      "places",
    ]);
    expect(groups[2]?.places).toEqual([destination]);
    expect(flattenPlaceGroups(groups).map((place) => place.id)).toEqual([
      destination.id,
    ]);
  });

  it("wraps grouped keyboard highlight movement in both directions", () => {
    expect(movePlaceHighlight(-1, 2, "next")).toBe(0);
    expect(movePlaceHighlight(0, 2, "next")).toBe(1);
    expect(movePlaceHighlight(1, 2, "next")).toBe(0);
    expect(movePlaceHighlight(-1, 2, "previous")).toBe(1);
    expect(movePlaceHighlight(0, 2, "previous")).toBe(1);
    expect(movePlaceHighlight(1, 2, "previous")).toBe(0);
    expect(movePlaceHighlight(0, 0, "next")).toBe(-1);
  });

  it("aborts a stale place search and ignores its eventual result", () => {
    const coordinator = createPlaceSearchRequestCoordinator();
    const first = coordinator.begin();
    const second = coordinator.begin();

    expect(first.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(first.sequence)).toBe(false);
    expect(coordinator.isCurrent(second.sequence)).toBe(true);

    coordinator.cancel();
    expect(second.signal.aborted).toBe(true);
    expect(coordinator.isCurrent(second.sequence)).toBe(false);
  });

  it("ignores duplicate submits and aborts the active one when cancelled", () => {
    const coordinator = createJourneySubmitRequestCoordinator();
    const first = coordinator.begin();

    expect(first).not.toBeNull();
    expect(coordinator.begin()).toBeNull();
    coordinator.cancel();
    expect(first?.controller.signal.aborted).toBe(true);
    expect(coordinator.complete(first!.controller)).toBe(false);
  });

  it("fails closed when grouped place IDs repeat across result groups", () => {
    const groups = normalizePlaceGroups({
      groups: [
        { id: "nearby_stops", places: [origin] },
        { id: "places", places: [{ ...destination, id: origin.id }] },
      ],
    });

    expect(flattenPlaceGroups(groups)).toEqual([]);
  });
});

describe("safe citywide journey response seam", () => {
  it("projects a public journey plan and drops unknown fields", () => {
    const plan = {
      status: "confirmed",
      title: "Step-free details confirmed",
      summary: "Take the 5 Fulton toward the waterfront.",
      departureAt: "2026-08-20T12:00:00.000Z",
      arrivalAt: "2026-08-20T12:32:00.000Z",
      durationMinutes: 32,
      legs: [
        {
          type: "ride",
          from: "Market Street",
          to: "Ferry Building",
          startAt: "2026-08-20T12:00:00.000Z",
          endAt: "2026-08-20T12:32:00.000Z",
          durationMinutes: 32,
          route: {
            id: "5",
            name: "5 Fulton",
            color: "#123456",
            destination: "Ferry Building",
          },
          instruction: "Ride the 5 Fulton toward the waterfront.",
          geometry: {
            type: "LineString",
            coordinates: [
              [-122.41, 37.78],
              [-122.3937, 37.7955],
            ],
          },
          accessibility: { state: "confirmed", reasons: [] },
        },
      ],
      warnings: [],
      changes: [],
      sources: [
        {
          source: "schedule",
          checkedAt: "2026-08-20T11:55:00.000Z",
          sourceUpdatedAt: null,
          freshness: "current",
          sourceUrl: "https://511.org/open-data/transit",
        },
      ],
      map: {
        bounds: { north: 37.8, south: 37.77, east: -122.39, west: -122.42 },
        origin: { type: "Point", coordinates: [-122.41, 37.78] },
        destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
        affectedStops: { type: "FeatureCollection", features: [] },
      },
      fingerprint: "private",
    };

    const safe = normalizeJourneyPlan(plan);

    expect(safe).not.toBeNull();
    expect(safe).not.toHaveProperty("fingerprint");
    expect(JSON.stringify(safe)).not.toContain("private");
  });

  it("rejects malformed plans instead of exposing an arbitrary response", () => {
    expect(normalizeJourneyPlan({ status: "confirmed", secret: "private" })).toBe(
      null,
    );
  });

  it("rejects non-canonical sources, malformed timestamps, and oversized arrays", () => {
    const plan = {
      status: "confirmed",
      title: "Step-free details confirmed",
      summary: "Take the 5 Fulton toward the waterfront.",
      departureAt: "2026-08-20T12:00:00.000Z",
      arrivalAt: "2026-08-20T12:32:00.000Z",
      durationMinutes: 32,
      legs: [
        {
          type: "ride",
          from: "Market Street",
          to: "Ferry Building",
          startAt: "2026-08-20T12:00:00.000Z",
          endAt: "2026-08-20T12:32:00.000Z",
          durationMinutes: 32,
          instruction: "Ride the 5 Fulton toward the waterfront.",
          geometry: {
            type: "LineString",
            coordinates: [
              [-122.41, 37.78],
              [-122.3937, 37.7955],
            ],
          },
          accessibility: { state: "confirmed", reasons: [] },
        },
      ],
      warnings: [],
      changes: [],
      sources: [
        {
          source: "schedule",
          checkedAt: "2026-08-20T11:55:00.000Z",
          sourceUpdatedAt: null,
          freshness: "current",
          sourceUrl: "https://511.org/open-data/transit",
        },
      ],
      map: {
        bounds: { north: 37.8, south: 37.77, east: -122.39, west: -122.42 },
        origin: { type: "Point", coordinates: [-122.41, 37.78] },
        destination: { type: "Point", coordinates: [-122.3937, 37.7955] },
        affectedStops: { type: "FeatureCollection", features: [] },
      },
    };

    expect(
      normalizeJourneyPlan({
        ...plan,
        sources: [{ ...plan.sources[0], sourceUrl: "https://attacker.example" }],
      }),
    ).toBeNull();
    expect(
      normalizeJourneyPlan({ ...plan, departureAt: "tomorrow" }),
    ).toBeNull();
    expect(
      normalizeJourneyPlan({
        ...plan,
        legs: [
          {
            ...plan.legs[0],
            startAt: "2026-02-30T12:00:00.000Z",
          },
        ],
      }),
    ).toBeNull();
    expect(
      normalizeJourneyPlan({
        ...plan,
        warnings: Array.from({ length: 65 }, () => "warning"),
      }),
    ).toBeNull();
  });

  it("keeps only a plain returned API message", () => {
    expect(safeResponseMessage({ message: "Please wait a moment and try again." })).toBe(
      "Please wait a moment and try again.",
    );
    expect(safeResponseMessage({ message: "<script>private</script>" })).toBe(null);
    expect(safeResponseMessage({ error: "private" })).toBe(null);
  });
});
