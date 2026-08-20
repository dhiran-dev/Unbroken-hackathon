"use client";

import {
  AlertTriangle,
  Check,
  LoaderCircle,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";

import {
  COMMUTE_DAYS,
  REMINDER_MINUTES,
  type CommuteDay,
  type CommuteSlot,
} from "@/domain/commute/schedule";
import {
  createEmptyCommuteCards,
  createCommuteFormValue,
  formatCommuteDays,
  formatDepartureTime,
  normalizeCommutesPayload,
  normalizeEmailHistoryPayload,
  normalizePlaceSearchPayload,
  reminderLabel,
  slotLabel,
  toCommuteDraft,
  toStoredCommuteDraft,
  type CommuteDraft,
  type CommuteFormValue,
  type CommutePlaceChoice,
  type SafeHistoryEntry,
} from "@/domain/commute/account-page";
import type { SavedCommute } from "@/domain/commute/service";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

type ApiOperation = "trips" | "save" | "delete" | "preview" | "history";

class RiderTripsRequestError extends Error {
  constructor(
    readonly operation: ApiOperation,
    readonly code: string | null,
  ) {
    super("RIDER_TRIPS_REQUEST_FAILED");
  }
}

export type RiderMyTripsApi = {
  list(): Promise<unknown>;
  replace(slot: CommuteSlot, draft: CommuteDraft): Promise<unknown>;
  remove(slot: CommuteSlot): Promise<unknown>;
  preview(slot: CommuteSlot): Promise<unknown>;
  history(): Promise<unknown>;
  search(query: string): Promise<unknown>;
};

export type RiderMyTripsProps = {
  initialCommutes?: readonly SavedCommute[];
  initialPlaces?: readonly CommutePlaceChoice[];
  api?: RiderMyTripsApi;
};

function riderMessage(operation: ApiOperation, status: number, code: unknown) {
  if (status === 401 || code === "COMMUTE_AUTH_REQUIRED") {
    return "Sign in with Google to manage your trips.";
  }
  if (operation === "preview") {
    return "Test previews are unavailable right now.";
  }
  if (operation === "history") {
    return "Past trip updates are unavailable right now.";
  }
  if (status === 400 || code === "COMMUTE_INVALID") {
    return "Check your trip details and try again.";
  }
  return "Your trips are unavailable right now.";
}

async function responseBody(response: Response, operation: ApiOperation) {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code =
      typeof body === "object" && body !== null && "code" in body
        ? body.code
        : null;
    throw new RiderTripsRequestError(
      operation,
      typeof code === "string" ? code : null,
    );
  }
  return body;
}

