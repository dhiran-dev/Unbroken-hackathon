"use client";

import {
  ArrowDownUp,
  ArrowRight,
  Check,
  LocateFixed,
  LoaderCircle,
  Search,
} from "lucide-react";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  buildCitywideJourneyRequest,
  CITYWIDE_FORM_ERROR_MESSAGES,
  createCitywideJourneyFormState,
  createJourneySubmitRequestCoordinator,
  createOneTimeLocationAttemptCoordinator,
  createPlaceSearchRequestCoordinator,
  flattenPlaceGroups,
  locationFailureFromCode,
  movePlaceHighlight,
  normalizeJourneyPlan,
  normalizePlaceGroups,
  safeResponseMessage,
  selectCatalogPlace,
  selectCurrentLocation,
  setDepartureMode,
  setFutureDeparture,
  setJourneyFieldText,
  swapJourneyFields,
  unselectedPlaceError,
  validateGeolocationPosition,
  type CitywideJourneyFormState,
  type CitywidePlace,
  type CitywidePlaceGroup,
  type JourneyFormField,
  type PlaceSearchRequestCoordinator,
  type SafeJourneyPlan,
} from "@/domain/journey/citywide-journey-form";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SEARCH_QUERY_MAX_LENGTH = 120;
const SEARCH_DEBOUNCE_MS = 220;
const SEARCH_UNAVAILABLE_MESSAGE = "Place search is unavailable right now.";

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "AbortError")
  );
}

type FieldSearchState = {
  groups: CitywidePlaceGroup[];
  open: boolean;
  highlightedIndex: number;
  loading: boolean;
  message: string | null;
};

const emptyFieldSearchState = (): FieldSearchState => ({
  groups: normalizePlaceGroups(null),
  open: false,
  highlightedIndex: -1,
  loading: false,
  message: null,
});

function emptySearches(): Record<JourneyFormField, FieldSearchState> {
  return {
    origin: emptyFieldSearchState(),
    destination: emptyFieldSearchState(),
  };
}

function selectedEndpointsDiffer(state: CitywideJourneyFormState) {
  const origin = state.origin.selection;
  const destination = state.destination.selection;
  if (!origin || !destination) return false;
  if (origin.kind !== destination.kind) return true;
  if (origin.kind === "catalog" && destination.kind === "catalog") {
    return origin.place.id !== destination.place.id;
  }
  if (
    origin.kind === "current_location" &&
    destination.kind === "current_location"
  ) {
    return (
      origin.input.latitude !== destination.input.latitude ||
      origin.input.longitude !== destination.input.longitude ||
      origin.input.accuracyMeters !== destination.input.accuracyMeters
    );
  }
  return true;
}