export function createRiderMyTripsApi(
  fetcher: typeof fetch = fetch,
): RiderMyTripsApi {
  return {
    async list() {
      return responseBody(
        await fetcher("/api/me/commutes", { cache: "no-store" }),
        "trips",
      );
    },
    async replace(slot, draft) {
      return responseBody(
        await fetcher(`/api/me/commutes/${slot}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        }),
        "save",
      );
    },
    async remove(slot) {
      return responseBody(
        await fetcher(`/api/me/commutes/${slot}`, { method: "DELETE" }),
        "delete",
      );
    },
    async preview(slot) {
      return responseBody(
        await fetcher(`/api/me/commutes/${slot}/preview`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        }),
        "preview",
      );
    },
    async history() {
      return responseBody(
        await fetcher("/api/me/email-history", { cache: "no-store" }),
        "history",
      );
    },
    async search(query) {
      const parameters = new URLSearchParams({ q: query });
      return responseBody(
        await fetcher(`/api/public/places?${parameters.toString()}`, {
          cache: "no-store",
        }),
        "trips",
      );
    },
  };
}

function emptyForm(): CommuteFormValue {
  return {
    origin: null,
    destination: null,
    days: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    departureTime: "08:30",
    reminderMinutes: 30,
    paused: false,
  };
}

function mergePlaces(
  current: ReadonlyMap<string, CommutePlaceChoice>,
  choices: readonly CommutePlaceChoice[],
) {
  const next = new Map(current);
  for (const choice of choices) next.set(choice.id, choice);
  return next;
}

function normalizeSingleCommute(value: unknown, slot: CommuteSlot) {
  const commutes = normalizeCommutesPayload({ commutes: [value] });
  return commutes?.length === 1 && commutes[0]?.slot === slot
    ? commutes[0]
    : null;
}

function safePreview(
  value: unknown,
): { ok: true; subject: string; text: string } | { ok: false } {
  if (typeof value !== "object" || value === null) return { ok: false };
  const subject =
    "subject" in value && typeof value.subject === "string"
      ? value.subject
      : null;
  const text =
    "text" in value && typeof value.text === "string" ? value.text : null;
  if (
    !subject ||
    !text ||
    subject.length > 160 ||
    text.length > 4_000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(subject) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)
  ) {
    return { ok: false };
  }
  return { ok: true, subject, text };
}

function safeStatusLabel(status: SafeHistoryEntry["status"]) {
  if (status === "sent") return "Sent";
  if (status === "failed") return "Needs checking";
  if (status === "suppressed") return "Not sent";
  return "Preparing";
}

function apiErrorMessage(error: unknown, operation: ApiOperation) {
  if (error instanceof RiderTripsRequestError) {
    return riderMessage(operation, 0, error.code);
  }
  return riderMessage(operation, 503, null);
}

type PlaceSearchFieldProps = {
  id: string;
  label: string;
  selected: CommutePlaceChoice | null;
  api: RiderMyTripsApi;
  onSelected: (place: CommutePlaceChoice | null) => void;
  onChoices: (places: CommutePlaceChoice[]) => void;
};

function PlaceSearchField({
  id,
  label,
  selected,
  api,
  onSelected,
  onChoices,
}: PlaceSearchFieldProps) {
  const [query, setQuery] = useState(selected?.name ?? "");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [choices, setChoices] = useState<CommutePlaceChoice[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function search(rawQuery: string) {
    if (timer.current) clearTimeout(timer.current);
    const nextQuery = rawQuery.trim().slice(0, 120);
    setQuery(rawQuery.slice(0, 120));
    onSelected(null);
    setMessage(null);
    setOpen(nextQuery.length > 0);
    setHighlightedIndex(-1);
    if (!nextQuery) {
      setChoices([]);
      setLoading(false);
      return;
    }
    const requestSequence = ++sequence.current;
    setLoading(true);
    timer.current = setTimeout(() => {
      void api
        .search(nextQuery)
        .then((body) => {
          if (requestSequence !== sequence.current) return;
          const groups = normalizePlaceSearchPayload(body);
          if (!groups) {
            setChoices([]);
            setMessage("Place search is unavailable right now.");
          } else {
            const nextChoices = groups.flat();
            setChoices(nextChoices);
            onChoices(nextChoices);
            setMessage(
              nextChoices.length === 0 ? "Choose a place from the list." : null,
            );
          }
        })
        .catch(() => {
          if (requestSequence !== sequence.current) return;
          setChoices([]);
          setMessage("Place search is unavailable right now.");
        })
        .finally(() => {
          if (requestSequence === sequence.current) setLoading(false);
        });
    }, 180);
  }

  function select(place: CommutePlaceChoice) {
    setQuery(place.name);
    setChoices([]);
    setHighlightedIndex(-1);
    setOpen(false);
    setMessage(null);
    onSelected(place);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      setHighlightedIndex(-1);
      return;
    }
    if (choices.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) =>
        current + 1 >= choices.length ? 0 : current + 1,
      );
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) =>
        current <= 0 ? choices.length - 1 : current - 1,
      );
      return;
    }
    if (event.key === "Enter" && open && highlightedIndex >= 0) {
      event.preventDefault();
      const choice = choices[highlightedIndex];
      if (choice) select(choice);
    }
  }

  return (
    <div className="relative space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          aria-autocomplete="list"
          aria-activedescendant={
            highlightedIndex >= 0
              ? `${id}-choice-${highlightedIndex}`
              : undefined
          }
          aria-controls={`${id}-choices`}
          aria-expanded={open}
          aria-haspopup="listbox"
          autoComplete="off"
          className="pl-9"
          id={id}
          onBlur={() => {
            window.setTimeout(() => setOpen(false), 120);
          }}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            search(event.currentTarget.value)
          }
          onFocus={() => {
            if (choices.length > 0) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search for a place"
          role="combobox"
          value={query}
        />
      </div>
      {open && (loading || choices.length > 0 || message) && (
        <div
          aria-label={`${label} choices`}
          className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border bg-card shadow-lg"
          id={`${id}-choices`}
          role="listbox"
        >
          {loading && (
            <p className="flex items-center gap-2 px-3 py-3 text-sm text-muted-foreground">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
              Searching…
            </p>
          )}
          {!loading &&
            choices.map((place, index) => (
              <button
                aria-label={`${place.name}, ${place.description}`}
                aria-selected={selected?.id === place.id}
                className={`block w-full border-b px-3 py-3 text-left last:border-b-0 hover:bg-accent focus-visible:bg-accent ${highlightedIndex === index ? "bg-accent" : ""}`}
                id={`${id}-choice-${index}`}
                key={place.id}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    select(place);
                  }
                }}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => select(place)}
                role="option"
                type="button"
              >
                <span className="block text-sm font-medium">{place.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {place.description}
                </span>
              </button>
            ))}
          {!loading && message && choices.length === 0 && (
            <p className="px-3 py-3 text-sm text-muted-foreground">{message}</p>
          )}
        </div>
      )}
      {message && !open && (
        <p className="text-xs text-muted-foreground" role="status">
          {message}
        </p>
      )}
    </div>
  );
}

type CommuteEditorProps = {
  slot: CommuteSlot;
  initial: CommuteFormValue;
  api: RiderMyTripsApi;
  onChoices: (places: CommutePlaceChoice[]) => void;
  onCancel: () => void;
  onSaved: (commute: SavedCommute) => void;
};

function CommuteEditor({
  slot,
  initial,
  api,
  onChoices,
  onCancel,
  onSaved,
}: CommuteEditorProps) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function setField<K extends keyof CommuteFormValue>(
    field: K,
    nextValue: CommuteFormValue[K],
  ) {
    setValue((current) => ({ ...current, [field]: nextValue }));
    setMessage(null);
  }

  function toggleDay(day: CommuteDay) {
    const days = value.days.includes(day)
      ? value.days.filter((current) => current !== day)
      : [...value.days, day];
    setField("days", days);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const draft = toCommuteDraft(value);
    if (!draft) {
      setMessage(
        "Choose a From place, a To place, at least one day, and a usual departure time.",
      );
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const body = await api.replace(slot, draft);
      const commute =
        typeof body === "object" && body !== null && "commute" in body
          ? normalizeSingleCommute(body.commute, slot)
          : null;
      if (!commute) {
        setMessage("Your trips are unavailable right now.");
        return;
      }
      onSaved(commute);
    } catch (error) {
      setMessage(apiErrorMessage(error, "save"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="overflow-visible">
      <CardHeader>
        <h2 className="text-lg font-semibold tracking-tight">
          {initial.origin || initial.destination ? "Edit" : "Add"}{" "}
          {slotLabel(slot)}
        </h2>
        <CardDescription>
          Choose saved places, days, and your usual departure time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <PlaceSearchField
              api={api}
              id={`${slot}-origin`}
              label="From"
              onChoices={onChoices}
              onSelected={(place) => setField("origin", place)}
              selected={value.origin}
            />
            <PlaceSearchField
              api={api}
              id={`${slot}-destination`}
              label="To"
              onChoices={onChoices}
              onSelected={(place) => setField("destination", place)}
              selected={value.destination}
            />
          </div>

          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Days</legend>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {COMMUTE_DAYS.map((day) => (
                <label
                  className="flex min-h-11 items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm hover:bg-accent"
                  key={day}
                >
                  <input
                    checked={value.days.includes(day)}
                    className="size-4 accent-primary"
                    onChange={() => toggleDay(day)}
                    type="checkbox"
                  />
                  <span>{day[0]?.toUpperCase() + day.slice(1)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`${slot}-departure`}>Usual departure time</Label>
              <Input
                id={`${slot}-departure`}
                onChange={(event) =>
                  setField("departureTime", event.currentTarget.value)
                }
                required
                type="time"
                value={value.departureTime}
              />
              <p className="text-xs text-muted-foreground">Pacific time</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor={`${slot}-reminder`}>Remind me</Label>
              <Select
                id={`${slot}-reminder`}
                onChange={(event) =>
                  setField(
                    "reminderMinutes",
                    Number(event.currentTarget.value) as 15 | 30 | 45 | 60,
                  )
                }
                value={String(value.reminderMinutes)}
              >
                {REMINDER_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {reminderLabel(minutes)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <label className="flex min-h-11 items-center gap-3 rounded-lg border bg-card px-3 py-2 text-sm">
            <input
              checked={value.paused}
              className="size-4 accent-primary"
              onChange={(event) =>
                setField("paused", event.currentTarget.checked)
              }
              type="checkbox"
            />
            <span>Pause reminders for this trip</span>
          </label>

          {message && (
            <p
              aria-live="polite"
              className="rounded-lg border border-destructive/20 bg-destructive/8 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {message}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={busy}
              onClick={onCancel}
              type="button"
              variant="ghost"
            >
              Cancel
            </Button>
            <Button disabled={busy} type="submit">
              {busy ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <Check aria-hidden="true" />
              )}
              {busy ? "Saving…" : "Save trip"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

type DeleteDialogProps = {
  slot: CommuteSlot;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function DeleteDialog({ slot, busy, onCancel, onConfirm }: DeleteDialogProps) {
  useEffect(() => {
    document.getElementById("delete-trip-cancel")?.focus();
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab") return;
      const cancel = document.getElementById("delete-trip-cancel");
      const confirm = document.getElementById("delete-trip-confirm");
      if (
        !(cancel instanceof HTMLElement) ||
        !(confirm instanceof HTMLElement)
      ) {
        return;
      }
      if (event.shiftKey && document.activeElement === cancel) {
        event.preventDefault();
        confirm.focus();
      } else if (!event.shiftKey && document.activeElement === confirm) {
        event.preventDefault();
        cancel.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4">
      <div
        aria-describedby="delete-trip-description"
        aria-labelledby="delete-trip-title"
        aria-modal="true"
        className="w-full max-w-sm rounded-2xl border bg-card p-5 text-card-foreground shadow-xl"
        role="alertdialog"
      >
        <h2 className="text-base font-semibold" id="delete-trip-title">
          Delete {slotLabel(slot)}?
        </h2>
        <p
          className="mt-2 text-sm leading-6 text-muted-foreground"
          id="delete-trip-description"
        >
          This removes future reminders for this trip.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            disabled={busy}
            id="delete-trip-cancel"
            onClick={onCancel}
            variant="ghost"
          >
            Cancel
          </Button>
          <Button
            disabled={busy}
            id="delete-trip-confirm"
            onClick={onConfirm}
            variant="destructive"
          >
            {busy ? (
              <LoaderCircle aria-hidden="true" className="animate-spin" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
            {busy ? "Deleting…" : "Delete trip"}
          </Button>
        </div>
      </div>
    </div>
  );
}

type CommuteCardProps = {
  slot: CommuteSlot;
  commute: SavedCommute | null;
  places: ReadonlyMap<string, CommutePlaceChoice>;
  api: RiderMyTripsApi;
  onChoices: (places: CommutePlaceChoice[]) => void;
  onSaved: (commute: SavedCommute) => void;
  onPause: (commute: SavedCommute) => void;
  pauseBusy: boolean;
  onDelete: (slot: CommuteSlot, target: HTMLButtonElement) => void;
  onPreview: (slot: CommuteSlot) => void;
  previewBusy: boolean;
  editorOpen: boolean;
  onOpenEditor: (target: HTMLButtonElement) => void;
  onCloseEditor: () => void;
};

function CommuteCard({
  slot,
  commute,
  places,
  api,
  onChoices,
  onSaved,
  onPause,
  pauseBusy,
  onDelete,
  onPreview,
  previewBusy,
  editorOpen,
  onOpenEditor,
  onCloseEditor,
}: CommuteCardProps) {
  if (editorOpen) {
    return (
      <CommuteEditor
        api={api}
        initial={
          commute
            ? createCommuteFormValue(commute, [...places.values()])
            : emptyForm()
        }
        onCancel={onCloseEditor}
        onChoices={onChoices}
        onSaved={onSaved}
        slot={slot}
      />
    );
  }

  const originName = commute
    ? (places.get(commute.originPlaceId)?.name ?? "Saved place")
    : null;
  const destinationName = commute
    ? (places.get(commute.destinationPlaceId)?.name ?? "Saved place")
    : null;
  const canEdit =
    commute !== null &&
    places.has(commute.originPlaceId) &&
    places.has(commute.destinationPlaceId);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            {slotLabel(slot)}
          </h2>
          <CardDescription>
            {commute ? "Your recurring trip" : "No trip saved yet"}
          </CardDescription>
        </div>
        {commute?.paused && (
          <span className="rounded-full border border-warning/30 bg-warning/10 px-2.5 py-1 text-xs font-medium text-warning-foreground">
            Paused
          </span>
        )}
      </CardHeader>
      <CardContent>
        {commute ? (
          <>
            <dl className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  From
                </dt>
                <dd className="mt-1 font-medium">{originName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  To
                </dt>
                <dd className="mt-1 font-medium">{destinationName}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Days
                </dt>
                <dd className="mt-1">{formatCommuteDays(commute.days)}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Usual departure time
                </dt>
                <dd className="mt-1">
                  {formatDepartureTime(commute.departureTime)} Pacific time
                </dd>
              </div>
            </dl>
            <p className="mt-4 text-sm text-muted-foreground">
              {commute.paused
                ? "Reminders are paused."
                : `Remind me ${reminderLabel(commute.reminderMinutes)}.`}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button
                disabled={!canEdit}
                onClick={(event) => onOpenEditor(event.currentTarget)}
                size="sm"
                title={
                  canEdit ? undefined : "Trip places are unavailable right now."
                }
                variant="outline"
              >
                <Pencil aria-hidden="true" /> Edit
              </Button>
              <Button
                aria-label={`${commute.paused ? "Resume" : "Pause"} ${slotLabel(slot)}`}
                disabled={pauseBusy}
                onClick={() => onPause(commute)}
                size="sm"
                variant="outline"
              >
                {commute.paused ? (
                  <Play aria-hidden="true" />
                ) : (
                  <RotateCcw aria-hidden="true" />
                )}
                {commute.paused ? "Resume" : "Pause"}
              </Button>
              <Button
                aria-label={`Delete ${slotLabel(slot)}`}
                onClick={(event) => onDelete(slot, event.currentTarget)}
                size="sm"
                variant="outline"
              >
                <Trash2 aria-hidden="true" /> Delete
              </Button>
              <Button
                disabled={previewBusy}
                onClick={() => onPreview(slot)}
                size="sm"
                variant="secondary"
              >
                {previewBusy ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" />
                ) : (
                  <Check aria-hidden="true" />
                )}
                Send a test preview
              </Button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-start gap-4">
            <p className="text-sm leading-6 text-muted-foreground">
              Save a recurring trip to choose days, a usual departure time, and
              reminders.
            </p>
            <Button onClick={(event) => onOpenEditor(event.currentTarget)}>
              <Plus aria-hidden="true" /> Add {slotLabel(slot)}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function RiderMyTrips({
  initialCommutes = [],
  initialPlaces = [],
  api,
}: RiderMyTripsProps) {
  const clientApi = useMemo(() => api ?? createRiderMyTripsApi(), [api]);
  const normalizedInitial = useMemo(
    () => normalizeCommutesPayload({ commutes: initialCommutes }) ?? [],
    [initialCommutes],
  );
  const [commutes, setCommutes] = useState<SavedCommute[]>(normalizedInitial);
  const [places, setPlaces] = useState<ReadonlyMap<string, CommutePlaceChoice>>(
    () => new Map(initialPlaces.map((place) => [place.id, place])),
  );
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState("Loading your trips…");
  const [editorSlot, setEditorSlot] = useState<CommuteSlot | null>(null);
  const [previewSlot, setPreviewSlot] = useState<CommuteSlot | null>(null);
  const [preview, setPreview] = useState<{
    slot: CommuteSlot;
    value: { ok: true; subject: string; text: string };
  } | null>(null);
  const [history, setHistory] = useState<SafeHistoryEntry[] | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CommuteSlot | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [pauseBusySlot, setPauseBusySlot] = useState<CommuteSlot | null>(null);
  const deleteFocusRef = useRef<HTMLButtonElement | null>(null);
  const hadDeleteDialog = useRef(false);
  const editorFocusRef = useRef<HTMLButtonElement | null>(null);
  const hadEditor = useRef(false);

  useEffect(() => {
    let active = true;
    void clientApi
      .list()
      .then((body) => {
        if (!active) return;
        const next = normalizeCommutesPayload(body);
        if (!next) {
          setMessage("Your trips are unavailable right now.");
          setStatus("Your trips are unavailable right now.");
          return;
        }
        setCommutes(next);
        setStatus(
          next.length === 0 ? "No trips saved yet." : "Your trips are ready.",
        );
      })
      .catch((error) => {
        if (!active) return;
        const nextMessage = apiErrorMessage(error, "trips");
        setMessage(nextMessage);
        setStatus(nextMessage);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void clientApi
      .history()
      .then((body) => {
        if (active) setHistory(normalizeEmailHistoryPayload(body));
      })
      .catch(() => {
        if (active) setHistory(null);
      });

    return () => {
      active = false;
    };
  }, [clientApi]);

  useEffect(() => {
    if (!pendingDelete && hadDeleteDialog.current) {
      hadDeleteDialog.current = false;
      window.requestAnimationFrame(() => deleteFocusRef.current?.focus());
    }
    if (pendingDelete) hadDeleteDialog.current = true;
  }, [pendingDelete]);

  useEffect(() => {
    if (!editorSlot && hadEditor.current) {
      hadEditor.current = false;
      window.requestAnimationFrame(() => editorFocusRef.current?.focus());
    }
    if (editorSlot) hadEditor.current = true;
  }, [editorSlot]);

  function updatePlaces(next: CommutePlaceChoice[]) {
    setPlaces((current) => mergePlaces(current, next));
  }

  function saved(commute: SavedCommute) {
    setCommutes((current) => {
      const withoutSlot = current.filter((item) => item.slot !== commute.slot);
      return [...withoutSlot, commute].sort((left, right) =>
        left.slot === right.slot ? 0 : left.slot === "first" ? -1 : 1,
      );
    });
    setEditorSlot(null);
    setMessage(null);
    setStatus(`${slotLabel(commute.slot)} saved.`);
  }

  async function pause(commute: SavedCommute) {
    if (pauseBusySlot) return;
    setPauseBusySlot(commute.slot);
    setMessage(null);
    try {
      const body = await clientApi.replace(
        commute.slot,
        toStoredCommuteDraft(commute, !commute.paused),
      );
      const next =
        typeof body === "object" && body !== null && "commute" in body
          ? normalizeSingleCommute(body.commute, commute.slot)
          : null;
      if (!next) throw new Error("RIDER_TRIPS_RESPONSE_INVALID");
      saved(next);
      setStatus(
        next.paused
          ? `${slotLabel(next.slot)} paused.`
          : `${slotLabel(next.slot)} resumed.`,
      );
    } catch (error) {
      const nextMessage = apiErrorMessage(error, "save");
      setMessage(nextMessage);
      setStatus(nextMessage);
    } finally {
      setPauseBusySlot(null);
    }
  }

  async function remove() {
    if (!pendingDelete || deleteBusy) return;
    const slot = pendingDelete;
    setDeleteBusy(true);
    try {
      const body = await clientApi.remove(slot);
      if (
        typeof body !== "object" ||
        body === null ||
        !("deleted" in body) ||
        body.deleted !== true ||
        !("slot" in body) ||
        body.slot !== slot
      ) {
        throw new Error("RIDER_TRIPS_RESPONSE_INVALID");
      }
      setCommutes((current) =>
        current.filter((commute) => commute.slot !== slot),
      );
      setPendingDelete(null);
      setStatus(`${slotLabel(slot)} deleted.`);
      setMessage(null);
    } catch (error) {
      const nextMessage = apiErrorMessage(error, "delete");
      setMessage(nextMessage);
      setStatus(nextMessage);
    } finally {
      setDeleteBusy(false);
    }
  }

  async function sendPreview(slot: CommuteSlot) {
    if (previewSlot) return;
    setPreviewSlot(slot);
    setPreview(null);
    setMessage(null);
    try {
      const value = safePreview(await clientApi.preview(slot));
      if (!value.ok) {
        setMessage("Test previews are unavailable right now.");
        setStatus("Test previews are unavailable right now.");
        return;
      }
      setPreview({ slot, value });
      setStatus("Test preview ready.");
    } catch (error) {
      const nextMessage = apiErrorMessage(error, "preview");
      setMessage(nextMessage);
      setStatus(nextMessage);
    } finally {
      setPreviewSlot(null);
    }
  }

  const cards = createEmptyCommuteCards(commutes);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div
        aria-hidden={pendingDelete ? true : undefined}
        inert={pendingDelete ? true : undefined}
      >
        <div>
          <p className="text-sm font-medium text-primary">Your saved trips</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            My trips
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            Keep one first trip and one return trip. You can change or pause
            reminders whenever you like.
          </p>
        </div>

        <p aria-live="polite" className="sr-only" role="status">
          {status}
        </p>
        {message && (
          <div
            aria-live="polite"
            className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning-foreground"
            role="status"
          >
            <AlertTriangle
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{message}</span>
          </div>
        )}

        {loading && commutes.length === 0 ? (
          <div aria-label="Loading trips" className="grid gap-5 md:grid-cols-2">
            {cards.map((card) => (
              <Card
                aria-hidden="true"
                className="animate-pulse"
                key={card.slot}
              >
                <CardHeader>
                  <div className="h-5 w-28 rounded bg-muted" />
                  <div className="h-4 w-36 rounded bg-muted" />
                </CardHeader>
                <CardContent>
                  <div className="h-24 rounded bg-muted" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-5 md:grid-cols-2">
            {cards.map((card) => (
              <CommuteCard
                api={clientApi}
                commute={card.commute}
                editorOpen={editorSlot === card.slot}
                key={card.slot}
                onChoices={updatePlaces}
                onCloseEditor={() => setEditorSlot(null)}
                onDelete={(slot, target) => {
                  deleteFocusRef.current = target;
                  setPendingDelete(slot);
                }}
                onOpenEditor={(target) => {
                  setMessage(null);
                  editorFocusRef.current = target;
                  setEditorSlot(card.slot);
                }}
                onPause={pause}
                pauseBusy={pauseBusySlot === card.slot}
                onPreview={sendPreview}
                onSaved={saved}
                places={places}
                previewBusy={previewSlot === card.slot}
                slot={card.slot}
              />
            ))}
          </div>
        )}

        {preview && (
          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold tracking-tight">
                Test preview
              </h2>
              <CardDescription>
                {slotLabel(preview.slot)} — nothing was sent.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="font-medium">{preview.value.subject}</p>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                  {preview.value.text}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <h2 className="text-lg font-semibold tracking-tight">
              Past trip updates
            </h2>
            <CardDescription>
              Only updates for your saved trips appear here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {history === null ? (
              <p className="text-sm text-muted-foreground">
                Past trip updates are unavailable right now.
              </p>
            ) : history.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No trip updates yet.
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {history.map((entry) => (
                  <li
                    className="flex items-center justify-between gap-4 px-3 py-3 text-sm"
                    key={`${entry.serviceDate}-${entry.slot}`}
                  >
                    <span>
                      {entry.serviceDate} · {slotLabel(entry.slot)}
                    </span>
                    <span className="text-muted-foreground">
                      {safeStatusLabel(entry.status)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {pendingDelete && (
        <DeleteDialog
          busy={deleteBusy}
          onCancel={() => setPendingDelete(null)}
          onConfirm={remove}
          slot={pendingDelete}
        />
      )}
    </div>
  );
}