export function CitywideJourneyForm() {
  const [formState, setFormState] = useState(createCitywideJourneyFormState);
  const [searches, setSearches] = useState(emptySearches);
  const [formError, setFormError] = useState<string | null>(null);
  const [placeSelectionError, setPlaceSelectionError] = useState<string | null>(
    null,
  );
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationBusy, setLocationBusy] = useState(false);
  const [locationHasBeenUsed, setLocationHasBeenUsed] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [, setJourneyPlan] = useState<SafeJourneyPlan | null>(null);

  const formRef = useRef<HTMLFormElement>(null);
  const formErrorRef = useRef<HTMLParagraphElement>(null);
  const locationMessageRef = useRef<HTMLParagraphElement>(null);
  const fieldInputRefs = useRef<
    Record<JourneyFormField, HTMLInputElement | null>
  >({ origin: null, destination: null });
  const searchCoordinators = useRef<
    Record<JourneyFormField, PlaceSearchRequestCoordinator>
  >({
    origin: createPlaceSearchRequestCoordinator(),
    destination: createPlaceSearchRequestCoordinator(),
  });
  const searchTimers = useRef<
    Record<JourneyFormField, ReturnType<typeof setTimeout> | null>
  >({ origin: null, destination: null });
  const searchBlurTimers = useRef<
    Record<JourneyFormField, ReturnType<typeof setTimeout> | null>
  >({ origin: null, destination: null });
  const submitCoordinator = useRef(createJourneySubmitRequestCoordinator());
  const locationAttemptCoordinator = useRef(
    createOneTimeLocationAttemptCoordinator(),
  );

  useEffect(() => {
    const coordinators = searchCoordinators.current;
    const timers = searchTimers.current;
    const blurTimers = searchBlurTimers.current;
    const submitRequests = submitCoordinator.current;
    return () => {
      for (const field of ["origin", "destination"] as const) {
        coordinators[field].cancel();
        const timer = timers[field];
        if (timer) clearTimeout(timer);
        const blurTimer = blurTimers[field];
        if (blurTimer) clearTimeout(blurTimer);
      }
      submitRequests.cancel();
    };
  }, []);

  function updateSearch(
    field: JourneyFormField,
    update: (current: FieldSearchState) => FieldSearchState,
  ) {
    setSearches((current) => ({
      ...current,
      [field]: update(current[field]),
    }));
  }

  function clearSearch(field: JourneyFormField) {
    searchCoordinators.current[field].cancel();
    const timer = searchTimers.current[field];
    if (timer) clearTimeout(timer);
    searchTimers.current[field] = null;
    updateSearch(field, () => ({
      ...emptyFieldSearchState(),
    }));
  }

  function scheduleSearch(field: JourneyFormField, rawQuery: string) {
    clearSearch(field);
    const query = rawQuery.trim().slice(0, SEARCH_QUERY_MAX_LENGTH);
    if (query.length === 0) return;

    const coordinator = searchCoordinators.current[field];
    updateSearch(field, (current) => ({
      ...current,
      open: true,
      loading: true,
      message: null,
      highlightedIndex: -1,
    }));
    searchTimers.current[field] = setTimeout(() => {
      searchTimers.current[field] = null;
      const request = coordinator.begin();
      const parameters = new URLSearchParams({ q: query });
      void fetch(`/api/public/places?${parameters.toString()}`, {
        cache: "no-store",
        signal: request.signal,
      })
        .then(async (response) => {
          const body: unknown = await response.json().catch(() => null);
          if (!coordinator.isCurrent(request.sequence)) return;
          if (!response.ok) {
            updateSearch(field, (current) => ({
              ...current,
              loading: false,
              open: true,
              highlightedIndex: -1,
              message: SEARCH_UNAVAILABLE_MESSAGE,
            }));
            return;
          }
          const groups = normalizePlaceGroups(body);
          updateSearch(field, (current) => ({
            ...current,
            groups,
            loading: false,
            open: true,
            highlightedIndex: -1,
            message: null,
          }));
        })
        .catch((error: unknown) => {
          if (isAbortError(error)) return;
          if (!coordinator.isCurrent(request.sequence)) return;
          updateSearch(field, (current) => ({
            ...current,
            loading: false,
            open: true,
            highlightedIndex: -1,
            message: SEARCH_UNAVAILABLE_MESSAGE,
          }));
        });
    }, SEARCH_DEBOUNCE_MS);
  }

  function choosePlace(field: JourneyFormField, place: CitywidePlace) {
    const nextState = selectCatalogPlace(formState, field, place);
    setFormState(nextState);
    setPlaceSelectionError(unselectedPlaceError(nextState));
    setFormError(
      nextState.origin.selection &&
        nextState.destination.selection &&
        !selectedEndpointsDiffer(nextState)
        ? CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces
        : null,
    );
    setLocationMessage(null);
    clearSearch(field);
  }

  function handleFieldChange(
    field: JourneyFormField,
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const text = event.currentTarget.value;
    const nextState = setJourneyFieldText(formState, field, text);
    setFormState(nextState);
    setPlaceSelectionError(unselectedPlaceError(nextState));
    setFormError(null);
    setLocationMessage(null);
    scheduleSearch(field, text);
  }

  function handleFieldKeyDown(
    field: JourneyFormField,
    event: KeyboardEvent<HTMLInputElement>,
  ) {
    const search = searches[field];
    const options = flattenPlaceGroups(search.groups);
    if (event.key === "ArrowDown") {
      event.preventDefault();
      updateSearch(field, (current) => ({
        ...current,
        open: true,
        highlightedIndex: movePlaceHighlight(
          current.highlightedIndex,
          options.length,
          "next",
        ),
      }));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      updateSearch(field, (current) => ({
        ...current,
        open: true,
        highlightedIndex: movePlaceHighlight(
          current.highlightedIndex,
          options.length,
          "previous",
        ),
      }));
      return;
    }
    if (event.key === "Enter" && search.open && search.highlightedIndex >= 0) {
      const place = options[search.highlightedIndex];
      if (place) {
        event.preventDefault();
        choosePlace(field, place);
      }
      return;
    }
    if (event.key === "Escape") {
      updateSearch(field, (current) => ({
        ...current,
        open: false,
        highlightedIndex: -1,
      }));
      return;
    }
    if (event.key === "Tab") {
      updateSearch(field, (current) => ({
        ...current,
        open: false,
        highlightedIndex: -1,
      }));
    }
  }

  function handleFieldBlur(field: JourneyFormField) {
    const timer = searchBlurTimers.current[field];
    if (timer) clearTimeout(timer);
    searchBlurTimers.current[field] = setTimeout(() => {
      updateSearch(field, (current) => ({
        ...current,
        open: false,
        highlightedIndex: -1,
      }));
    }, 120);
  }

  function handleFieldFocus(field: JourneyFormField) {
    const search = searches[field];
    if (search.groups.some((group) => group.places.length > 0)) {
      updateSearch(field, (current) => ({ ...current, open: true }));
    }
  }

  function showLocationMessage(message: string) {
    setLocationMessage(message);
    setLocationBusy(false);
    window.requestAnimationFrame(() => locationMessageRef.current?.focus());
  }

  function handleUseLocation() {
    if (locationBusy || !locationAttemptCoordinator.current.begin()) return;
    setLocationHasBeenUsed(true);
    setLocationBusy(true);
    setLocationMessage(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      showLocationMessage(CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable);
      return;
    }
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const result = validateGeolocationPosition(position);
          if (!result.ok) {
            showLocationMessage(result.message);
            return;
          }
          setFormState((current) =>
            selectCurrentLocation(current, "origin", result.input),
          );
          setPlaceSelectionError(null);
          setFormError(null);
          setLocationMessage(null);
          setLocationBusy(false);
          clearSearch("origin");
          window.requestAnimationFrame(() => fieldInputRefs.current.origin?.focus());
        },
        (error) => {
          showLocationMessage(
            locationFailureFromCode(
              typeof error?.code === "number" ? error.code : undefined,
            ),
          );
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 0 },
      );
    } catch {
      showLocationMessage(CITYWIDE_FORM_ERROR_MESSAGES.locationUnavailable);
    }
  }

  function handleSwap() {
    if (!formState.origin.text && !formState.destination.text) return;
    const nextState = swapJourneyFields(formState);
    setFormState(nextState);
    setPlaceSelectionError(unselectedPlaceError(nextState));
    setFormError(
      nextState.origin.selection &&
        nextState.destination.selection &&
        !selectedEndpointsDiffer(nextState)
        ? CITYWIDE_FORM_ERROR_MESSAGES.invalidPlaces
        : null,
    );
    setLocationMessage(null);
    clearSearch("origin");
    clearSearch("destination");
  }

  function focusFormError() {
    window.requestAnimationFrame(() => formErrorRef.current?.focus());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const request = submitCoordinator.current.begin();
    if (!request) return;
    const controller = request.controller;

    const validation = buildCitywideJourneyRequest(formState, new Date());
    if (!validation.request) {
      submitCoordinator.current.complete(controller);
      setFormError(validation.error);
      focusFormError();
      return;
    }

    setIsSubmitting(true);
    setFormError(null);

    try {
      const response = await fetch("/api/public/journeys", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validation.request),
        signal: controller.signal,
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        setFormError(
          safeResponseMessage(body) ??
            CITYWIDE_FORM_ERROR_MESSAGES.unavailable,
        );
        focusFormError();
        return;
      }
      const safePlan = normalizeJourneyPlan(body);
      if (!safePlan) {
        setFormError(CITYWIDE_FORM_ERROR_MESSAGES.unavailable);
        focusFormError();
        return;
      }
      setJourneyPlan(safePlan);
      formRef.current?.dispatchEvent(
        new CustomEvent<SafeJourneyPlan>("unbroken:journey-plan", {
          bubbles: true,
          detail: safePlan,
        }),
      );
    } catch (error: unknown) {
      if (isAbortError(error)) return;
      setFormError(CITYWIDE_FORM_ERROR_MESSAGES.unavailable);
      focusFormError();
    } finally {
      if (submitCoordinator.current.complete(controller)) {
        setIsSubmitting(false);
      }
    }
  }

  const visibleFormError = placeSelectionError ?? formError;

  function renderPlaceField(field: JourneyFormField) {
    const isOrigin = field === "origin";
    const label = isOrigin ? "From" : "To";
    const inputId = isOrigin ? "citywide-from" : "citywide-to";
    const listboxId = `${inputId}-results`;
    const search = searches[field];
    const options = flattenPlaceGroups(search.groups);
    const selected = formState[field].selection;
    const count = options.length;
    const activeOption =
      search.highlightedIndex >= 0
        ? `${inputId}-option-${search.highlightedIndex}`
        : undefined;

    return (
      <div className="space-y-2" key={field}>
        <label className="text-sm font-medium" htmlFor={inputId}>
          {label}
        </label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            aria-activedescendant={activeOption}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={search.open}
            aria-haspopup="listbox"
            aria-invalid={Boolean(visibleFormError)}
            autoComplete="off"
            id={inputId}
            maxLength={SEARCH_QUERY_MAX_LENGTH}
            name={field}
            onBlur={() => handleFieldBlur(field)}
            onChange={(event) => handleFieldChange(field, event)}
            onFocus={() => handleFieldFocus(field)}
            onKeyDown={(event) => handleFieldKeyDown(field, event)}
            placeholder="Search stops, stations, or places"
            ref={(node) => {
              fieldInputRefs.current[field] = node;
            }}
            role="combobox"
            className="h-11 w-full rounded-[var(--control-radius)] border border-input bg-card px-3 pl-10 text-base shadow-xs outline-none transition-[border-color,box-shadow] duration-150 placeholder:text-muted-foreground/75 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-55 sm:h-10 sm:text-sm"
            value={formState[field].text}
          />
          {search.open && (
            <div
              className="absolute inset-x-0 top-full z-30 mt-2 overflow-hidden rounded-xl border bg-popover shadow-lg"
              onMouseDown={(event) => event.preventDefault()}
            >
              <div
                aria-live="polite"
                className="border-b px-3 py-2 text-xs text-muted-foreground"
                role="status"
              >
                {search.loading
                  ? "Searching places…"
                  : `${count} ${count === 1 ? "place" : "places"} available.`}
              </div>
              <div
                aria-label={`${label} place results`}
                className="max-h-72 overflow-y-auto p-1"
                id={listboxId}
                role="listbox"
              >
                {search.groups.map((group) => (
                  <div aria-label={group.label} key={group.id} role="group">
                    <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      {group.label}
                    </p>
                    {group.places.map((place) => {
                      const optionIndex = options.findIndex(
                        (option) => option.id === place.id,
                      );
                      const isHighlighted =
                        optionIndex === search.highlightedIndex;
                      return (
                        <button
                          aria-selected={isHighlighted}
                          className={cn(
                            "flex min-h-11 w-full items-start gap-3 rounded-lg px-3 py-2 text-left text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                            isHighlighted
                              ? "bg-accent text-accent-foreground"
                              : "hover:bg-accent/70",
                          )}
                          id={`${inputId}-option-${optionIndex}`}
                          key={place.id}
                          onClick={() => choosePlace(field, place)}
                          onMouseDown={(event) => event.preventDefault()}
                          role="option"
                          type="button"
                        >
                          <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border text-muted-foreground">
                            <span className="sr-only">{group.label}: </span>
                            {isHighlighted ? (
                              <Check aria-hidden="true" className="size-3.5" />
                            ) : null}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-medium">
                              {place.name}
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {place.description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
                {!search.loading && count === 0 && (
                  <p className="px-3 py-4 text-sm text-muted-foreground">
                    No matching places found.
                  </p>
                )}
                {search.message && (
                  <p className="px-3 py-4 text-sm text-destructive-content" role="alert">
                    {search.message}
                  </p>
                )}
              </div>
            </div>
          )}
        </div>
        {selected && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Check aria-hidden="true" className="size-3.5 text-success-foreground" />
            Selected: {selected.kind === "catalog" ? selected.place.name : "Current location"}
          </p>
        )}
        {!isOrigin && <span className="sr-only" id={`${inputId}-fallback`} />}
      </div>
    );
  }

  const canSubmit = selectedEndpointsDiffer(formState);

  return (
    <form
      aria-label="Find a step-free route"
      className="space-y-5"
      noValidate
      onSubmit={handleSubmit}
      ref={formRef}
    >
      <div className="space-y-4">
        {renderPlaceField("origin")}
        <div className="flex justify-center py-0.5">
          <button
            aria-label="Swap From and To"
            className={cn(
              buttonVariants({ variant: "outline", size: "icon" }),
              "min-h-11 min-w-11 sm:size-10",
            )}
            disabled={!formState.origin.text && !formState.destination.text}
            onClick={handleSwap}
            type="button"
          >
            <ArrowDownUp aria-hidden="true" />
          </button>
        </div>
        {renderPlaceField("destination")}
      </div>

      <div className="rounded-xl border bg-muted/25 p-4">
        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">Departure</legend>
          <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
            <input
              aria-controls={
                formState.departureMode === "future"
                  ? "citywide-departure-time"
                  : undefined
              }
              aria-label="Leave now"
              checked={formState.departureMode === "now"}
              className="size-5 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onChange={(event) => {
                setFormState((current) =>
                  setDepartureMode(current, event.currentTarget.checked ? "now" : "future"),
                );
                setFormError(null);
              }}
              role="switch"
              type="checkbox"
            />
            <span className="font-medium">Leave now</span>
          </label>
          {formState.departureMode === "future" && (
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="citywide-departure-time">
                Departure time
              </label>
              <Input
                aria-invalid={Boolean(visibleFormError)}
                id="citywide-departure-time"
                name="departureAt"
                onChange={(event) => {
                  setFormState((current) =>
                    setFutureDeparture(current, event.currentTarget.value),
                  );
                  setFormError(null);
                }}
                type="datetime-local"
                value={formState.futureDeparture}
              />
            </div>
          )}
        </fieldset>
      </div>

      <Button
        className="min-h-11 w-full"
        disabled={locationBusy || locationHasBeenUsed}
        onClick={handleUseLocation}
        type="button"
        variant="outline"
      >
        {locationBusy ? (
          <LoaderCircle aria-hidden="true" className="animate-spin" />
        ) : (
          <LocateFixed aria-hidden="true" />
        )}
        Use my location
      </Button>

      {locationMessage && (
        <p
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-content"
          id="citywide-location-message"
          ref={locationMessageRef}
          role="alert"
          tabIndex={-1}
        >
          {locationMessage}
        </p>
      )}
      {visibleFormError && (
        <p
          aria-live="assertive"
          className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive-content"
          id="citywide-form-error"
          ref={formErrorRef}
          role="alert"
          tabIndex={-1}
        >
          {visibleFormError}
        </p>
      )}
      {isSubmitting && (
        <p aria-live="polite" className="text-sm text-muted-foreground" role="status">
          Planning your step-free route…
        </p>
      )}
      <Button
        className="min-h-11 w-full"
        disabled={!canSubmit || isSubmitting}
        type="submit"
      >
        {isSubmitting ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
        Find a step-free route
        {!isSubmitting ? <ArrowRight aria-hidden="true" /> : null}
      </Button>
      <p className="text-center text-xs leading-5 text-muted-foreground">
        Choose a result from the list so UNBROKEN can plan between known places.
      </p>
    </form>
  );
}
